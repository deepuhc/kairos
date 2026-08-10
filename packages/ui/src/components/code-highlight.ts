// Syntax highlighting for fenced code blocks in the Agents tab, backed by
// highlight.js. We import the core engine and register only a curated set of
// languages (the ones that actually show up in agent output) so the bundle
// stays lean — the full highlight.js auto-bundle pulls ~190 grammars.
//
// highlight.js's own theme CSS is global and would never reach our Lit shadow
// roots anyway, so we don't ship it. Instead `hljsTheme` below maps the
// `.hljs-*` token classes onto the app's design tokens, and each component that
// renders code includes it in its `static styles`. That guarantees zero
// interference with the rest of the app and keeps code coloring on-theme in
// both light and dark mode.

import { css } from 'lit';
import hljs from 'highlight.js/lib/core';

import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import shell from 'highlight.js/lib/languages/shell';
import json from 'highlight.js/lib/languages/json';
import yaml from 'highlight.js/lib/languages/yaml';
import xml from 'highlight.js/lib/languages/xml';
import css_ from 'highlight.js/lib/languages/css';
import markdown from 'highlight.js/lib/languages/markdown';
import cpp from 'highlight.js/lib/languages/cpp';
import c from 'highlight.js/lib/languages/c';
import java from 'highlight.js/lib/languages/java';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import ini from 'highlight.js/lib/languages/ini';
import matlab from 'highlight.js/lib/languages/matlab';
import ruby from 'highlight.js/lib/languages/ruby';
import csharp from 'highlight.js/lib/languages/csharp';
import kotlin from 'highlight.js/lib/languages/kotlin';
import php from 'highlight.js/lib/languages/php';
import swift from 'highlight.js/lib/languages/swift';
import lua from 'highlight.js/lib/languages/lua';
import perl from 'highlight.js/lib/languages/perl';

let registered = false;
function ensureRegistered() {
  if (registered) return;
  registered = true;
  hljs.registerLanguage('javascript', javascript);
  hljs.registerLanguage('typescript', typescript);
  hljs.registerLanguage('python', python);
  hljs.registerLanguage('bash', bash);
  hljs.registerLanguage('shell', shell);
  hljs.registerLanguage('json', json);
  hljs.registerLanguage('yaml', yaml);
  hljs.registerLanguage('xml', xml);
  hljs.registerLanguage('css', css_);
  hljs.registerLanguage('markdown', markdown);
  hljs.registerLanguage('cpp', cpp);
  hljs.registerLanguage('c', c);
  hljs.registerLanguage('java', java);
  hljs.registerLanguage('go', go);
  hljs.registerLanguage('rust', rust);
  hljs.registerLanguage('sql', sql);
  hljs.registerLanguage('diff', diff);
  hljs.registerLanguage('dockerfile', dockerfile);
  hljs.registerLanguage('ini', ini);
  hljs.registerLanguage('matlab', matlab);
  hljs.registerLanguage('ruby', ruby);
  hljs.registerLanguage('csharp', csharp);
  hljs.registerLanguage('kotlin', kotlin);
  hljs.registerLanguage('php', php);
  hljs.registerLanguage('swift', swift);
  hljs.registerLanguage('lua', lua);
  hljs.registerLanguage('perl', perl);
}

// Common info-string aliases → registered grammar names. Anything not mapped is
// passed to highlight.js as-is (it knows many aliases itself), and an
// unrecognized language falls back to auto-detection.
const ALIASES: Record<string, string> = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'typescript',
  py: 'python', py3: 'python',
  sh: 'bash', zsh: 'bash', console: 'shell',
  yml: 'yaml',
  html: 'xml', svg: 'xml',
  'c++': 'cpp', cc: 'cpp', h: 'cpp', hpp: 'cpp',
  golang: 'go', rs: 'rust',
  docker: 'dockerfile', toml: 'ini',
  m: 'matlab', octave: 'matlab',
};

export interface HighlightResult {
  // HTML-escaped, `<span class="hljs-…">`-wrapped markup ready for innerHTML.
  value: string;
  // The grammar actually used (resolved alias, detected language, or undefined
  // when the input fell through to plain text).
  language?: string;
}

// Fenced code block highlighter. Two properties keep it off the session-switch
// hot path (same reasoning as highlightLine below):
//
//  1. It NEVER auto-detects. hljs.highlightAuto runs the block through all ~27
//     registered grammars, and that guess was the dominant cost when switching
//     into a session with unhinted blocks (a synchronous ~1.6s main-thread
//     freeze in profiling). Without a resolved grammar we return escaped text.
//  2. Results are memoized by `grammar\nsource`. The key is grammar+content, not
//     session, so re-rendering a timeline (e.g. on switch) — or an identical
//     block in another session — returns cached markup instead of re-highlighting.
const blockCache = new Map<string, HighlightResult>();
const BLOCK_CACHE_CAP = 2000;

