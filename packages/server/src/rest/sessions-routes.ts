import type { Express, Request, Response } from 'express';
import {
  mutateOverrides,
  applyRename,
  applyPin,
  applyUnpin,
  applyPinnedOrder,
} from './session-overrides.js';

// Real session-mutation routes: rename / pin / unpin / pinned-order. Before this
// the whole /api/sessions/* mutation family fell through to the 501 catch-all,
// so the UI's inline rename (agents-sidebar.ts commitRename → renameSession) threw
// on the 501, its catch swallowed it, and the title never changed. These persist
// to ~/.kairos/session-overrides.json so a rename/pin survives restarts. Mount
// BEFORE registerStubRoutes so these win over the catch-all.
//
// The session *history* itself is owned by the CLI and read-only to us, so titles
// and pins live in a side file and are merged onto the listing on read.

async function rename(req: Request, res: Response): Promise<void> {
  const { id, name } = req.body ?? {};
  if (typeof id !== 'string' || !id) { res.status(400).json({ error: 'id is required' }); return; }
  if (typeof name !== 'string') { res.status(400).json({ error: 'name must be a string' }); return; }
  await mutateOverrides((o) => applyRename(o, id, name));
  res.json({ success: true });
}

async function pin(req: Request, res: Response): Promise<void> {
  const { id } = req.body ?? {};
  if (typeof id !== 'string' || !id) { res.status(400).json({ error: 'id is required' }); return; }
  await mutateOverrides((o) => applyPin(o, id));
  res.json({ success: true });
}

async function unpin(req: Request, res: Response): Promise<void> {
  const { id } = req.body ?? {};
  if (typeof id !== 'string' || !id) { res.status(400).json({ error: 'id is required' }); return; }
  await mutateOverrides((o) => applyUnpin(o, id));
  res.json({ success: true });
}

async function pinnedOrder(req: Request, res: Response): Promise<void> {
  const { ids } = req.body ?? {};
  if (!Array.isArray(ids) || ids.some((x) => typeof x !== 'string')) {
    res.status(400).json({ error: 'ids must be an array of strings' }); return;
  }
  await mutateOverrides((o) => applyPinnedOrder(o, ids));
  res.json({ success: true });
}

/**
 * Register the real session-mutation routes. Mount BEFORE registerStubRoutes so
 * these handlers win over the 501 catch-all.
 */
export function registerSessionRoutes(app: Express): void {
  app.post('/api/sessions/rename', rename);
  app.post('/api/sessions/pin', pin);
  app.post('/api/sessions/unpin', unpin);
  app.post('/api/sessions/pinned-order', pinnedOrder);
}
