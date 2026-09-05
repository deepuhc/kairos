import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { AgentPool } from '@kairos/agents';
import { ProviderRegistry, SmartRouter } from '@kairos/providers';
import { PipelineEngine, parsePlan } from '@kairos/orchestrator';
import type { PhaseDefinition, ExecutionContext } from '@kairos/orchestrator';
import { WebSocketHub } from './ws/hub.js';
import type { ClientMessage } from './ws/protocol.js';
import { extractFileRequest } from './files/extract.js';
import { loadProvidersConfig, providersConfigPath } from './config/providers-config.js';
import { getUpdateStatus, applyUpdate, RESTART_EXIT_CODE } from './update.js';

const PORT = parseInt(process.env.PORT || '3333', 10);

// Where submitted feedback is written. Honors KAIROS_CONFIG_DIR (same knob the
// providers config uses) so a tester can redirect it; defaults to ~/.kairos.
function feedbackDir(): string {
  const base = process.env.KAIROS_CONFIG_DIR?.trim() || join(homedir(), '.kairos');
  return join(base, 'feedback');
}

// import.meta.url is undefined when this module is inlined into a CommonJS
// bundle (the packaged desktop server), so fall back to process.cwd(). The
// desktop bundle sets KAIROS_UI_DIST explicitly, so this fallback only affects
// the default UI-dist guess, never the packaged app's actual UI location.
const __dirname = import.meta.url
  ? dirname(fileURLToPath(import.meta.url))
  : process.cwd();

const app = express();
app.use(cors());
// Files arrive as base64 in the JSON body, so allow a larger payload than the
// 100kb default. 25mb of base64 ≈ an ~18mb source file.
app.use(express.json({ limit: '25mb' }));

// Serve the UI if built. In a source checkout the UI lives at
// packages/ui/dist relative to the server; in a packaged desktop bundle the
// server is a single file with no fixed sibling layout, so KAIROS_UI_DIST lets
// the Tauri shell point at the UI it shipped as a resource.
const uiDist = process.env.KAIROS_UI_DIST || join(__dirname, '..', '..', 'ui', 'dist');
if (existsSync(uiDist)) {
  app.use(express.static(uiDist));
}

// --- Services ---
// Provider endpoints come from ~/.kairos/providers.json when present, so a
// remote (homelab) Ollama or any OpenAI-compatible endpoint can be used without
// hardcoding a host. Missing/invalid config falls back to the built-in defaults
// (Ollama at localhost:11434, or $OLLAMA_HOST if set).
const providersConfig = loadProvidersConfig();
for (const warning of providersConfig.warnings) {
  console.warn(`  [providers] ${warning}`);
}
const registry = new ProviderRegistry(providersConfig.config);
const router = new SmartRouter(registry);
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

// Which provider endpoints are configured, and can we actually reach them?
// This is the connectivity check for a remote/homelab setup: it reports the
// resolved endpoint per provider plus a reachable flag and its model list.
app.get('/api/providers/diagnostics', async (_req, res) => {
  const providers = await Promise.all(
    registry.all.map(async (p) => {
      const reachable = await p.isAvailable();
      const models = reachable ? await p.listModels().catch(() => []) : [];
      return {
        name: p.name,
        isLocal: p.isLocal,
        // `endpoint` is exposed by providers that talk to a configurable host.
        endpoint: (p as { endpoint?: string }).endpoint,
        reachable,
        modelCount: models.length,
        models: models.map((m) => ({ id: m.id, capabilities: m.capabilities })),
        visionModels: models.filter((m) => m.capabilities?.includes('vision')).map((m) => m.id),
      };
    }),
  );
  res.json({
    configPath: providersConfigPath(),
    configLoaded: providersConfig.loaded,
    warnings: providersConfig.warnings,
    ollamaHostEnv: process.env.OLLAMA_HOST ?? null,
    providers,
  });
});

app.get('/api/agents', (_req, res) => {
  res.json(pool.list());
});

app.get('/api/pipelines', (_req, res) => {
  const states = [...pipelines.values()].map((engine) => ({
    ...engine.getState(),
    phases: Object.fromEntries(engine.getState().phases),
  }));
  res.json(states);
});

// Detect + extract an uploaded file. The client sends the file as base64 in the
// JSON body; extraction runs locally (no cloud upload) via @kairos/files.
app.post('/api/files/extract', async (req, res) => {
  // Pass the router so image uploads get enriched with a vision-model
  // description when a vision-capable provider is configured.
  const { status, body } = await extractFileRequest(req.body, { router });
  res.status(status).json(body);
});

// Persist a feedback report to ~/.kairos/feedback/ so there is a durable local
// copy regardless of how the tester relays it. Best-effort: a write failure
// still returns ok so the UI can fall back to copy/paste. The body is the
// already-formatted plain-text report from the UI plus the raw message.
app.post('/api/feedback', async (req, res) => {
  const body = (req.body ?? {}) as { report?: unknown; message?: unknown };
  const report = typeof body.report === 'string' ? body.report : '';
  if (!report.trim()) {
    res.status(400).json({ ok: false, error: 'Missing "report" text.' });
    return;
  }
  try {
    const dir = join(feedbackDir());
    mkdirSync(dir, { recursive: true });
    // Sortable, filesystem-safe filename; no Date parsing needed to read later.
    const name = `feedback-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
    const file = join(dir, name);
    writeFileSync(file, report, 'utf-8');
    console.log(`  [feedback] saved ${file}`);
    res.json({ ok: true, savedTo: file });
  } catch (err) {
    // Don't fail the tester's flow — they can still copy/paste the report.
    console.warn(`  [feedback] could not save: ${err instanceof Error ? err.message : String(err)}`);
    res.json({ ok: false, error: 'Could not save server-side; copy the report instead.' });
  }
});

// Is a newer commit available on the tracked branch? Reports supported:false
// when Kairos isn't running from a git clone (e.g. the packaged bundle), so the
// UI can hide the update affordance.
app.get('/api/update/status', async (_req, res) => {
  res.json(await getUpdateStatus());
});

// Apply a git-based self-update: fast-forward the clone, then ask the
// supervisor launcher to rebuild + restart by exiting with RESTART_EXIT_CODE.
// We respond to the client BEFORE exiting so it knows to start polling for the
// server to come back; the exit is deferred a beat so the response flushes.
app.post('/api/update/apply', async (_req, res) => {
  const result = await applyUpdate();
  res.json(result);
  if (result.ok && result.updated) {
    console.log(`  [update] ${result.message}`);
    // Give the HTTP response time to flush before the process exits.
    setTimeout(() => {
      server.close();
      process.exit(RESTART_EXIT_CODE);
    }, 250);
  }
});

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
const hub = new WebSocketHub(server);

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
        async execute(phase: PhaseDefinition, context: ExecutionContext) {
          // For now, use the provider directly for agent phases
          const selection = await (await import('@kairos/providers')).SmartRouter.prototype.selectModel.call(
            { registry, config: {} }, {}
          );
          if (!selection) throw new Error('No model available');

          const result = await selection.provider.complete(
            [{ role: 'user', content: phase.prompt || `Execute task: ${phase.id}` }],
            { model: selection.model.id }
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
  console.log(`  API at http://localhost:${PORT}/api/health\n`);
});
