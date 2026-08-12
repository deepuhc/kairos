// Tiered permission policy for ACP `session/request_permission`.
//
// The ACP spec makes `PermissionOption.kind` (allow_once | allow_always |
// reject_once | reject_always) a DISPLAY HINT only — the connected agent owns
// the optionIds and their meaning — and it explicitly lets clients auto-approve
// or auto-reject based on user settings. So Kairos intercepts each request and,
// per the session's chosen tier, either answers with the right optionId without
// showing UI, or falls back to prompting the user.
//
// The four tiers (least → most autonomous):
//   • plan       — read-only. Auto-reject anything that isn't a read/search,
//                  auto-allow reads. Mirrors Claude `plan` / Codex read-only.
//   • ask        — DEFAULT. Always prompt with the agent's own options. The safe
//                  universal baseline that never surprises a new user.
//   • auto       — guarded autonomy. Auto-allow reads, in-workspace edits, and
//                  known-safe commands; FALL BACK TO PROMPTING (never silently
//                  reject) for risk patterns — out-of-workspace writes,
//                  destructive git, curl|bash, mass deletes, network exfil.
//   • full-auto  — auto-allow everything EXCEPT the always-on danger floor,
//                  which still prompts. Gated behind a one-time confirmation.
//
// The danger floor (isDangerous) applies in EVERY tier and is un-overridable by
// looser tiers: even full-auto prompts rather than auto-approving a match.
//
// This client-side interception is the universal baseline (works against any
// agent). Where the connected agent exposes a native guarded `mode` config
// option we ALSO align it (see tierToAgentMode) so the agent stops emitting
// requests we'd only rubber-stamp; the interception remains the fallback.

import type { ToolKind } from './acp-types.js';

export type PermissionTier = 'plan' | 'ask' | 'auto' | 'full-auto';

/** Tiers in escalating-autonomy order (drives the picker menu). */
export const PERMISSION_TIERS: PermissionTier[] = ['plan', 'ask', 'auto', 'full-auto'];

/** The safe universal baseline: always prompt. */
export const DEFAULT_PERMISSION_TIER: PermissionTier = 'ask';

export interface PermissionTierMeta {
  id: PermissionTier;
  label: string;
  /** One-line description for the picker menu. */
  hint: string;
}

export const PERMISSION_TIER_META: Record<PermissionTier, PermissionTierMeta> = {
  plan: {
    id: 'plan',
    label: 'Plan only',
    hint: 'Read-only. The agent can look but not edit or run commands.',
  },
  ask: {
    id: 'ask',
    label: 'Ask every time',
    hint: 'Prompt for every action. Nothing runs without your approval.',
  },
  auto: {
    id: 'auto',
    label: 'Auto (guarded)',
    hint: 'Auto-allow reads, in-workspace edits, and safe commands; ask for risky ones.',
  },
  'full-auto': {
    id: 'full-auto',
    label: 'Full auto',
    hint: 'Approve everything except a hard danger floor. Use only when supervised.',
  },
};

// What the client decides to do with a request without asking the user, or the
// signal that it must be surfaced.
export type PermissionAction = 'allow' | 'reject' | 'prompt';

// Minimal shape of the tool call we inspect — a structural subset of ToolCall so
// this module stays decoupled from the transport types beyond ToolKind.
export interface PolicyToolCall {
  kind?: ToolKind;
  title?: string;
  rawInput?: unknown;
  locations?: Array<{ path: string }>;
}

// Read-class tool kinds are always safe to auto-allow and are the only kinds a
// plan-tier session permits.
const READ_KINDS: ReadonlySet<ToolKind> = new Set<ToolKind>(['read', 'search', 'think']);

