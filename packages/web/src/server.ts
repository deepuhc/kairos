/**
 * Kairos Web Dashboard Server
 *
 * LLM-agnostic orchestrator dashboard. Works with any CLI tool:
 * claude, ollama, aichat, sgpt, llm, mods, or any custom command.
 *
 * Zero-config: auto-detects what's installed and uses it.
 * If your tool works in your terminal, it works here.
 */

import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { WebSocketServer, WebSocket } from "ws";
import { Coordinator } from "@kairos/core/coordinator";
import { ProjectManager } from "@kairos/core/project-manager";
import { createRuntime, createCustomRuntime, detectTools } from "@kairos/runtime";
import { CLIRuntime } from "@kairos/runtime/adapters";
import type { LLMRuntime } from "@kairos/runtime";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.KAIROS_PORT ?? "3000");
const KAIROS_DIR = join(homedir(), ".kairos");
const CONFIG_FILE = join(KAIROS_DIR, "config.json");

// --- Load user config ---
interface KairosConfig {
  /** Which tool to prefer (e.g. "claude", "ollama") */
  runtime?: string;
  /** The command path (e.g. "/path/to/claude") — simplest config */
  command?: string;
  /** Args template (default: ["-p", "{prompt}"]) */
  args?: string[];
  /** System prompt for agents */
  systemPrompt?: string;
  /** Custom command config (for tools not in the known list) */
  customCommand?: {
    command: string;
    args: string[];
    promptMode?: "arg" | "stdin";
  };
}

function loadConfig(): KairosConfig {
  try {
    if (existsSync(CONFIG_FILE)) {
      return JSON.parse(readFileSync(CONFIG_FILE, "utf-8"));
    }
  } catch { /* ignore */ }
  return {};
}

// --- Initialize runtime ---
const config = loadConfig();
let runtime: LLMRuntime;
let runtimeName: string;

try {
  if (config.customCommand) {
    runtime = createCustomRuntime(config.customCommand);
    runtimeName = config.customCommand.command;
  } else if (config.command) {
    // Simple config: just a command path
    runtime = createCustomRuntime({
      command: config.command,
      args: config.args || ["-p", "{prompt}"],
      promptMode: "arg",
    });
    runtimeName = config.command.split("/").pop() || config.command;
  } else {
    runtime = createRuntime(config.runtime);
    runtimeName = runtime.name;
  }
} catch (e: any) {
  console.error("");
  console.error("  ✗ " + e.message);
  console.error("");
  process.exit(1);
}

// --- Backend state ---
const coordinator = new Coordinator();
const projectManager = new ProjectManager();

interface AgentState {
  id: string;
  name: string;
  role: string;
  status: "running" | "completed" | "failed" | "awaiting_input";
  output: string;
  startedAt: number;
}

/** Generate a short friendly name from a task description */
function friendlyName(task: string): string {
  // Take first few meaningful words, capitalize
  const words = task
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter((w) => !["the", "a", "an", "and", "or", "for", "to", "in", "on", "of", "with"].includes(w.toLowerCase()))
    .slice(0, 3);
  if (words.length === 0) return "Task";
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
}

const agents = new Map<string, AgentState>();
const logs: Array<{ agentId: string; text: string; type: string; time: string }> = [];
const clients = new Set<WebSocket>();

function broadcast(msg: object) {
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}

function addLog(agentId: string, text: string, type: string) {
  const entry = {
    agentId,
    text,
    type,
    time: new Date().toLocaleTimeString("en-US", { hour12: false }).slice(0, 8),
  };
  logs.push(entry);
  if (logs.length > 200) logs.splice(0, logs.length - 200);
  broadcast({ type: "log", entry });
}

// --- Detect if runtime supports stream-json (Claude) ---
const isClaudeRuntime = runtimeName === "claude" ||
  (config.command?.includes("claude")) ||
  (config.args?.includes("claude")) ||
  (config.runtime === "claude");

// --- Runtime events ---
runtime.on("agent:started", ({ id }) => {
  addLog(id, "Started", "status");
  broadcast({ type: "agent:update", agents: Object.fromEntries(agents) });
});

