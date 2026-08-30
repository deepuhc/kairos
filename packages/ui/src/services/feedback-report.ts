import { KAIROS_VERSION } from './app-version.js';
import { recentErrors, type LoggedError } from './feedback-log.js';

// Builds a single, paste-ready feedback report: the user's message plus the
// environment, provider diagnostics, and recent client errors needed to fix the
// problem from another machine. The whole point of the feedback loop is that a
// tester on Mac B copies this block and pastes it back — so it must be
// self-contained, plain text, and carry no secrets.

export interface FeedbackContext {
  version: string;
  mode: string;
  view: string;
  userAgent: string;
  url: string;
  /** Whatever GET /api/providers/diagnostics returned, or an error note. */
  diagnostics: unknown;
  errors: LoggedError[];
}

/** A provider entry as it appears in the diagnostics payload. */
interface DiagProvider {
  name: string;
  isLocal?: boolean;
  endpoint?: string;
  reachable?: boolean;
  modelCount?: number;
  visionModels?: string[];
}

/** Gather the environment context that accompanies a feedback message. */
export async function collectFeedbackContext(opts: {
  mode: string;
  view: string;
  fetchImpl?: typeof fetch;
  win?: Partial<Window> & { navigator?: { userAgent?: string }; location?: { href?: string } };
}): Promise<FeedbackContext> {
  const win = opts.win ?? (globalThis as never);
  const fetchImpl = opts.fetchImpl ?? (globalThis as { fetch?: typeof fetch }).fetch;

  let diagnostics: unknown;
  try {
    if (!fetchImpl) throw new Error('no fetch available');
    const res = await fetchImpl('/api/providers/diagnostics', { credentials: 'same-origin' });
    diagnostics = res.ok ? await res.json() : { error: `diagnostics HTTP ${res.status}` };
  } catch (err) {
    diagnostics = { error: err instanceof Error ? err.message : String(err) };
  }

  return {
    version: KAIROS_VERSION,
    mode: opts.mode,
    view: opts.view,
    userAgent: win.navigator?.userAgent ?? 'unknown',
    url: win.location?.href ?? 'unknown',
    diagnostics,
    errors: recentErrors(),
  };
}

/** ISO-ish timestamp without pulling in a date lib; UTC, second precision. */
function stamp(ms: number): string {
  if (!ms) return 'unknown';
  return new Date(ms).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

function renderDiagnostics(diagnostics: unknown): string {
  const d = diagnostics as {
    error?: string;
    configPath?: string;
    configLoaded?: boolean;
    ollamaHostEnv?: string | null;
    providers?: DiagProvider[];
  };
  if (!d || d.error) return `  (diagnostics unavailable: ${d?.error ?? 'unknown'})`;

  const lines: string[] = [];
  lines.push(`  configPath: ${d.configPath ?? 'unknown'} (loaded: ${d.configLoaded ?? false})`);
  lines.push(`  OLLAMA_HOST: ${d.ollamaHostEnv ?? '(unset)'}`);
  for (const p of d.providers ?? []) {
    const vision = p.visionModels?.length ? `, vision: ${p.visionModels.join(', ')}` : '';
    lines.push(
      `  - ${p.name} [${p.isLocal ? 'local' : 'cloud'}] ${p.endpoint ?? ''} ` +
        `reachable=${p.reachable} models=${p.modelCount ?? 0}${vision}`,
    );
  }
  return lines.join('\n');
}

function renderErrors(errors: LoggedError[]): string {
  if (!errors.length) return '  (none captured)';
  return errors
    .map((e) => `  [${stamp(e.at)}] ${e.kind}: ${e.message}${e.detail ? `\n      ${e.detail}` : ''}`)
    .join('\n');
}

/**
 * Render the full report as plain text. `message` is the tester's own words;
 * everything else is auto-collected context. Designed to be pasted verbatim.
 */
export function formatFeedbackReport(message: string, ctx: FeedbackContext): string {
  const body = message.trim() || '(no message provided)';
  return [
    '===== KAIROS FEEDBACK =====',
    `When: ${stamp(ctx.errors.length ? ctx.errors[ctx.errors.length - 1].at : nowSafe())}`,
    `Version: ${ctx.version}   Mode: ${ctx.mode}   View: ${ctx.view}`,
    `URL: ${ctx.url}`,
    `UA: ${ctx.userAgent}`,
    '',
    '--- Message ---',
    body,
    '',
    '--- Providers / diagnostics ---',
    renderDiagnostics(ctx.diagnostics),
    '',
    '--- Recent client errors ---',
    renderErrors(ctx.errors),
    '===========================',
  ].join('\n');
}

function nowSafe(): number {
  return typeof Date.now === 'function' ? Date.now() : 0;
}
