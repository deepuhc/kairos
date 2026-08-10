// Pure helpers for prompt snippets — slug generation and slash-menu matching.
// The prompts themselves live server-side in ~/.kairos/config.json (see the
// `/agents/prompts` API); these functions have no storage dependency, so they're
// shared by the management view and the composer.
import type { AvailableCommand } from './acp-types.js';
import type { PromptInput } from './api.js';

// One row in the composer's `/` menu. The menu blends the user's saved prompt
// snippets with agent-native commands and Kairos-native controls.
export type SlashMenuItem =
  | { kind: 'prompt'; prompt: PromptInput }
  | { kind: 'rewind' }
  | { kind: 'command'; command: AvailableCommand };

// Slugify a name into a stable trigger, disambiguating against existing ids.
export function promptId(name: string, existing: PromptInput[]): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'prompt';
  let id = base;
  let n = 2;
  const taken = new Set(existing.map((p) => p.id));
  while (taken.has(id)) id = `${base}-${n++}`;
  return id;
}

// Prompts whose name (the slash trigger) contains the query, case-insensitive.
// An empty query returns all prompts, so opening the menu with a bare `/` lists
// everything — matching how agent commands behave.
export function matchPrompts(query: string, prompts: PromptInput[]): PromptInput[] {
  const lower = query.toLowerCase();
  return prompts.filter((p) => p.name.toLowerCase().includes(lower));
}

export function buildSlashMenuItems({
  commands,
  prompts,
  query,
  listing,
  hasRewindPrompts,
}: {
  commands: AvailableCommand[];
  prompts: PromptInput[];
  query: string;
  listing: boolean;
  hasRewindPrompts: boolean;
}): SlashMenuItem[] {
  const lower = query.toLowerCase();
  const agentCmds = listing ? commands : commands.filter((c) => c.name.toLowerCase().includes(lower));
  const promptItems = listing ? prompts : matchPrompts(query, prompts);
  // `/rewind` is Kairos-native, not an adapter command. Keep it visible with
  // the control commands, but below user-defined prompt snippets.
  const showRewind = hasRewindPrompts && 'rewind'.includes(lower);

  return [
    ...promptItems.map((prompt): SlashMenuItem => ({ kind: 'prompt', prompt })),
    ...(showRewind ? [{ kind: 'rewind' } as SlashMenuItem] : []),
    ...agentCmds.map((command): SlashMenuItem => ({ kind: 'command', command })),
  ];
}

// `/rewind` is a Claude Code TUI built-in the ACP adapter doesn't implement, so
// Kairos intercepts it in the composer and routes it to the native prompt
// rewind instead of forwarding it (the adapter would answer "isn't available in
// this environment"). Matches a bare `/rewind` with optional surrounding
// whitespace, case-insensitive; anything with an argument (`/rewind foo`) or a
// longer name (`/rewinder`) is left for the agent.
export function isRewindCommand(text: string): boolean {
  return /^\s*\/rewind\s*$/i.test(text);
}

// Agent slash commands are control turns, not steering text. If one is sent
// while the agent is already working, queue it behind the active turn rather
// than cancelling the active turn first.
export function isSlashCommandMessage(text: string): boolean {
  return /^\s*\/[^\s/]+(?:\s|$)/.test(text);
}