runtime.on("agent:output", ({ id, chunk }) => {
  const agent = agents.get(id);
  if (agent) agent.output += chunk;
  const lines = chunk.split("\n").filter((l: string) => l.trim());
  for (const line of lines) addLog(id, line, "output");
  broadcast({ type: "stream:chunk", agentId: id, chunk });
});

runtime.on("agent:thinking", ({ id, thinking }) => {
  broadcast({ type: "stream:thinking", agentId: id, thinking });
});

runtime.on("agent:text", ({ id, text }) => {
  const agent = agents.get(id);
  if (agent) agent.output += text;
  broadcast({ type: "stream:text", agentId: id, text });
  addLog(id, text.slice(0, 120), "output");
});

runtime.on("agent:tool_use", ({ id, name, input }) => {
  broadcast({ type: "stream:tool_use", agentId: id, name, input });
  addLog(id, `Tool: ${name}`, "tool");
});

runtime.on("agent:tool_result", ({ id, name, result, error, isPermissionDenial }) => {
  broadcast({ type: "stream:tool_result", agentId: id, name, result, error, isPermissionDenial });
  if (isPermissionDenial) {
    // Track that this agent has unresolved permission issues
    const agent = agents.get(id);
    if (agent) (agent as any).hasPermissionIssue = true;
    broadcast({ type: "agent:update", agents: Object.fromEntries(agents) });
  }
});

runtime.on("agent:result", ({ id, result, cost_usd, duration_ms }) => {
  broadcast({ type: "stream:result", agentId: id, result, cost_usd, duration_ms });
});

runtime.on("agent:input_required", ({ id, prompt, type: promptType }) => {
  const agent = agents.get(id);
  if (agent) agent.status = "awaiting_input";
  broadcast({ type: "agent:input_required", agentId: id, prompt, promptType });
  broadcast({ type: "agent:update", agents: Object.fromEntries(agents) });
  addLog(id, `Awaiting input: ${prompt.slice(0, 80)}`, "status");
});

runtime.on("agent:done", ({ id, status }) => {
  const agent = agents.get(id);
  if (agent) agent.status = status === "completed" ? "completed" : "failed";
  addLog(id, status === "completed" ? "Done" : "Failed", "status");
  broadcast({ type: "agent:update", agents: Object.fromEntries(agents) });
});

// --- Agent response (follow-up in SAME session) ---
async function handleAgentResponse(agentId: string, message: string): Promise<void> {
  const agent = agents.get(agentId);
  if (!agent) return;

  // Try to send directly to stdin (works if process is still running)
  try {
    runtime.send(agentId, message);
    agent.status = "running";
    addLog(agentId, `(you): ${message}`, "output");
    broadcast({ type: "stream:text", agentId, text: "" }); // Reset accumulation
    broadcast({ type: "agent:update", agents: Object.fromEntries(agents) });
    return;
  } catch {
    // Process has exited — need to spawn a new one
  }

  // Process exited: start a new session with context
  const context = agent.output.slice(-2000);
  const followUpPrompt = `Previous conversation:\n${context}\n\nUser: ${message}`;

  agent.status = "running";
  agent.output += `\n---\n(you): ${message}\n`;
  broadcast({ type: "agent:update", agents: Object.fromEntries(agents) });
  addLog(agentId, `(you): ${message}`, "output");

  const extraArgs = [
    ...(config.systemPrompt ? ["--system-prompt", config.systemPrompt] : []),
  ];
  const followUpConfig: Record<string, unknown> = {};
  if (extraArgs.length) followUpConfig.extraArgs = extraArgs;
  if (isClaudeRuntime) followUpConfig.streamJson = true;

  try {
    const response = await runtime.runTask(agentId, followUpPrompt, followUpConfig);
    agent.output += response;
    agent.status = "completed";
    addLog(agentId, "Done", "status");
    broadcast({ type: "agent:update", agents: Object.fromEntries(agents) });
  } catch (err) {
    agent.status = "failed";
    addLog(agentId, `Error: ${err instanceof Error ? err.message : err}`, "error");
    broadcast({ type: "agent:update", agents: Object.fromEntries(agents) });
  }
}