// Command prefixes considered safe enough to auto-run under the guarded `auto`
// tier. Matched against the first token of each shell segment; a compound
// command is safe only when EVERY segment is.
const SAFE_COMMAND_HEADS: readonly string[] = [
  'ls', 'pwd', 'cat', 'head', 'tail', 'echo', 'grep', 'rg', 'fd', 'wc', 'which',
  'node', 'tsc', 'vitest', 'jest', 'npm', 'npx', 'pnpm', 'yarn', 'bun',
  'python', 'python3', 'pip', 'pytest', 'make', 'cargo', 'go', 'ruff', 'mypy',
  'eslint', 'prettier', 'tsx', 'deno',
];

// Sub-commands that make an otherwise-safe VCS/tooling head destructive.
const UNSAFE_GIT_SUBCOMMANDS = /\bgit\s+(push|reset\s+--hard|clean\s+-\w*f|rebase|filter-branch|update-ref\s+-d)/;

// Patterns that are dangerous in ANY tier — the always-on floor. A match forces
// a prompt (never a silent auto-allow), even under full-auto. Written to catch
// the common flag orderings/spellings, not to be a complete parser: anything
// not matched here still can't auto-run under `auto` (only allowlisted heads
// do), and under `full-auto` the residual risk is bounded by the sandbox.
const DANGEROUS_COMMAND_PATTERNS: readonly RegExp[] = [
  // `rm` with any recursive/force flag — short (-r/-R/-f, bundled or separate),
  // long (--recursive/--force), in any order. Case-insensitive for BSD/macOS -R.
  /\brm\b[^\n]*\s-[a-z]*[rf]/i, // rm -rf / rm -R / rm -fr / rm -r -f
  /\brm\b[^\n]*\s--(recursive|force)\b/i,
  /\bsudo\b/,
  /\bmkfs\b/,
  /\bdd\b[^\n]*\b(if|of)=/, // dd reading OR writing a device/file
  /:\(\)\s*\{.*\};?:/, // fork bomb
  /\bgit\s+push\b.*(--force|-f)\b/,
  /\bgit\s+reset\s+--hard\b/,
  /\bgit\s+clean\s+-\w*f/,
  /\bfind\b[^\n|]*\s-delete\b/,
  /\bcurl\b[^\n]*\|\s*(sudo\s+)?(sh|bash|zsh)\b/, // curl … | sh
  /\bwget\b[^\n]*\|\s*(sudo\s+)?(sh|bash|zsh)\b/, // wget … | sh
  />\s*\/dev\/(sd|disk|null\/)/,
  /\bchmod\b[^\n]*\s(-R|--recursive)\b[^\n]*\s777\b/i,
  /\bchmod\b[^\n]*\s777\b[^\n]*\s(-R|--recursive)\b/i,
  /\bnc\b[^\n]*-e\b/, // netcat exec
];

