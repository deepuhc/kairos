import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { AgentPool } from '@kairos/agents';
import { ProviderRegistry, SmartRouter } from '@kairos/providers';
import { PipelineEngine, parsePlan } from '@kairos/orchestrator';
import type { PhaseDefinition, ExecutionContext } from '@kairos/orchestrator';
import { WebSocketHub } from './ws/hub.js';
import type { ClientMessage } from './ws/protocol.js';
import { AcpServer } from './acp/server.js';
import { ProviderAcpAgent } from './acp/provider-agent.js';
import { SessionStore } from './acp/session-store.js';
import { StdioAcpAgent } from './acp/stdio-bridge.js';
import { ChildProcessIo } from './acp/child-process-io.js';
import { resolveLaunchSpec, EXTERNAL_AGENT_IDS } from './acp/launch-spec.js';
import { isOnPath } from './acp/which.js';
import { EventBus } from './events/bus.js';
import { registerStubRoutes } from './rest/stub-routes.js';
import { buildAgentCatalog } from './rest/agent-catalog.js';

const PORT = parseInt(process.env.PORT || '3333', 10);
const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(express.json());

// Serve the UI if built
const uiDist = join(__dirname, '..', '..', 'ui', 'dist');
if (existsSync(uiDist)) {
  app.use(express.static(uiDist));
}

// --- Services ---
// Enable the in-memory mock provider when explicitly requested (KAIROS_MOCK) or
// when no real provider credentials are present, so the app runs end-to-end
// out of the box with deterministic, network-free responses.
const hasRealProviderCreds = Boolean(
  process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY,
);
const mockEnabled =
  process.env.KAIROS_MOCK === '0' ? false
  : process.env.KAIROS_MOCK === '1' ? true
  : !hasRealProviderCreds;
const registry = new ProviderRegistry({ mock: mockEnabled });
const router = new SmartRouter(registry);
if (mockEnabled) {
  console.log('  [mock] MockProvider enabled — responses are simulated (set KAIROS_MOCK=0 with real API keys to disable)');
}
const pool = new AgentPool();
const pipelines = new Map<string, PipelineEngine>();

// --- REST API ---
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', agents: pool.size, connections: hub?.connectionCount || 0 });
});

app.get('/api/providers', async (_req, res) => {
  const available = await registry.discoverAvailable();
  const results = await Promise.all(
    available.map(async (p) => ({
      name: p.name,
      isLocal: p.isLocal,
      models: await p.listModels(),
    }))
  );
  res.json(results);
});

// The UI's agent picker (getAgents → AgentOption[]) needs the *selectable*
// agent catalog, not the list of running processes. Any agent id here can be
// connected on /acp, where ProviderAcpAgent serves it through the router. When
// the mock provider is active we expose a "mock" agent so the Agents tab works
// end-to-end with no real CLI installed.
app.get('/api/agents', async (_req, res) => {
  // Every available provider (plus the mock when active) is a connectable /acp
  // agent. Without this the picker is empty whenever the mock is off, even
  // though the router would serve a real provider on /acp.
  const available = await registry.discoverAvailable();
  const providers = available.map((p) => p.name);
  // External stdio CLI agents (e.g. "claude"). `installed` reflects whether the
  // resolved launch command is on PATH so the picker can show an uninstalled
  // backend as unavailable instead of offering a connect that fails to spawn.
  const externalAgents = EXTERNAL_AGENT_IDS.map((id) => ({
    id,
    installed: isOnPath(resolveLaunchSpec(id).command),
  }));
  res.json({ agents: buildAgentCatalog({ mockEnabled, providers, externalAgents }) });
});

// Running agent processes (distinct from the selectable catalog above).
app.get('/api/agents/running', (_req, res) => {
  res.json(pool.list());
});

app.get('/api/pipelines', (_req, res) => {
  const states = [...pipelines.entries()].map(([id, engine]) => ({
    ...engine.getState(),
    id,
    phases: Object.fromEntries(engine.getState().phases),
  }));
  res.json(states);
});

// Phase-C REST stubs: boot-critical GET defaults + a 501 { unsupported: true }
// catch-all for every other /api route. Registered after the real /api routes
// so real handlers win, and before the SPA fallback so it only catches /api.
registerStubRoutes(app);

// SPA fallback
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path === '/ws') return next();
  const indexPath = join(uiDist, 'index.html');
  if (existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(200).json({ message: 'Kairos server running. UI not built yet — run: npm run build -w packages/ui' });
  }
});

// --- HTTP Server + WebSocket ---
const server = createServer(app);
const hub = new WebSocketHub();

// ACP JSON-RPC transport on /acp. Every connection is served by a
// ProviderAcpAgent that drives prompts through the shared SmartRouter, so the
// UI's Agents tab runs the full registry → router → provider → session/update
// path. With the mock provider enabled (no real creds) the replies are
// deterministic and network-free; wiring a real provider needs no change here.
// One session store shared by every per-connection agent, so session/load
// (resume) recovers real history and session ids stay unique process-wide.
const sessions = new SessionStore();