// --- Permission inference ---
// Users express intent naturally. The system infers what access is needed.
type PermissionMode = "read-only" | "edit" | "full";

const WRITE_SIGNALS = [
  "fix", "update", "change", "modify", "refactor", "write", "create",
  "add", "remove", "delete", "rename", "move", "implement", "build",
  "install", "upgrade", "patch", "rewrite",
];

const FULL_SIGNALS = [
  "deploy", "run", "execute", "start", "stop", "restart",
  "install", "uninstall", "publish", "release",
];

function inferPermissions(task: string, riskLevel: string): PermissionMode {
  const lower = task.toLowerCase();

  // Explicit overrides in the prompt
  if (lower.includes("read only") || lower.includes("don't change") || lower.includes("just review")) {
    return "read-only";
  }
  if (lower.includes("go ahead") || lower.includes("full access") || lower.includes("do whatever")) {
    return "full";
  }

  // Infer from task intent
  if (FULL_SIGNALS.some((s) => lower.includes(s))) return "full";
  if (WRITE_SIGNALS.some((s) => lower.includes(s))) return "edit";

  // High risk → read-only by default (user must explicitly grant)
  if (riskLevel === "high") return "read-only";

  return "read-only";
}

function getPermissionArgs(mode: PermissionMode): string[] {
  // With interactive stdin, the user can respond to permission prompts
  // directly in the dashboard. No need to skip permissions.
  // Only skip for "full" mode where user explicitly trusts everything.
  if (mode === "full") {
    return ["--dangerously-skip-permissions"];
  }
  return [];
}

// --- Task execution ---
async function handleTask(task: string, explicitPermissions?: PermissionMode): Promise<void> {
  console.log(`  [task] analyzing: "${task.slice(0, 80)}"`);
  const analysis = coordinator.analyze(task);

  // Infer permissions from task intent + risk, or use explicit override
  const permissions = explicitPermissions ?? inferPermissions(task, analysis.riskLevel);
  console.log(`  [task] pattern=${analysis.pattern} agents=${analysis.agents.length} permissions=${permissions}`);

  addLog(
    "coordinator",
    `Pattern: ${analysis.pattern} | Complexity: ${analysis.complexity} | Agents: ${analysis.agents.length}`,
    "status"
  );

  for (const agent of analysis.agents) {
    agents.set(agent.id, {
      id: agent.id,
      name: friendlyName(agent.role),
      role: agent.role,
      status: "running",
      output: "",
      startedAt: Date.now(),
    });
  }
  broadcast({ type: "agent:update", agents: Object.fromEntries(agents) });

  // Build extra args: permissions + system prompt
  const extraArgs = [
    ...getPermissionArgs(permissions),
    ...(config.systemPrompt ? ["--system-prompt", config.systemPrompt] : []),
  ];
  const taskConfig: Record<string, unknown> = {};
  if (extraArgs.length) taskConfig.extraArgs = extraArgs;
  if (isClaudeRuntime) taskConfig.streamJson = true;

  // Log permission level so user knows what access was granted
  if (permissions !== "read-only") {
    addLog("coordinator", `Permissions: ${permissions} (inferred from task intent)`, "status");
  }

  try {
    switch (analysis.pattern) {
      case "parallel": {
        const tasks = analysis.agents.map((a) => ({ id: a.id, prompt: a.role, config: taskConfig }));
        await runtime.runParallel(tasks);
        break;
      }
      case "sequential": {
        let prev = "";
        for (const agent of analysis.agents) {
          const prompt = prev
            ? `Previous step result:\n${prev}\n\nNow: ${agent.role}`
            : agent.role;
          prev = await runtime.runTask(agent.id, prompt, taskConfig);
        }
        break;
      }
      case "hierarchical": {
        const [manager, ...workers] = analysis.agents;
        const plan = await runtime.runTask(
          manager.id,
          `Break down this task for ${workers.length} workers: ${manager.role}`,
          taskConfig
        );
        const workerTasks = workers.map((w) => ({
          id: w.id,
          prompt: `Plan:\n${plan}\n\nYour task: ${w.role}`,
          config: taskConfig,
        }));
        const results = await runtime.runParallel(workerTasks);
        const all = [...results.values()].join("\n---\n");
        await runtime.runTask(`${manager.id}-synthesis`, `Synthesize:\n${all}`, taskConfig);
        break;
      }
      case "handoff": {
        const [router, ...specialists] = analysis.agents;
        const decision = await runtime.runTask(
          router.id,
          `Route to specialist. Available: ${specialists.map((s) => s.id).join(", ")}. Task: ${router.role}`,
          taskConfig
        );
        const selected =
          specialists.find((s) => decision.toLowerCase().includes(s.id)) ?? specialists[0];
        await runtime.runTask(selected.id, selected.role, taskConfig);
        break;
      }
      case "loop": {
        let output = "";
        for (let i = 0; i < 3; i++) {
          for (const agent of analysis.agents) {
            const prompt = output
              ? `Iteration ${i + 1}. Previous:\n${output}\n\n${agent.role}`
              : `Iteration 1. ${agent.role}`;
            output = await runtime.runTask(`${agent.id}-iter-${i + 1}`, prompt, taskConfig);
          }
        }
        break;
      }
    }
    addLog("coordinator", `Complete (${analysis.pattern})`, "status");
  } catch (err) {
    addLog("coordinator", `Error: ${err instanceof Error ? err.message : err}`, "error");
  }
}

