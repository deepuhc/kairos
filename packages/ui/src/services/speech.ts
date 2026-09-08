// Voice output (text-to-speech) for agent responses.
//
// Uses the browser's built-in Web Speech API (`speechSynthesis`), which runs
// **on-device** on every platform — no audio ever leaves the machine, matching
// Kairos's local-first posture. There is no server or provider involvement.
//
// The only non-trivial part is turning an assistant message (Markdown, often
// with code fences) into something worth *hearing*: reading raw Markdown aloud
// spells out backticks, asterisks, and URL soup. `markdownToSpeech` reduces the
// text to plain prose. It is a pure string function so it can be unit-tested in
// the node test environment (no DOM), like the rest of this package's tests.

// True when the browser can speak. Kept defensive: `speechSynthesis` is absent
// in the node test env and in a few locked-down webviews.
export function speechOutputSupported(): boolean {
  return typeof window !== 'undefined'
    && typeof window.speechSynthesis !== 'undefined'
    && typeof (globalThis as any).SpeechSynthesisUtterance !== 'undefined';
}

// Collapse Markdown into readable prose for TTS. Not a full parser — a set of
// targeted reductions so the spoken output sounds like the message rather than
// its source. Order matters: fenced code is dropped before inline markers so we
// don't read code punctuation aloud.
export function markdownToSpeech(markdown: string): string {
  let t = markdown ?? '';

  // Fenced code blocks: don't read source aloud — replace with a short spoken
  // placeholder so the listener knows a snippet was there.
  t = t.replace(/```[\s\S]*?```/g, ' (code block) ');
  t = t.replace(/~~~[\s\S]*?~~~/g, ' (code block) ');

  // Images: read the alt text, drop the URL. Links: read the label, drop the URL.
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');

  // Inline code, bold, italic, strikethrough markers → keep the words, drop the
  // punctuation.
  t = t.replace(/`([^`]+)`/g, '$1');
  t = t.replace(/(\*\*|__)(.*?)\1/g, '$2');
  t = t.replace(/(\*|_)(.*?)\1/g, '$2');
  t = t.replace(/~~(.*?)~~/g, '$1');

  // Headings, blockquotes, list bullets at line starts → drop the leading marker.
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, '');
  t = t.replace(/^\s{0,3}>\s?/gm, '');
  t = t.replace(/^\s{0,3}[-*+]\s+/gm, '');
  t = t.replace(/^\s{0,3}\d+\.\s+/gm, '');

  // Horizontal rules and stray table pipes.
  t = t.replace(/^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/gm, ' ');
  t = t.replace(/\|/g, ' ');

  // Bare URLs left over → say "link" rather than spelling out the address.
  t = t.replace(/https?:\/\/\S+/g, ' link ');

  // Collapse whitespace runs and trim.
  t = t.replace(/[ \t]+/g, ' ');
  t = t.replace(/\n{2,}/g, '\n');
  return t.trim();
}

// --- Voice input (dictation) transcript merging --------------------------------
// The Web Speech API streams results as a mix of *interim* (may still change) and
// *final* (locked-in) fragments. We keep a `base` — the committed text so far,
// kept with a single trailing space so the next word appends cleanly — and derive
// the live draft by tacking interim words onto it. Extracted as pure functions so
// the fiddly spacing rules are unit-tested independently of the DOM/recognizer.

// The initial base when dictation starts from an existing draft: keep the draft
// and ensure it ends in exactly one space so appended words don't collide.
export function initDictationBase(draft: string): string {
  return draft.length && !draft.endsWith(' ') ? `${draft} ` : draft;
}

// Given the current base and the raw final/interim transcripts from one result
// event, return the new base (final text folded in) and the draft to display.
export function applyDictationResult(
  base: string,
  finalText: string,
  interimText: string,
): { base: string; draft: string } {
  const cleanFinal = finalText.replace(/\s+/g, ' ').trim();
  const cleanInterim = interimText.replace(/\s+/g, ' ').trim();
  let nextBase = base;
  if (cleanFinal) {
    const baseTrimmed = nextBase.replace(/ +$/, '');
    nextBase = baseTrimmed ? `${baseTrimmed} ${cleanFinal} ` : `${cleanFinal} `;
  }
  const baseTrimmed = nextBase.replace(/ +$/, '');
  const draft = cleanInterim
    ? (baseTrimmed ? `${baseTrimmed} ${cleanInterim}` : cleanInterim)
    : nextBase;
  return { base: nextBase, draft };
}

// Speak the given text (converting Markdown to prose first). Cancels anything
// already speaking so a new request doesn't queue behind the old one. Safe to
// call when unsupported — it's a no-op. `onEnd` fires when speech finishes or is
// cancelled, so callers can clear their "speaking" indicator.
export function speak(markdown: string, opts: { onEnd?: () => void; lang?: string } = {}): void {
  if (!speechOutputSupported()) { opts.onEnd?.(); return; }
  const text = markdownToSpeech(markdown);
  if (!text) { opts.onEnd?.(); return; }
  const synth = window.speechSynthesis;
  synth.cancel();
  const Utterance = (globalThis as any).SpeechSynthesisUtterance;
  const u = new Utterance(text);
  u.lang = opts.lang || (typeof navigator !== 'undefined' ? navigator.language : '') || 'en-US';
  if (opts.onEnd) {
    u.onend = opts.onEnd;
    // onerror also settles the "speaking" state (e.g. cancel, interrupted).
    u.onerror = opts.onEnd;
  }
  synth.speak(u);
}

// Stop any in-progress speech immediately.
export function stopSpeaking(): void {
  if (!speechOutputSupported()) return;
  window.speechSynthesis.cancel();
}