// Provider-backed agent ids are served in-process by ProviderAcpAgent (registry
// → router → provider). Any other id (e.g. "claude") is an external ACP CLI
// spawned over stdio via StdioAcpAgent — the adapter process speaks JSON-RPC
// and we transparently proxy it to the browser. The launch command is a config
// seam (resolveLaunchSpec): the product runs Claude Code directly; local testing
// can go through `devai launch` with KAIROS_ACP_USE_DEVAI=1.
const PROVIDER_AGENT_IDS = new Set(['mock', 'anthropic', 'openai', 'gemini', 'ollama']);
const acpServer = new AcpServer({
  createAgent: ({ agentId, cwd }) => {
    if (PROVIDER_AGENT_IDS.has(agentId)) {
      return new ProviderAcpAgent({ router, sessions });
    }
    const spec = resolveLaunchSpec(agentId);
    return new StdioAcpAgent(new ChildProcessIo(spec, cwd));
  },
});

// The `/events` fan-out bus — a plain one-way {event,data} publish stream the
// UI's EventSocket consumes (auth:changed, output:<id>, done:<id>, …). Without
// a server-side endpoint the shipped UI would reconnect-loop this socket every
// second forever. Publish-only; see events/bus.ts.
const eventBus = new EventBus();

// Central upgrade router: dispatch by path so /ws (hub) and /acp (ACP) coexist
// on one http.Server. A noServer WSS per path — a path-bound WSS would destroy
// the other's upgrades with a 400.
server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url ?? '', 'http://localhost');
  if (pathname === '/ws') {
    hub.handleUpgrade(req, socket, head);
  } else if (pathname === '/acp') {
    acpServer.handleUpgrade(req, socket, head);
  } else if (pathname === '/events') {
    eventBus.handleUpgrade(req, socket, head);
  } else {
    socket.destroy();
  }
});

hub.onMessage(async (ws, msg: ClientMessage) => {
  switch (msg.type) {
    case 'agent:spawn': {
      const id = `agent_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      try {
        const agent = pool.spawn({
          id,
          command: msg.config.command,
          args: msg.config.args,
          workingDirectory: msg.config.workingDirectory,
          model: msg.config.model,
          provider: msg.config.provider,
        });

        agent.onOutput((chunk) => hub.broadcast({ type: 'agent:output', agentId: id, chunk }));
        agent.onStatus((status) => hub.broadcast({ type: 'agent:status', agentId: id, status }));
        agent.onExit((code) => hub.broadcast({ type: 'agent:exit', agentId: id, code }));

        hub.broadcast({ type: 'agent:spawned', agentId: id, config: msg.config });
      } catch (err) {
        hub.sendTo(ws, { type: 'error', message: `Failed to spawn agent: ${err}` });
      }
      break;
    }

    case 'agent:kill': {
      pool.kill(msg.agentId);
      break;
    }

    case 'prompt': {
      const agent = pool.get(msg.agentId);
      if (!agent) {
        hub.sendTo(ws, { type: 'error', message: `Agent ${msg.agentId} not found` });
        return;
      }
      agent.send(msg.text);
      break;
    }

    case 'pipeline:start': {
      const definition = parsePlan(msg.plan, msg.name);
      const engine = new PipelineEngine(definition, {
        async execute(phase: PhaseDefinition, _context: ExecutionContext) {
          // Route the phase through the shared SmartRouter instance (privacy →
          // budget → preference → complexity selection) rather than reaching
          // into a provider directly.
          const result = await router.complete(
            [{ role: 'user', content: phase.prompt || `Execute task: ${phase.id}` }],
          );
          return result.content;
        },
      });

      pipelines.set(engine.getState().id, engine);

      engine.on('event', (event) => {
        hub.broadcast({ type: 'pipeline:event', pipelineId: engine.getState().id, event });
      });

      engine.on('gate', ({ phaseId, message }) => {
        hub.broadcast({ type: 'pipeline:gate', pipelineId: engine.getState().id, phaseId, message });
      });

      engine.on('status', () => {
        const state = engine.getState();
        hub.broadcast({
          type: 'pipeline:state',
          pipelineId: state.id,
          state: { ...state, phases: Object.fromEntries(state.phases) },
        });
      });

      engine.run().catch((err) => {
        hub.broadcast({ type: 'error', message: `Pipeline failed: ${err}` });
      });
      break;
    }

    case 'pipeline:cancel': {
      const engine = pipelines.get(msg.pipelineId);
      if (engine) engine.cancel();
      break;
    }

    case 'gate:decide': {
      const engine = pipelines.get(msg.pipelineId);
      if (engine) engine.approveGate(msg.phaseId, msg.approved, msg.reason);
      break;
    }
  }
});

// --- Send init state on new connections ---
const origOnMessage = hub.onMessage.bind(hub);
const wss = (hub as any).wss;
wss?.on('connection', async (ws: any) => {
  const available = await registry.discoverAvailable();
  const providers = await Promise.all(
    available.map(async (p) => ({ name: p.name, available: true, models: await p.listModels() }))
  );
  hub.sendTo(ws, { type: 'init', agents: pool.list(), providers });
});

// --- Start ---
server.listen(PORT, () => {
  console.log(`\n  Kairos server running at http://localhost:${PORT}`);
  console.log(`  WebSocket at ws://localhost:${PORT}/ws`);
  console.log(`  ACP transport at ws://localhost:${PORT}/acp`);
  console.log(`  API at http://localhost:${PORT}/api/health\n`);
});