export function highlightCode(code: string, lang?: string): HighlightResult {
  ensureRegistered();
  const requested = (lang ?? '').trim().toLowerCase();
  const resolved = ALIASES[requested] ?? requested;
  const usable = resolved && hljs.getLanguage(resolved) ? resolved : '';

  const key = `${usable}\n${code}`;
  const hit = blockCache.get(key);
  if (hit !== undefined) {
    // Refresh LRU position so hot blocks survive eviction.
    blockCache.delete(key);
    blockCache.set(key, hit);
    return hit;
  }

  const result: HighlightResult = usable
    ? { value: hljs.highlight(code, { language: usable, ignoreIllegals: true }).value, language: usable }
    : { value: escapeHtml(code), language: undefined };

  blockCache.set(key, result);
  if (blockCache.size > BLOCK_CACHE_CAP) {
    const oldest = blockCache.keys().next().value;
    if (oldest !== undefined) blockCache.delete(oldest);
  }
  return result;
}

// HTML-escape for the plain-text fallback (no grammar hint). Mirrors the
// escaping highlight.js applies so unhighlighted lines are still injection-safe.
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Per-line highlighter for diff bodies. Two differences from highlightCode that
// matter for the session-switch hot path:
//
//  1. It NEVER auto-detects. A single diff line rarely carries enough signal for
//     highlightAuto to guess right, and running all ~25 grammars per line was the
//     dominant cost when switching into a session with large diffs (a ~500ms
//     synchronous main-thread freeze). Without a resolved grammar we return the
//     escaped text verbatim.
//  2. Results are memoized by `lang\ntext`. Diff line text is immutable once a
//     tool call completes, so re-rendering a session's timeline (e.g. on switch)
//     returns cached markup instead of re-highlighting every visible line.
const lineCache = new Map<string, string>();
const LINE_CACHE_CAP = 4000;

export function highlightLine(text: string, lang?: string): string {
  ensureRegistered();
  const requested = (lang ?? '').trim().toLowerCase();
  const resolved = ALIASES[requested] ?? requested;
  const usable = resolved && hljs.getLanguage(resolved) ? resolved : '';

  const key = `${usable}\n${text}`;
  const hit = lineCache.get(key);
  if (hit !== undefined) {
    // Refresh LRU position so hot lines survive eviction.
    lineCache.delete(key);
    lineCache.set(key, hit);
    return hit;
  }

  const value = usable
    ? hljs.highlight(text, { language: usable, ignoreIllegals: true }).value
    : escapeHtml(text);

  lineCache.set(key, value);
  if (lineCache.size > LINE_CACHE_CAP) {
    const oldest = lineCache.keys().next().value;
    if (oldest !== undefined) lineCache.delete(oldest);
  }
  return value;
}

// highlight.js token classes mapped onto the app palette. Mirrors the colors
// <acp-json> already uses (purple keys, emerald strings, amber numbers) so code
// and protocol JSON read as one visual language. Theme-token driven, so it
// follows light/dark automatically.
export const hljsTheme = css`
  .hljs-keyword,
  .hljs-built_in,
  .hljs-type,
  .hljs-literal,
  .hljs-selector-tag { color: var(--purple-light); }
  .hljs-string,
  .hljs-meta-string,
  .hljs-regexp,
  .hljs-symbol { color: var(--emerald); }
  .hljs-number,
  .hljs-bullet { color: var(--amber); }
  .hljs-title,
  .hljs-title.function_,
  .hljs-section,
  .hljs-name { color: var(--blue); }
  .hljs-title.class_,
  .hljs-class .hljs-title,
  .hljs-attr,
  .hljs-attribute,
  .hljs-variable,
  .hljs-template-variable,
  .hljs-property { color: var(--teal); }
  .hljs-comment,
  .hljs-quote { color: var(--neutral-gray); font-style: italic; }
  .hljs-meta,
  .hljs-doctag,
  .hljs-tag { color: var(--gray); }
  .hljs-deletion { color: var(--red); }
  .hljs-addition { color: var(--emerald); }
  .hljs-emphasis { font-style: italic; }
  .hljs-strong { font-weight: 600; }
  .hljs-link { color: var(--purple-light); text-decoration: underline; }
`;
