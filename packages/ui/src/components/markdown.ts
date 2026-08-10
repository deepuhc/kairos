// Markdown rendering shared by the assistant message timeline and tool-call
// expanded bodies. Lives in its own module so both consumers can import it
// without forming a circular dependency with agents-timeline-render.

import { css } from 'lit';
import { marked } from 'marked';
import { highlightCode } from './code-highlight.js';
import { stripControlChars } from '../services/sanitize-text.js';

marked.setOptions({ gfm: true, breaks: true });

export const MARKDOWN_LOCAL_LINK_EVENT = 'markdown-local-link';

export interface MarkdownLocalLinkDetail {
  href: string;
  text: string;
}

export function classifyMarkdownHref(href: string): 'external' | 'local' | 'unsafe' {
  const trimmed = href.trim();
  if (!trimmed) return 'local';
  if (trimmed.startsWith('//')) return 'external';
  const protocol = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed)?.[1]?.toLowerCase();
  if (!protocol) return 'local';
  if (protocol === 'file') return 'local';
  if (protocol === 'http' || protocol === 'https' || protocol === 'mailto' || protocol === 'tel') return 'external';
  return 'unsafe';
}

// Highlight fenced code blocks through highlight.js and tag the <pre> with the
// resolved language so the block can show a small language label. Inline code
// and everything else falls through to marked's defaults.
const codeRenderer = new marked.Renderer();
codeRenderer.code = ({ text, lang }) => {
  const hinted = (lang ?? '').trim().split(/\s+/)[0];
  const { value, language } = highlightCode(text, hinted);
  const label = (hinted || language || '').replace(/[^\w+#.-]/g, '');
  return `<pre class="code-block"${label ? ` data-lang="${label}"` : ''}><code class="hljs">${value}</code></pre>`;
};
marked.use({ renderer: codeRenderer });

export function renderMarkdown(text: string) {
  const div = document.createElement('div');
  // Strip non-printable control chars (tofu boxes) from untrusted agent/tool
  // text before parsing — the single funnel for assistant messages, tool
  // content text, and sub-agent prompts/reports.
  div.innerHTML = marked.parse(stripControlChars(text), { async: false }) as string;
  sanitizeMarkdownTree(div);
  decorateLinks(div);
  addCopyButtons(div);
  return div;
}

// Parsing markdown (marked + highlight.js + a fresh detached DOM tree) is
// expensive, and the assistant timeline re-renders on every streamed token —
// once per message per token, so a long conversation re-parses every completed
// message on each delta. That O(messages × tokens) allocation churn is enough to
// OOM the renderer ("Aw, Snap!") with a couple of active sessions. Memoize by a
// caller-supplied stable key (the timeline item id): a message is only re-parsed
// when its own text grows; unchanged messages return their existing node. Each
// key maps to exactly one DOM slot, so reusing the node across renders is safe
// (a node can't live in two places). The cache is bounded so long-lived tabs
// don't accumulate detached trees.
const markdownCache = new Map<string, { text: string; node: HTMLDivElement; renderedAt: number }>();
const MARKDOWN_CACHE_CAP = 500;
const LIVE_MARKDOWN_THROTTLE_MS = 160;

export interface MarkdownCacheOptions {
  // Live streamed assistant text can change dozens of times per second. Reuse
  // the latest parsed node briefly, then force an exact render once streaming
  // stops (callers pass live:false / omit live).
  live?: boolean;
}

export function shouldReuseLiveMarkdown(renderedAt: number, now: number, throttleMs = LIVE_MARKDOWN_THROTTLE_MS): boolean {
  const age = now - renderedAt;
  return age >= 0 && age < throttleMs;
}

export function renderMarkdownCached(key: string, text: string, options: MarkdownCacheOptions = {}) {
  const hit = markdownCache.get(key);
  if (hit && hit.text === text) {
    // Refresh LRU position so hot messages survive eviction.
    markdownCache.delete(key);
    markdownCache.set(key, hit);
    return hit.node;
  }
  const now = Date.now();
  if (hit && options.live && shouldReuseLiveMarkdown(hit.renderedAt, now)) {
    markdownCache.delete(key);
    markdownCache.set(key, hit);
    return hit.node;
  }
  const node = renderMarkdown(text);
  markdownCache.set(key, { text, node, renderedAt: now });
  if (markdownCache.size > MARKDOWN_CACHE_CAP) {
    const oldest = markdownCache.keys().next().value;
    if (oldest !== undefined) markdownCache.delete(oldest);
  }
  return node;
}

// Drop every cached node whose key falls under a scope prefix (e.g. a closed
// session's `${sessionId}:`), so its detached DOM trees are freed immediately
// rather than lingering until LRU pressure evicts them.
export function evictMarkdownCache(scopePrefix: string): void {
  for (const key of markdownCache.keys()) {
    if (key.startsWith(scopePrefix)) markdownCache.delete(key);
  }
}

function decorateLinks(root: HTMLElement) {
  for (const a of Array.from(root.querySelectorAll('a[href]'))) {
    const href = a.getAttribute('href') ?? '';
    const kind = classifyMarkdownHref(href);
    if (kind === 'external') {
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
      continue;
    }
    if (kind === 'unsafe') {
      a.removeAttribute('href');
      a.setAttribute('aria-disabled', 'true');
      a.setAttribute('title', 'Blocked unsafe link');
      continue;
    }
    a.setAttribute('data-local-link', '');
    const dispatchLocalLink = (e: Event) => {
      e.preventDefault();
      a.dispatchEvent(new CustomEvent<MarkdownLocalLinkDetail>(MARKDOWN_LOCAL_LINK_EVENT, {
        bubbles: true,
        composed: true,
        detail: { href, text: a.textContent ?? '' },
      }));
    };
    a.addEventListener('click', dispatchLocalLink);
    a.addEventListener('auxclick', dispatchLocalLink);
  }
}

function sanitizeMarkdownTree(root: HTMLElement) {
  const blockedTags = new Set([
    'script', 'style', 'iframe', 'object', 'embed', 'link', 'meta', 'base',
    'form', 'input', 'button', 'textarea', 'select', 'option', 'svg', 'math',
  ]);
  for (const el of Array.from(root.querySelectorAll('*'))) {
    if (blockedTags.has(el.tagName.toLowerCase())) {
      el.remove();
      continue;
    }
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value;
      if (
        name.startsWith('on')
        || name === 'style'
        || name === 'srcdoc'
        || ((name === 'href' || name === 'xlink:href') && classifyMarkdownHref(value) === 'unsafe')
        || (name === 'src' && !isSafeEmbeddedUrl(value))
      ) {
        el.removeAttribute(attr.name);
      }
    }
  }
}

function isSafeEmbeddedUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith('//')) return true;
  const protocol = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed)?.[1]?.toLowerCase();
  return !protocol || protocol === 'http' || protocol === 'https' || protocol === 'data' || protocol === 'blob';
}

