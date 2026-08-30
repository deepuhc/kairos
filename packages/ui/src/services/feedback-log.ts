// A tiny in-memory ring buffer of recent client-side errors, so a feedback
// report can include "what went wrong just before I hit send" without any
// external logging service. Installed once at startup; capped so it can't grow
// unbounded. Node-env safe (guards window/console) for unit tests.

export interface LoggedError {
  /** ms since epoch when captured. */
  at: number;
  /** 'error' (window.onerror / unhandledrejection) or 'console'. */
  kind: 'error' | 'console';
  message: string;
  /** Optional stack or source location, already trimmed. */
  detail?: string;
}

const MAX_ENTRIES = 25;
const buffer: LoggedError[] = [];
let installed = false;

/** Record an error into the ring buffer, evicting the oldest when full. */
export function recordError(kind: LoggedError['kind'], message: string, detail?: string): void {
  const trimmed = message.trim();
  if (!trimmed) return;
  buffer.push({
    at: typeof Date.now === 'function' ? Date.now() : 0,
    kind,
    message: trimmed.slice(0, 500),
    detail: detail?.trim().slice(0, 1000) || undefined,
  });
  while (buffer.length > MAX_ENTRIES) buffer.shift();
}

/** A copy of the buffered errors, oldest first. */
export function recentErrors(): LoggedError[] {
  return buffer.slice();
}

/** Clear the buffer (used by tests). */
export function clearErrors(): void {
  buffer.length = 0;
}

/**
 * Hook window error events and console.error so feedback reports capture recent
 * failures automatically. Idempotent and safe to call when there is no window
 * (e.g. under the node test env, where it no-ops).
 */
export function installErrorCapture(win: typeof globalThis & Partial<Window> = globalThis as never): void {
  if (installed) return;
  installed = true;

  if (typeof win.addEventListener === 'function') {
    win.addEventListener('error', (e: unknown) => {
      const ev = e as { message?: string; filename?: string; lineno?: number; colno?: number };
      const where = ev.filename ? `${ev.filename}:${ev.lineno ?? 0}:${ev.colno ?? 0}` : undefined;
      recordError('error', ev.message || 'Uncaught error', where);
    });
    win.addEventListener('unhandledrejection', (e: unknown) => {
      const reason = (e as { reason?: unknown }).reason;
      const message = reason instanceof Error ? reason.message : String(reason ?? 'Unhandled rejection');
      const detail = reason instanceof Error ? reason.stack : undefined;
      recordError('error', `Unhandled promise rejection: ${message}`, detail);
    });
  }

  const c = (win as { console?: Console }).console;
  if (c && typeof c.error === 'function') {
    const original = c.error.bind(c);
    c.error = (...args: unknown[]) => {
      try {
        recordError('console', args.map((a) => stringifyArg(a)).join(' '));
      } catch {
        // Never let capture break the real console.error.
      }
      original(...args);
    };
  }
}

function stringifyArg(a: unknown): string {
  if (a instanceof Error) return `${a.name}: ${a.message}`;
  if (typeof a === 'string') return a;
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}