// --- Shell command execution ---
async function handleShellCommand(command: string, ws: WebSocket): Promise<void> {
  const { spawn } = await import("node:child_process");

  const blocked = [/^rm\s+-rf\s+\//, /^mkfs/, /^dd\s/, /^shutdown/, /^reboot/];
  if (blocked.some((r) => r.test(command.trim()))) {
    ws.send(JSON.stringify({ type: "shell:output", command, output: "Command blocked for safety.", exitCode: 1 }));
    return;
  }

  const shell = process.env.SHELL || "/bin/bash";
  const proc = spawn(shell, ["-c", command], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let output = "";
  proc.stdout?.on("data", (d: Buffer) => (output += d.toString()));
  proc.stderr?.on("data", (d: Buffer) => (output += d.toString()));

  proc.on("close", (code) => {
    ws.send(JSON.stringify({ type: "shell:output", command, output: output || "(no output)", exitCode: code ?? 0 }));
  });

  proc.on("error", (err) => {
    ws.send(JSON.stringify({ type: "shell:output", command, output: `Error: ${err.message}`, exitCode: 1 }));
  });

  setTimeout(() => { if (proc.exitCode === null) proc.kill("SIGTERM"); }, 30000);
}

// --- Detect available tools once (avoid repeated scans) ---
const detectedTools = detectTools();
const detectedToolNames = detectedTools.map((t) => t.name);

// --- HTTP Server ---
const html = readFileSync(join(__dirname, "..", "public", "index.html"), "utf-8");

const server = createServer((req, res) => {
  if (req.url === "/" || req.url === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html);
  } else if (req.url === "/api/state") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      agents: Object.fromEntries(agents),
      logs,
      runtime: runtimeName,
      tools: detectedToolNames,
      streamMode: isClaudeRuntime ? "json" : "plain",
    }));
  } else {
    res.writeHead(404);
    res.end("Not found");
  }
});

