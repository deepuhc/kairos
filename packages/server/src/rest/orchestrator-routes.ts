import type { Express, Request, Response } from 'express';
import { AGENT_ROLES } from '@kairos/personas';
import { readState } from '../orchestrator/state.js';

// Read-only REST surface for the orchestrator activity view (Item 5). Two GETs:
//
//   GET /api/orchestrator/state — the current run's machine state (phases, per-
//     phase status/liveness/last-activity, blocked reasons). Read straight from
//     ~/.kairos/orchestrator-state.json, so it reflects whatever the coordinator
//     last committed even across a server restart. The `seq` lets the UI tell it
//     missed an update and refetch. Empty/idle when no run has started.
//
//   GET /api/orchestrator/roles — the static persona catalog + dependency DAG, so
//     the activity view can render the pipeline graph (nodes, edges, icons, the
//     artifact each role owns) without hardcoding it.
//
// Live transitions push over the /events bus (orchestrator:* events); these REST
// reads are the initial snapshot + reconnect fallback. Mounted BEFORE the stub
// catch-all so they win over the 501.

async function getState(_req: Request, res: Response): Promise<void> {
  res.json(await readState());
}

function getRoles(_req: Request, res: Response): void {
  // Expose only the fields the activity view needs — not the full system prompts.
  res.json({
    roles: AGENT_ROLES.map((r) => ({
      id: r.id,
      name: r.name,
      icon: r.icon,
      description: r.description,
      modelTier: r.modelTier,
      dependsOn: r.dependsOn,
      supervisorRole: r.supervisorRole ?? false,
      artifact: { path: r.artifact.path, label: r.artifact.label },
    })),
  });
}

/**
 * Register the read-only orchestrator routes. Mount BEFORE registerStubRoutes so
 * these handlers win over the 501 catch-all.
 */
export function registerOrchestratorRoutes(app: Express): void {
  app.get('/api/orchestrator/state', getState);
  app.get('/api/orchestrator/roles', getRoles);
}
