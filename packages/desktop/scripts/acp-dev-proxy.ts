#!/usr/bin/env npx tsx
/**
 * ACP Dev Proxy — bridges WebSocket (frontend) ↔ stdio (agent CLI).
 *
 * Supports multiple backends:
 *   - ollama run <model>       (interactive stdin, plain text output)
 *   - interpreter              (interactive stdin, plain text)
 *   - goose session            (interactive stdin, plain text)
 *   - claude --output-format stream-json --verbose  (structured JSON)
 *
 * Key design: LAZY SPAWN — process is only started on first prompt,
 * not on session/new. This avoids stdin timeout issues with Claude
 * and works naturally with all interactive CLI tools.
 *
 * Run: npx tsx scripts/acp-dev-proxy.ts
 */

import { WebSocketServer, WebSocket } from "ws";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PORT = 9222;
const CONFIG_PATH = join(process.env.HOME || "~", ".kairos", "config.json");

interface Config {
  command: string;
  args: string[];
  promptMode?: "stdin" | "arg";
  systemPrompt?: string;
  streamJson?: boolean;
}

function loadConfig(): Config {
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    return {
      ...raw,
      streamJson: raw.streamJson ?? raw.args?.includes("stream-json") ?? false,
    };
  } catch {
    // Default: Ollama with mistral (most likely to work out of the box)
    return { command: "ollama", args: ["run", "mistral"], promptMode: "stdin", streamJson: false };
  }
}

interface AgentSession {
  id: string;
  process: ChildProcess | null;
  lineBuffer: string;
  config: Config;
  workingDirectory?: string;
  spawned: boolean;
}

const sessions = new Map<string, AgentSession>();

function sendToClient(ws: WebSocket, msg: Record<string, unknown>): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function sendNotification(ws: WebSocket, method: string, params: Record<string, unknown>): void {
  sendToClient(ws, { jsonrpc: "2.0", method, params });
}

function sendResponse(ws: WebSocket, id: number | string, result: unknown): void {
  sendToClient(ws, { jsonrpc: "2.0", id, result });
}

function sendError(ws: WebSocket, id: number | string, code: number, message: string): void {
  sendToClient(ws, { jsonrpc: "2.0", id, error: { code, message } });
}

/**
 * Spawn the agent process. Called on first prompt, not on session/new.
 */