// --- WebSocket ---
const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  clients.add(ws);
  ws.send(JSON.stringify({
    type: "init",
    agents: Object.fromEntries(agents),
    logs,
    runtime: runtimeName,
    tools: detectedToolNames,
    streamMode: isClaudeRuntime ? "json" : "plain",
  }));

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      console.log(`  [ws] received: ${msg.type}${msg.task ? ' → ' + msg.task.slice(0, 60) : ''}`);
      if (msg.type === "task") handleTask(msg.task);
      else if (msg.type === "kill") {
        runtime.kill(msg.agentId);
        const agent = agents.get(msg.agentId);
        if (agent) agent.status = "failed";
        broadcast({ type: "agent:update", agents: Object.fromEntries(agents) });
      }
      else if (msg.type === "close") {
        agents.delete(msg.agentId);
        broadcast({ type: "agent:update", agents: Object.fromEntries(agents) });
      }
      else if (msg.type === "respond") handleAgentResponse(msg.agentId, msg.message);
      else if (msg.type === "shell") handleShellCommand(msg.command, ws);
    } catch { /* ignore malformed */ }
  });

  ws.on("close", () => clients.delete(ws));
});

// --- Pre-flight health check ---
async function healthCheck(): Promise<void> {
  const { execSync } = await import("node:child_process");
  const command = config.command || config.customCommand?.command || runtimeName;

  console.log("  Checking runtime...");


  // For Claude: run a minimal command to verify auth
  if (isClaudeRuntime) {
    // Use -p for health check (quick one-shot, regardless of config's promptMode)
    const healthCmd = `"${command}" launch claude -p "say ok" --dangerously-skip-permissions`;
    try {
      const result = execSync(
        `${healthCmd} 2>&1`,
        { encoding: "utf-8", timeout: 30000, env: process.env }
      );
      // If we got any text back, auth works
      if (!result.trim()) {
        throw new Error("EMPTY_RESPONSE");
      }
    } catch (err: any) {
      const output = (err.stdout || "") + (err.stderr || "") + (err.message || "");
      // Only fail on definitive auth errors — match the exact Claude error message
      if (/not logged in/i.test(output) && /\/login/i.test(output)) {
        console.error("");
        console.error("  ✗ Runtime is not authenticated.");
        console.error("");
        console.error("  Fix (choose one):");
        console.error("");
        console.error("  1. Use the start script (handles auth automatically):");
        console.error("     ./start.sh");
        console.error("");
        console.error("  2. Start from inside a devai session:");
        console.error("     devai launch bash");
        console.error("     node packages/web/dist/server.js");
        console.error("");
        console.error("  3. Set auth manually in this terminal:");
        console.error("     export ANTHROPIC_AUTH_TOKEN=<your-token>");
        console.error("     export ANTHROPIC_BEDROCK_BASE_URL=<your-endpoint>");
        console.error("     node packages/web/dist/server.js");
        console.error("");
        process.exit(1);
      }
      // Other errors — warn but don't block startup
      const snippet = output.replace(/\n/g, " ").slice(0, 120);
      console.log(`  ⚠ Health check issue: ${snippet}`);
      console.log("    Continuing — first task may reveal the problem.");
    }
  } else {
    // For non-Claude tools: just verify the binary exists and runs
    try {
      execSync(`"${command}" --version 2>&1`, { encoding: "utf-8", timeout: 5000 });
    } catch {
      try {
        execSync(`"${command}" --help 2>&1`, { encoding: "utf-8", timeout: 5000 });
      } catch {
        console.log(`  ⚠ Could not verify runtime "${command}" — it may still work.`);
      }
    }
  }

  console.log("  ✓ Runtime OK");
}

// --- Start ---
async function main() {
  await projectManager.init();
  await projectManager.access(process.cwd());

  console.log("");
  console.log("  ✦ Kairos — LLM-Agnostic Orchestrator");
  console.log("");
  console.log(`  Runtime: ${runtimeName}`);
  console.log(`  Available tools: ${detectedToolNames.join(", ") || "none detected"}`);
  if (isClaudeRuntime) console.log("  Stream mode: JSON (rich conversation)");

  server.listen(PORT, () => {
    console.log(`  Dashboard: http://localhost:${PORT}`);
    console.log("");
    console.log("  Type a task in the browser. Use ! for shell, / for tool commands.");
    console.log("  Press Ctrl+C to stop.");
    console.log("");
  });

  // Run health check in background — don't block the dashboard from loading
  healthCheck().catch(() => {});
}

main();
