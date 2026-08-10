/**
 * App Mode — controls UI complexity level.
 *
 * Modes:
 *   • default     — balanced UI for general users
 *   • developer   — shows Working Directory, Behind the Scenes, terminal, ACP details
 *   • professional — document-focused for CPAs, HR, legal (no code jargon)
 *   • kids        — simplified, safe, playful (content filter, no advanced options)
 *
 * The active mode is persisted in localStorage and reflected as
 * `data-app-mode="<mode>"` on <html> for CSS-driven visibility gating.
 */

export type AppMode = 'default' | 'developer' | 'professional' | 'kids';

const STORAGE_KEY = 'kairos-app-mode';

const MODE_LABELS: Record<AppMode, string> = {
  default: 'Standard',
  developer: 'Developer',
  professional: 'Professional',
  kids: 'Kids & Students',
};

const MODE_DESCRIPTIONS: Record<AppMode, string> = {
  default: 'Balanced experience for everyday use',
  developer: 'Full access — terminal, working directories, protocol inspector',
  professional: 'Document-focused for business, finance, HR, and legal work',
  kids: 'Simplified and safe — perfect for learning and homework help',
};

export function getAllModes(): Array<{ id: AppMode; label: string; description: string }> {
  return (['default', 'developer', 'professional', 'kids'] as AppMode[]).map((id) => ({
    id,
    label: MODE_LABELS[id],
    description: MODE_DESCRIPTIONS[id],
  }));
}

export function getAppMode(): AppMode {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && isValidMode(stored)) return stored;
  return 'default';
}

export function setAppMode(mode: AppMode): void {
  localStorage.setItem(STORAGE_KEY, mode);
  applyMode(mode);
  window.dispatchEvent(new CustomEvent('app-mode-changed', { detail: mode }));
}

export function applyMode(mode?: AppMode): void {
  const m = mode || getAppMode();
  document.documentElement.setAttribute('data-app-mode', m);
}

function isValidMode(v: string): v is AppMode {
  return ['default', 'developer', 'professional', 'kids'].includes(v);
}

// Apply on module load
applyMode();