// Decorate each fenced code block with a copy-to-clipboard button. The button
// copies the block's raw text (decoded from the rendered <code>) and flashes a
// "Copied" state briefly. Listeners are attached to live DOM nodes, so they
// survive Lit re-inserting the element.
function addCopyButtons(root: HTMLElement) {
  for (const pre of Array.from(root.querySelectorAll('pre.code-block'))) {
    const code = pre.querySelector('code');
    if (!code) continue;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'copy-btn';
    btn.title = 'Copy code';
    btn.setAttribute('aria-label', 'Copy code');
    btn.textContent = 'Copy';
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(code.textContent ?? '');
        btn.textContent = 'Copied';
        btn.classList.add('copied');
        window.setTimeout(() => {
          btn.textContent = 'Copy';
          btn.classList.remove('copied');
        }, 1500);
      } catch {
        // clipboard unavailable — leave the button as-is
      }
    });
    pre.appendChild(btn);
  }
}

// Body rules used both inline in the timeline (.content) and inside expanded
// tool-call bodies (.md). :where() keeps specificity flat so callers can
// override individual rules without specificity wars.
export const markdownStyles = css`
  :where(.content, .md) :first-child { margin-top: 0; }
  :where(.content, .md) :last-child { margin-bottom: 0; }
  :where(.content, .md) p { margin: 0 0 10px; }
  :where(.content, .md) pre {
    position: relative;
    background: var(--blue-gray);
    border: 1px solid var(--w8);
    border-radius: var(--radius);
    padding: 12px 14px;
    overflow-x: auto;
    margin: 10px 0;
  }
  /* Language tag in the corner of a fenced block — only when marked gave us
     (or highlight.js detected) a language. */
  :where(.content, .md) pre.code-block[data-lang]::before {
    content: attr(data-lang);
    position: absolute;
    top: 0;
    right: 0;
    padding: 2px 8px;
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
    color: var(--neutral-gray);
    background: var(--w5);
    border-bottom-left-radius: var(--radius);
    text-transform: lowercase;
    pointer-events: none;
  }
  /* Copy button — hidden until the block is hovered, then it takes the
     top-right corner and the language label steps aside. */
  :where(.content, .md) pre.code-block .copy-btn {
    position: absolute;
    top: 0;
    right: 0;
    padding: 2px 8px;
    font-family: var(--font-mono);
    font-size: var(--font-size-xs);
    color: var(--neutral-gray);
    background: var(--w5);
    border: none;
    border-bottom-left-radius: var(--radius);
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.12s, color 0.12s;
  }
  :where(.content, .md) pre.code-block:hover .copy-btn { opacity: 1; }
  :where(.content, .md) pre.code-block .copy-btn:hover { color: var(--bright-white); }
  :where(.content, .md) pre.code-block .copy-btn.copied { color: var(--accent); opacity: 1; }
  :where(.content, .md) pre.code-block:hover[data-lang]::before { opacity: 0; }
  :where(.content, .md) code { font-family: var(--font-mono); font-size: var(--font-size-sm); }
  :where(.content, .md) pre code.hljs { display: block; background: none; padding: 0; color: var(--white); }
  :where(.content, .md) :not(pre) > code { background: var(--w10); padding: 1.5px 5px; border-radius: 5px; }
  :where(.content, .md) ul, :where(.content, .md) ol { margin: 0 0 10px; padding-left: 22px; }
  :where(.content, .md) li { margin: 2px 0; }
  :where(.content, .md) a { color: var(--purple-light); text-underline-offset: 2px; }
  :where(.content, .md) a[data-local-link] { cursor: pointer; }
  :where(.content, .md) a[aria-disabled='true'] { cursor: not-allowed; opacity: 0.65; }
  :where(.content, .md) h1, :where(.content, .md) h2, :where(.content, .md) h3 { margin: 16px 0 8px; line-height: 1.3; color: var(--bright-white); }
  :where(.content, .md) blockquote { margin: 8px 0; padding-left: 12px; border-left: 2px solid var(--accent-a35); color: var(--gray); }
`;