function spawnProcess(session: AgentSession, ws: WebSocket): void {
  const { config, workingDirectory } = session;
  const args = [...config.args];

  const proc = spawn(config.command, args, {
    cwd: workingDirectory || process.cwd(),
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  session.process = proc;
  session.spawned = true;

  proc.stdout!.on("data", (data: Buffer) => {
    const chunk = data.toString();
    session.lineBuffer += chunk;
    const lines = session.lineBuffer.split("\n");
    session.lineBuffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;
      if (config.streamJson) {
        parseStructuredEvent(ws, session.id, line.trim());
      } else {
        // Plain text mode — emit each line as a text update
        sendNotification(ws, "session/update", {
          session_id: session.id,
          update: { type: "text", text: line },
        });
      }
    }
  });

  proc.stderr!.on("data", (data: Buffer) => {
    const text = data.toString().trim();
    if (text && !isNoiseStderr(text)) {
      sendNotification(ws, "session/update", {
        session_id: session.id,
        update: { type: "text", text: `[stderr] ${text}` },
      });
    }
  });

  proc.on("close", (code) => {
    // Flush remaining buffer
    if (session.lineBuffer.trim()) {
      if (config.streamJson) {
        parseStructuredEvent(ws, session.id, session.lineBuffer.trim());
      } else {
        sendNotification(ws, "session/update", {
          session_id: session.id,
          update: { type: "text", text: session.lineBuffer.trim() },
        });
      }
    }
    sendNotification(ws, "session/update", {
      session_id: session.id,
      update: { type: "status", status: code === 0 ? "complete" : "error" },
    });
    sessions.delete(session.id);
  });

  proc.on("error", (err) => {
    sendNotification(ws, "session/update", {
      session_id: session.id,
      update: { type: "text", text: `[error] ${err.message}` },
    });
    sendNotification(ws, "session/update", {
      session_id: session.id,
      update: { type: "status", status: "error" },
    });
    console.error(`[proxy] Agent error: ${err.message}`);
  });
}

/**
 * Filter out noise from stderr (progress spinners, warnings, etc.)
 */
function isNoiseStderr(text: string): boolean {
  return (
    text.startsWith("Warning:") ||
    text.includes("pulling manifest") ||
    text.includes("verifying sha256") ||
    text.includes("writing manifest") ||
    /^\s*[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/.test(text) // spinner characters
  );
}

/**
 * Parse Claude's --output-format stream-json events.
 */
function parseStructuredEvent(ws: WebSocket, sessionId: string, line: string): void {
  try {
    const event = JSON.parse(line);

    switch (event.type) {
      case "assistant": {
        const content = event.message?.content;
        if (!Array.isArray(content)) break;
        for (const block of content) {
          if (block.type === "thinking") {
            sendNotification(ws, "session/update", {
              session_id: sessionId,
              update: { type: "thinking", thinking: block.thinking },
            });
          } else if (block.type === "text") {
            sendNotification(ws, "session/update", {
              session_id: sessionId,
              update: { type: "text", text: block.text },
            });
          } else if (block.type === "tool_use") {
            sendNotification(ws, "session/update", {
              session_id: sessionId,
              update: { type: "tool_use", id: block.id, name: block.name, input: block.input ?? {} },
            });
          }
        }
        break;
      }

      case "user": {
        const content = event.message?.content;
        if (!Array.isArray(content)) break;
        for (const block of content) {
          if (block.type === "tool_result") {
            const resultText = typeof block.content === "string"
              ? block.content
              : JSON.stringify(block.content);
            sendNotification(ws, "session/update", {
              session_id: sessionId,
              update: { type: "tool_result", tool_use_id: block.tool_use_id || "", content: resultText, is_error: block.is_error },
            });
          }
        }
        break;
      }

      case "result":
        sendNotification(ws, "session/update", {
          session_id: sessionId,
          update: { type: "cost", cost_usd: event.total_cost_usd ?? 0, duration_ms: event.duration_ms ?? 0 },
        });
        break;

      case "system":
        break;

      default:
        break;
    }
  } catch {
    // Not JSON — emit as plain text (graceful fallback for non-JSON tools)
    if (line.length > 0) {
      sendNotification(ws, "session/update", {
        session_id: sessionId,
        update: { type: "text", text: line },
      });
    }
  }
}

// --- Main ---

const config = loadConfig();
const wss = new WebSocketServer({ port: PORT });

console.log(`[acp-proxy] Listening on ws://localhost:${PORT}`);
console.log(`[acp-proxy] Backend: ${config.command} ${config.args.join(" ")}`);
console.log(`[acp-proxy] Mode: ${config.streamJson ? "stream-json" : "plain text"} | promptMode: ${config.promptMode || "stdin"}`);

wss.on("connection", (ws) => {
  console.log("[acp-proxy] Client connected");

  ws.on("message", (raw) => {
    let msg: { jsonrpc: string; id?: number | string; method?: string; params?: Record<string, unknown> };
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (!msg.method) return;

    switch (msg.method) {
      case "initialize":
        sendResponse(ws, msg.id!, {
          server_info: { name: "kairos-acp-proxy", version: "0.1.0" },
          capabilities: { streaming: true, tools: config.streamJson, permissions: false, multi_turn: true },
        });
        break;

      case "session/new": {
        // LAZY SPAWN: just create a session placeholder. Process starts on first prompt.
        const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const workingDirectory = (msg.params?.working_directory as string) || undefined;

        // Per-session model override (from the dialog's model picker)
        const sessionConfig: Config = (msg.params?.command)
          ? {
              command: msg.params.command as string,
              args: (msg.params.args as string[]) || [],
              promptMode: "stdin",
              streamJson: (msg.params.stream_json as boolean) || false,
            }
          : config;

        const session: AgentSession = {
          id: sessionId,
          process: null,
          lineBuffer: "",
          config: sessionConfig,
          workingDirectory,
          spawned: false,
        };
        sessions.set(sessionId, session);
        sendResponse(ws, msg.id!, { session_id: sessionId });
        console.log(`[acp-proxy] Session created: ${sessionId} | ${sessionConfig.command} ${sessionConfig.args.join(" ")}${workingDirectory ? ` | cwd: ${workingDirectory}` : ""}`);
        break;
      }

      case "session/prompt": {
        const params = msg.params as { session_id: string; messages: Array<{ content: Array<{ text?: string }> }> };
        const session = sessions.get(params.session_id);
        if (!session) {
          sendError(ws, msg.id!, -32600, `Unknown session: ${params.session_id}`);
          break;
        }

        const text = params.messages?.[0]?.content?.[0]?.text || "";
        if (!text) {
          sendError(ws, msg.id!, -32602, "Empty prompt");
          break;
        }

        // Spawn process on first prompt (lazy spawn)
        if (!session.spawned) {
          spawnProcess(session, ws);
        }

        // Send prompt to the agent's stdin
        if (session.process?.stdin?.writable) {
          session.process.stdin.write(text + "\n");
          sendNotification(ws, "session/update", {
            session_id: params.session_id,
            update: { type: "status", status: "streaming" },
          });
        } else {
          sendError(ws, msg.id!, -32603, "Agent process stdin not writable");
          break;
        }

        sendResponse(ws, msg.id!, { ok: true });
        break;
      }

      case "session/cancel": {
        const params = msg.params as { session_id: string };
        const session = sessions.get(params.session_id);
        if (session?.process) {
          session.process.kill("SIGTERM");
        }
        sessions.delete(params.session_id);
        sendResponse(ws, msg.id!, { ok: true });
        break;
      }

      case "session/permission_response": {
        const params = msg.params as { id: string; decision: string; session_id?: string };
        // Forward permission response to the relevant session's stdin
        if (params.session_id) {
          const session = sessions.get(params.session_id);
          if (session?.process?.stdin?.writable) {
            const response = params.decision === "deny" ? "n" : "y";
            session.process.stdin.write(response + "\n");
          }
        }
        break;
      }

      default:
        sendError(ws, msg.id!, -32601, `Method not found: ${msg.method}`);
    }
  });

  ws.on("close", () => {
    console.log("[acp-proxy] Client disconnected");
  });
});
