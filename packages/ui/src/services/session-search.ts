import type { SessionEntry } from './api.js';

// Pure, DOM-free helpers for History search. Kept out of the Lit component so
// they're unit-testable (Vitest has no DOM harness here).

// Token/AND match: split the query on whitespace and require EVERY token to
// appear somewhere in the session's searchable text (title, first message, dir,
// id). This makes "auth bug" match a session titled "Fix login bug" whose first
// message mentions auth, regardless of word order — while staying a plain O(n)
// scan over the already-fetched list, so it's instant with no backend round-trip.
function queryTokens(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

function searchableText(s: SessionEntry): string {
  return [s.title, s.firstMessage, s.dir, s.id]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function matchesTokens(s: SessionEntry, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const haystack = searchableText(s);
  return tokens.every((t) => haystack.includes(t));
}

export function matchesSessionQuery(s: SessionEntry, query: string): boolean {
  return matchesTokens(s, queryTokens(query));
}

export function filterSessions(sessions: SessionEntry[], query: string): SessionEntry[] {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return sessions;
  return sessions.filter((s) => matchesTokens(s, tokens));
}

export function orderSessionsForHistory(sessions: SessionEntry[]): SessionEntry[] {
  return sessions
    .map((session, index) => ({ session, index }))
    .sort((a, b) => {
      const pinnedDelta = Number(Boolean(b.session.pinned)) - Number(Boolean(a.session.pinned));
      return pinnedDelta || a.index - b.index;
    })
    .map((entry) => entry.session);
}

// Build the first-turn prompt handed to an agent for a deep/semantic session
// search. The agent gets the user's query, the visible session corpus (metadata
// only — transcript bodies aren't fetched client-side), and instructions to read
// the transcripts it deems promising via `kairos sessions export` before
// reporting. IDs are included so its answers are resume-able.
export function buildSessionSearchPrompt(query: string, sessions: SessionEntry[]): string {
  const corpus = sessions.map((s) => {
    const parts = [
      `id: ${s.id}`,
      `title: ${s.title || '(untitled)'}`,
      s.firstMessage ? `first message: ${truncate(s.firstMessage, 240)}` : '',
      `dir: ${s.dir}`,
      `tool: ${s.tool}`,
      `last active: ${s.lastActive}`,
      `messages: ${s.messages}`,
    ].filter(Boolean);
    return `- ${parts.join(' | ')}`;
  }).join('\n');

  return [
    `I'm looking for a past coding session but plain text search over titles didn't find it.`,
    ``,
    `My query: "${query}"`,
    ``,
    `Here are the ${sessions.length} candidate session(s) currently in view (metadata only):`,
    corpus || '(none)',
    ``,
    `Please find which session(s) I mean:`,
    `1. Rank the candidates by how likely they match my query, using titles and first messages.`,
    `2. For the few most promising, read the actual transcript to confirm — run` +
      ` \`kairos sessions export <id> --format md --output -\` in the terminal (the <id> values are above).`,
    `3. Report the matches as a short list, one per line: \`<id> — <title> — one-line why it matches\`.` +
      ` Put the best match first. If nothing genuinely matches, say so plainly.`,
    `Keep it tight — I want to find the session, not read an essay.`,
  ].join('\n');
}

function truncate(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? oneLine.slice(0, max - 1) + '…' : oneLine;
}

// Given the agent's answer text and a pool of known sessions, return the ones
// whose id the agent cited — in the order they first appear in the text (so the
// agent's ranking is preserved). The pool is the full History list, not just the
// corpus placed in the prompt: deep search exists to surface sessions the
// metadata filter missed, and the agent finds their ids by reading transcripts,
// so cited ids routinely fall outside the prompt corpus. Matching against a
// KNOWN id set (not free-form parsing) keeps this robust: a chip only ever
// resolves to a real, resumable session. Full ids are unique enough that a plain
// substring test is safe; longest-id-first avoids a shorter id matching inside a
// longer one.
export function findCitedSessions(answer: string, candidates: SessionEntry[]): SessionEntry[] {
  if (!answer || candidates.length === 0) return [];
  // Consume matched spans as we go (longest id first) so a shorter id can't be
  // reported for a hit that sits inside a longer id's occurrence.
  let haystack = answer;
  const found: Array<{ entry: SessionEntry; at: number }> = [];
  for (const s of [...candidates].sort((a, b) => b.id.length - a.id.length)) {
    const at = haystack.indexOf(s.id);
    if (at < 0) continue;
    found.push({ entry: s, at });
    // Blank the span (keep length so other ids' positions stay meaningful).
    haystack = haystack.slice(0, at) + ' '.repeat(s.id.length) + haystack.slice(at + s.id.length);
  }
  return found.sort((a, b) => a.at - b.at).map((v) => v.entry);
}
