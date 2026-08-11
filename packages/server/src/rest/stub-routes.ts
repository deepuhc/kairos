import type { Express, Request, Response } from 'express';

// Phase C of docs/transport-integration-spec.md: the UI (packages/ui/src/services/api.ts)
// makes ~94 REST calls across 20+ resource groups; the prototype server answers
// only a handful. This module makes the UI boot cleanly against the server by:
//
//  1. Serving boot-critical GET endpoints with empty-but-valid default shapes,
//     so views that fetch-on-connect render their empty state instead of erroring.
//  2. Registering a catch-all that returns an honest 501 `{ unsupported: true }`
//     for every other /api route. The UI's request() helper (api.ts) recognizes
//     the `unsupported` flag and degrades gracefully rather than hanging.
//
// As real features land, promote a route out of the stub set into a real
// implementation. Nothing here fabricates data — reads are empty, actions are
// explicitly unsupported.

type Handler = (req: Request, res: Response) => void;

// Boot-critical GETs → the empty/default response shape the UI type expects.
const READ_STUBS: Record<string, Handler> = {
  '/auth/status': (_q, r) => r.json({ loggedIn: false, user: null, gateway: null, expires: null }),
  '/auth/vault-status': (_q, r) => r.json({
    vaultPath: null, version: null, secrets: null, perms: null, slots: [],
    kekStatus: null, kekAccessible: false, hasPassphraseSlot: false,
  }),
  '/apps/list': (_q, r) => r.json([]),
  '/apps/status': (_q, r) => r.json({}),
  '/skills/list': (_q, r) => r.json([]),
  '/plugins/list': (_q, r) => r.json([]),
  '/system/version': (_q, r) => r.json({ version: process.env.KAIROS_VERSION ?? '2.0.0-dev' }),
  '/system/user': (_q, r) => r.json({ user: null }),
  '/system/ui-update': (_q, r) => r.json({ available: false }),
  '/system/self-update': (_q, r) => r.json({ available: false }),
  '/doctor/status': (_q, r) => r.json({ ok: true, checks: [] }),
  '/config/status': (_q, r) => r.json({
    username: null, configDir: null, projectConfig: null,
    profiles: [], userOverrides: 0, projectOverrides: 0,
  }),
  '/config/list': (_q, r) => r.json({ items: [] }),
  '/features/list': (_q, r) => r.json({ items: [] }),
  '/agents/roles': (_q, r) => r.json({ roles: [] }),
  '/agents/prompts': (_q, r) => r.json({ prompts: [] }),
  '/agents/global-rules': (_q, r) => r.json({ rules: '' }),
  '/agents/mcp': (_q, r) => r.json({ servers: [] }),
  '/agents/hooks': (_q, r) => r.json({ hooks: [] }),
  '/agents/custom': (_q, r) => r.json({ agents: [] }),
  '/agents/prefs': (_q, r) => r.json({
    prefs: { lastCwd: '', lastAgent: '', autoAccept: false, savedConfigs: {} },
  }),
  '/workspaces': (_q, r) => r.json({ workspaces: [], config: {}, warnings: [], sortBy: 'recent' }),
  '/sessions': (_q, r) => r.json({ sessions: [] }),
  '/worktrees': (_q, r) => r.json({ worktrees: [] }),
  '/checkpoints': (_q, r) => r.json({ checkpoints: [] }),
  '/usage': (_q, r) => r.json({ users: [] }),
  '/usage/access': (_q, r) => r.json({ allowed: false }),
  '/usage/presence': (_q, r) => r.json({ present: [], total: 0 }),
  '/usage/testimonials': (_q, r) => r.json({ testimonials: [] }),
};

/**
 * Register the Phase-C REST stubs. Call AFTER the real /api routes are mounted
 * so real implementations win; the catch-all must be registered LAST (before
 * the SPA fallback) so it only fires for unhandled /api paths.
 */
export function registerStubRoutes(app: Express): void {
  for (const [path, handler] of Object.entries(READ_STUBS)) {
    app.get(`/api${path}`, handler);
  }

  // Honest 501 for every other /api route. `unsupported: true` is the contract
  // the UI's request() helper checks to degrade gracefully.
  app.all('/api/*', (req, res) => {
    res.status(501).json({
      error: `Not implemented: ${req.method} ${req.path}`,
      unsupported: true,
    });
  });
}