// Redirection targets in a command (`> file`, `>> file`, `2> file`), so a write
// that leaves the workspace is caught even behind a safe head (echo/cat/…).
export function extractRedirectTargets(command: string): string[] {
  const targets: string[] = [];
  const re = /(?:\d*>>?|&>)\s*("[^"]+"|'[^']+'|\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(command))) {
    const raw = m[1].replace(/^['"]|['"]$/g, '');
    if (raw && raw !== '/dev/null' && !raw.startsWith('&')) targets.push(raw);
  }
  return targets;
}

// Pull a shell command string out of a tool call's rawInput. Different agents
// key it differently (command / cmd / script); tolerate all and array forms.
export function extractCommand(rawInput: unknown): string {
  if (!rawInput || typeof rawInput !== 'object') return '';
  const r = rawInput as Record<string, unknown>;
  const v = r.command ?? r.cmd ?? r.script ?? r.commandLine;
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.filter((x) => typeof x === 'string').join(' ');
  return '';
}

// Split a compound command into segments on shell operators so each head can be
// vetted independently ("npm test && rm -rf x" must NOT count as safe).
function commandSegments(command: string): string[] {
  return command
    .split(/&&|\|\||[;|]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function firstToken(segment: string): string {
  // Skip leading env-var assignments (FOO=bar cmd …).
  const tokens = segment.split(/\s+/).filter((t) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(t));
  return (tokens[0] ?? '').replace(/^['"]|['"]$/g, '');
}

// Interpreter heads that can run arbitrary code from an inline flag — the head
// is allowlisted (for `npm test`-style use) but `node -e '…'` / `python3 -c '…'`
// smuggle a whole program the regex floor can't see into. Reading from stdin
// (`-`) is equally opaque. Any such flag makes the segment unsafe → prompt.
const INTERPRETER_HEADS: ReadonlySet<string> = new Set(['node', 'python', 'python3', 'deno', 'bun', 'tsx']);
const INLINE_CODE_FLAG = /(^|\s)(-e|-c|--eval|--exec|-p|--print|-)(\s|$|=)/;

function isSafeCommand(command: string): boolean {
  const segments = commandSegments(command);
  if (!segments.length) return false;
  return segments.every((seg) => {
    const head = firstToken(seg);
    if (!head) return false;
    if (!SAFE_COMMAND_HEADS.includes(head)) return false;
    if (UNSAFE_GIT_SUBCOMMANDS.test(seg)) return false;
    // Interpreter smuggling: `node -e`, `python3 -c`, reading from stdin, etc.
    if (INTERPRETER_HEADS.has(head) && INLINE_CODE_FLAG.test(seg)) return false;
    return true;
  });
}

// True when a path escapes the workspace root (absolute-and-outside, a home-dir
// reference, or a `..` traversal that climbs above cwd). String-only so it runs
// in the browser (no symlink resolution — a best-effort boundary, not a jail).
export function pathEscapesWorkspace(path: string, cwd: string): boolean {
  if (!path) return false;
  const norm = path.replace(/\\/g, '/');
  const root = (cwd || '').replace(/\\/g, '/').replace(/\/+$/, '');
  // Home-dir references (~, ~/x, $HOME) point outside the workspace unless the
  // workspace itself is literally the home dir (uncommon; still ask then).
  if (norm === '~' || norm.startsWith('~/') || norm.startsWith('$HOME') || norm.startsWith('${HOME}')) {
    return true;
  }
  if (norm.startsWith('/') || /^[A-Za-z]:\//.test(norm)) {
    // Absolute: must sit under the workspace root.
    return !root || !(norm === root || norm.startsWith(root + '/'));
  }
  // Relative: resolve `..` segments against a zero-depth cursor.
  let depth = 0;
  for (const seg of norm.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { depth--; if (depth < 0) return true; }
    else depth++;
  }
  return false;
}

/**
 * The always-on danger floor. Returns true for tool calls that must never be
 * auto-approved regardless of tier — destructive/system commands, curl|bash,
 * mass deletes, and writes/deletes/moves that leave the workspace.
 */
export function isDangerous(toolCall: PolicyToolCall, cwd: string): boolean {
  const command = extractCommand(toolCall.rawInput);
  if (command) {
    if (DANGEROUS_COMMAND_PATTERNS.some((re) => re.test(command))) return true;
    // A redirection that writes outside the workspace (e.g. `echo x > ~/.zshrc`
    // or `> /etc/hosts`) is dangerous even behind an allowlisted head.
    if (extractRedirectTargets(command).some((t) => pathEscapesWorkspace(t, cwd))) return true;
  }

  // Filesystem-mutating kinds that reach outside the workspace are dangerous.
  if (toolCall.kind === 'edit' || toolCall.kind === 'delete' || toolCall.kind === 'move') {
    const paths = (toolCall.locations ?? []).map((l) => l.path);
    if (paths.some((p) => pathEscapesWorkspace(p, cwd))) return true;
  }
  return false;
}

/**
 * Decide what to do with a permission request under the given tier. Pure — the
 * caller maps the returned action onto a concrete optionId (see pickOption).
 */
export function decidePermission(
  tier: PermissionTier,
  toolCall: PolicyToolCall,
  cwd: string,
): PermissionAction {
  const isRead = toolCall.kind !== undefined && READ_KINDS.has(toolCall.kind);

  switch (tier) {
    case 'ask':
      return 'prompt';

    case 'plan':
      // Read-only: allow reads, reject everything that would act.
      return isRead ? 'allow' : 'reject';

    case 'full-auto':
      // Approve all — except the un-overridable danger floor, which still prompts.
      return isDangerous(toolCall, cwd) ? 'prompt' : 'allow';

    case 'auto': {
      if (isRead) return 'allow';
      if (isDangerous(toolCall, cwd)) return 'prompt';
      // In-workspace edits/moves are fine; deletes always prompt.
      if (toolCall.kind === 'edit' || toolCall.kind === 'move') return 'allow';
      if (toolCall.kind === 'delete') return 'prompt';
      // Commands: auto-run only the known-safe allowlist, else prompt.
      if (toolCall.kind === 'execute') {
        const command = extractCommand(toolCall.rawInput);
        return command && isSafeCommand(command) ? 'allow' : 'prompt';
      }
      // fetch (network) and other/unknown kinds → prompt.
      return 'prompt';
    }

    default:
      return 'prompt';
  }
}

// Pick the optionId to answer with for an allow/reject action. Prefers the
// _once variant so autonomy never silently writes a standing allow/deny rule;
// falls back to the _always variant when that's all the agent offers.
export function pickOption(
  options: Array<{ optionId: string; kind: string }>,
  action: 'allow' | 'reject',
): string | null {
  const prefix = action; // 'allow' | 'reject' — kinds are allow_*/reject_*.
  const once = options.find((o) => o.kind === `${prefix}_once`);
  if (once) return once.optionId;
  const any = options.find((o) => o.kind.startsWith(prefix));
  return any ? any.optionId : null;
}

// Canonical agent `mode` config value to align with a tier, where the connected
// agent offers it (Claude Code: default/acceptEdits/plan/bypassPermissions).
//
// IMPORTANT: for the autonomous tiers we deliberately DO NOT delegate to the
// agent's own auto-accept modes (`acceptEdits`, `bypassPermissions`). Those make
// the agent stop emitting `session/request_permission` (or auto-accept edits
// agent-side), which would bypass our client-side interception — and with it the
// always-on danger floor, which must apply in EVERY tier. So `auto`/`full-auto`
// keep the agent in `default` (it keeps asking) and Kairos answers each request
// per the tier, enforcing the floor. Only `plan` delegates natively, because it
// is strictly read-only (safe) and our client rejects non-reads as a backstop.
// Returns null when a tier has no native analog to set.
export function tierToAgentMode(tier: PermissionTier): string | null {
  switch (tier) {
    case 'plan': return 'plan';
    case 'ask': return 'default';
    case 'auto': return 'default';
    case 'full-auto': return 'default';
    default: return null;
  }
}

// Migrate the legacy boolean auto-accept preference to a tier. The old boolean,
// when on, auto-approved every allow_* option — i.e. full-auto behavior.
export function tierFromLegacyAutoAccept(autoAccept: boolean): PermissionTier {
  return autoAccept ? 'full-auto' : DEFAULT_PERMISSION_TIER;
}

// Legacy mirror for the deprecated AgentPrefs.autoAccept boolean. The old
// boolean meant "auto-accept every allow_* option" — i.e. accept-all — which
// only `full-auto` matches. We deliberately DON'T mirror the guarded `auto` tier
// as `true`: an older client that understands only the boolean would then
// accept-all, which is MORE permissive than `auto` intends (a safety downgrade).
// So `auto` mirrors as `false` (an old client falls back to prompting — safe).
export function tierImpliesAutoAccept(tier: PermissionTier): boolean {
  return tier === 'full-auto';
}
