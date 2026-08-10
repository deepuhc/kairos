// Browser-tab notifications for the Agents tab.
//
// When an agent finishes a turn or needs input while the user is looking away
// (another browser tab, or a different devai view), we raise two cues on the
// tab itself: a colored dot drawn onto the favicon, and a short Web Audio chime.
// "Needs input" (ask) outranks "done" for the badge, since it's the one that
// blocks progress. The chime always reflects the incoming event.
//
// Sound is mutable and the preference persists; the favicon badge is silent and
// always shown. All browser access is lazy (inside functions) so the module can
// be imported in a plain Node test to exercise the pure precedence logic.

export type Attention = 'done' | 'ask';

const MUTE_KEY = 'kairos-agents:notify-muted';
const ORIGINAL_FAVICON = '/favicon.svg';

// Badge fill per level. Emerald reads as "complete"; amber as "needs you" — both
// stand out against the purple sparkle favicon. Mirrors the sidebar dot colors.
const BADGE_COLORS: Record<Attention, string> = { done: '#34d399', ask: '#f59e0b' };

// Higher rank wins the badge when multiple events are outstanding.
export function rankAttention(level: Attention | null): number {
  return level === 'ask' ? 2 : level === 'done' ? 1 : 0;
}

// The badge that should show given the current one and an incoming event.
export function nextAttention(current: Attention | null, incoming: Attention): Attention {
  return rankAttention(incoming) > rankAttention(current) ? incoming : (current as Attention);
}

let current: Attention | null = null;
let audioCtx: AudioContext | null = null;
let faviconText: string | null = null;
let faviconFetch: Promise<string | null> | null = null;

export function isMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setMuted(muted: boolean) {
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch { /* quota / disabled — ignore */ }
}

// Raise the favicon badge (ask beats done) and chime for this event, unless muted.
export function notify(level: Attention) {
  const next = nextAttention(current, level);
  if (next !== current) {
    current = next;
    void paintBadge(current);
  }
  if (!isMuted()) playChime(level);
}

// User is looking again — drop the badge.
export function clearNotification() {
  if (current === null) return;
  current = null;
  void paintBadge(null);
}

// ── Favicon badge ─────────────────────────────────────────────────────────────
function findFaviconLink(): HTMLLinkElement {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.appendChild(link);
  }
  return link;
}

// Fetch the real favicon once so the badge overlays the actual logo rather than
// replacing it. Cached; failure just disables the badge (the chime still fires).
function loadFaviconText(): Promise<string | null> {
  if (faviconText != null) return Promise.resolve(faviconText);
  if (!faviconFetch) {
    faviconFetch = fetch(ORIGINAL_FAVICON)
      .then((r) => (r.ok ? r.text() : null))
      .then((t) => { faviconText = t; return t; })
      .catch(() => null);
  }
  return faviconFetch;
}

async function paintBadge(level: Attention | null) {
  const link = findFaviconLink();
  if (!level) { link.href = ORIGINAL_FAVICON; return; }
  const svg = await loadFaviconText();
  if (!svg) return; // logo unavailable — the chime already carried the cue
  // Bottom-right dot with a dark ring so it stays legible over the gradient.
  const badge = `<circle cx="384" cy="384" r="124" fill="${BADGE_COLORS[level]}" stroke="#0b0b12" stroke-width="24"/>`;
  const out = svg.replace('</svg>', `${badge}</svg>`);
  link.href = `data:image/svg+xml,${encodeURIComponent(out)}`;
}

// ── Chime ───────────────────────────────────────────────────────────────────
function ensureCtx(): AudioContext | null {
  try {
    const Ctor = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) return null;
    if (!audioCtx) audioCtx = new Ctor();
    if (audioCtx.state === 'suspended') void audioCtx.resume();
    return audioCtx;
  } catch {
    return null;
  }
}

// One soft sine blip with a click-free attack/decay envelope.
function blip(ctx: AudioContext, freq: number, start: number, dur: number, peak = 0.14) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  osc.connect(gain);
  gain.connect(ctx.destination);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.linearRampToValueAtTime(peak, start + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

// Done → a gentle rising two-note (E5 → B5). Ask → a quicker same-pitch double
// ping, so the two are tellable apart without looking.
function playChime(level: Attention) {
  const ctx = ensureCtx();
  if (!ctx) return;
  const t = ctx.currentTime;
  if (level === 'done') {
    blip(ctx, 659.25, t, 0.13);
    blip(ctx, 987.77, t + 0.14, 0.2);
  } else {
    blip(ctx, 880, t, 0.1);
    blip(ctx, 880, t + 0.17, 0.14);
  }
}
