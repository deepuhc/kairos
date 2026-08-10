// Display hygiene for untrusted agent/tool text before it reaches the DOM.
//
// ACP agents can put non-printable control characters into a tool title or
// command string (they render as black "tofu" boxes), and colored command
// output (grep/ls --color) arrives with raw ANSI escapes that the plain <pre>
// terminal view — unlike xterm — cannot interpret. These pure functions strip
// that noise at the render boundary; the stored conversation model stays
// byte-exact. The interactive PTY terminal keeps its ANSI (xterm handles it).
//
// Regexes are built from \uXXXX escape strings via `new RegExp` so the source
// carries no literal control bytes (which render invisibly and break diffs).

// C0 controls except tab (U+0009), LF (U+000A), CR (U+000D); DEL + C1
// (U+007F–009F, includes the C1 CSI introducer U+009B); bidirectional overrides
// (U+202A–202E, U+2066–2069 — the Trojan-source spoofing vector); and the BOM /
// zero-width no-break space (U+FEFF). Deliberately keeps zero-width joiners
// (U+200B–200D): they are invisible rather than tofu, and are load-bearing in
// emoji ligatures and ZWNJ-dependent scripts, so keeping them lets all prose
// funnel through here safely.
const CONTROL_CHARS_RE = new RegExp(
  '[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F\\u202A-\\u202E\\u2066-\\u2069\\uFEFF]',
  'g',
);

export function stripControlChars(text: string): string {
  return text.replace(CONTROL_CHARS_RE, '');
}

// Complete ANSI/VT escape sequences (ECMA-48), broader than the backend's
// color-only strip_ansi since terminal output shown in the plain <pre> may
// carry any of these:
//   • OSC  — ESC ] … terminated by BEL (U+0007) or ST (ESC \); title text may
//            contain spaces, so match lazily up to the terminator.
//   • CSI  — ESC [ , parameter bytes, intermediate bytes, final byte. Covers
//            SGR color, cursor moves, erase, etc.
//   • Fe   — other two-byte escapes (ESC followed by a single 0x40–0x5F byte).
const ANSI_RE = new RegExp(
  [
    '\\u001B\\][\\s\\S]*?(?:\\u0007|\\u001B\\\\)',
    '\\u001B\\[[0-?]*[ -/]*[@-~]',
    '\\u001B[@-Z\\\\-_]',
  ].join('|'),
  'g',
);

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '');
}

// Terminal output rendered in a plain <pre>. Order matters: strip ANSI first
// (each sequence needs its leading ESC / U+001B byte intact to match), then
// remove any residual lone control chars (stray BEL, backspace) while keeping
// tab/newline/CR for layout.
export function cleanTerminalText(text: string): string {
  return stripControlChars(stripAnsi(text));
}
