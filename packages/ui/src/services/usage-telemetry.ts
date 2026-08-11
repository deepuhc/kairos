import { KAIROS_VERSION } from './app-version.js';

export type UsageClientKind = 'desktop' | 'browser';

export interface UsagePingPayload {
  client_kind: UsageClientKind;
  kairos_version?: string;
  interaction: true;
}

interface RuntimeDocument {
  visibilityState?: DocumentVisibilityState;
  hasFocus?: () => boolean;
  addEventListener?: Document['addEventListener'];
  removeEventListener?: Document['removeEventListener'];
}

interface RuntimeWindow {
  __TAURI_INTERNALS__?: unknown;
  location?: Pick<Location, 'protocol' | 'hostname'>;
  document?: RuntimeDocument;
}

const INTERACTION_PING_MIN_INTERVAL_MS = 5 * 60_000;
const ACTIVITY_EVENTS = ['click', 'keydown'] as const;

function isVisible(win: RuntimeWindow): boolean {
  return win.document?.visibilityState !== 'hidden';
}

function hasFocus(win: RuntimeWindow): boolean {
  return win.document?.hasFocus?.() ?? true;
}

function isTypingKey(event: KeyboardEvent): boolean {
  if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return false;
  return event.key.length === 1 || event.key === 'Backspace' || event.key === 'Delete' || event.key === 'Enter';
}

export function installUsageActivityTracking(
  onInteraction: () => void,
  win: RuntimeWindow = window,
  now = Date.now,
): () => void {
  const doc = win.document;
  let lastSentAt = Number.NEGATIVE_INFINITY;
  const mark = (event: Event) => {
    if (!isVisible(win) || !hasFocus(win)) return;
    if (event.type === 'keydown' && !isTypingKey(event as KeyboardEvent)) return;
    const current = now();
    if (current - lastSentAt < INTERACTION_PING_MIN_INTERVAL_MS) return;
    lastSentAt = current;
    onInteraction();
  };

  for (const event of ACTIVITY_EVENTS) {
    doc?.addEventListener?.(event, mark, { passive: true, capture: true });
  }

  return () => {
    for (const event of ACTIVITY_EVENTS) {
      doc?.removeEventListener?.(event, mark, { capture: true });
    }
  };
}

export function usagePingPayload(win: RuntimeWindow = window): UsagePingPayload {
  const isDesktop = Boolean(win.__TAURI_INTERNALS__)
    || win.location?.protocol === 'tauri:'
    || win.location?.hostname === 'tauri.localhost';

  return isDesktop
    ? { client_kind: 'desktop', kairos_version: KAIROS_VERSION, interaction: true }
    : { client_kind: 'browser', interaction: true };
}
