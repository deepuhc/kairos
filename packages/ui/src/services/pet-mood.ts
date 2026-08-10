// The sidebar "pet" reflects the aggregate state of the session pool. This is
// the pure selector behind it: given the sessions and a celebration deadline,
// it returns a single mood. Kept free of Lit/DOM so it can be unit-tested and
// so the pet never contradicts the rest of the UI — the predicates mirror the
// ones the sidebar and beforeunload guard already use.

export type PetMood = 'sleeping' | 'idle' | 'working' | 'celebrating' | 'worried';

// The subset of AgentSession fields the mood depends on. Taking a structural
// type (not the full interface) keeps the helper testable with plain objects.
export interface PetSessionState {
  phase: 'ready' | 'thinking' | 'error';
  stalled: boolean;
  backgroundActive: number;
  loading: boolean;
  permission: unknown | null;
  elicitation: unknown | null;
  doneAt: number | null;
}

// A session with nothing happening for this long reads as "sleeping" rather
// than merely "idle" — long enough that a quick pause won't put the pet to bed.
const SLEEP_AFTER_MS = 3 * 60 * 1000;

function needsYou(s: PetSessionState): boolean {
  return s.permission !== null || s.elicitation !== null;
}

// A background task (run_in_background) outlives the prompt turn, so the session
// is still working after phase flips to 'ready' (matches agents-sidebar.ts).
function isWorking(s: PetSessionState): boolean {
  const bgOnly = s.phase === 'ready' && s.backgroundActive > 0 && !s.loading;
  return s.phase === 'thinking' || bgOnly;
}

// Precedence: worried > working > celebrating > idle/sleeping. Worried and
// working reflect live state and always win over a transient celebration.
export function petMoodFor(
  sessions: PetSessionState[],
  celebrateUntil: number,
  now: number,
): PetMood {
  if (sessions.some((s) => s.phase === 'error' || s.stalled || needsYou(s))) {
    return 'worried';
  }
  if (sessions.some(isWorking)) return 'working';
  if (celebrateUntil > now) return 'celebrating';
  if (sessions.length === 0) return 'sleeping';
  // Awake if anything finished recently; otherwise the pool is dozing.
  const lastActivity = sessions.reduce((max, s) => Math.max(max, s.doneAt ?? 0), 0);
  return now - lastActivity < SLEEP_AFTER_MS ? 'idle' : 'sleeping';
}
