import { svg, type SVGTemplateResult } from 'lit';

/**
 * Shared inline-SVG icon set (Lucide-style: 24×24 viewBox, currentColor stroke,
 * 2px round strokes). Replaces the grab-bag of raw Unicode glyphs (✕ ▶ ↑ ✎ ↻ …)
 * that read as "internal tool". Icons inherit color from the host and scale via
 * width/height on the <svg>.
 *
 * Usage in a template:  html`<button>${icon.close()}</button>`
 * Size defaults to 1em so an icon tracks the button's font-size; pass a px size
 * for fixed-size chrome.
 */
function wrap(size: number | string, ...paths: SVGTemplateResult[]): SVGTemplateResult {
  const s = typeof size === 'number' ? `${size}` : size;
  return svg`<svg width=${s} height=${s} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

export const icon = {
  close: (size: number | string = '1em') => wrap(size, svg`<path d="M18 6 6 18M6 6l12 12"/>`),
  chevronRight: (size: number | string = '1em') => wrap(size, svg`<path d="m9 18 6-6-6-6"/>`),
  chevronDown: (size: number | string = '1em') => wrap(size, svg`<path d="m6 9 6 6 6-6"/>`),
  chevronUp: (size: number | string = '1em') => wrap(size, svg`<path d="m18 15-6-6-6 6"/>`),
  arrowUp: (size: number | string = '1em') => wrap(size, svg`<path d="M12 19V5M5 12l7-7 7 7"/>`),
  arrowRight: (size: number | string = '1em') => wrap(size, svg`<path d="M5 12h14M12 5l7 7-7 7"/>`),
  pencil: (size: number | string = '1em') => wrap(size, svg`<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>`),
  refresh: (size: number | string = '1em') => wrap(size, svg`<path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 21v-5h5"/>`),
  check: (size: number | string = '1em') => wrap(size, svg`<path d="M20 6 9 17l-5-5"/>`),
  circle: (size: number | string = '1em') => wrap(size, svg`<circle cx="12" cy="12" r="9"/>`),
  star: (size: number | string = '1em') => wrap(size, svg`<path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2Z"/>`),
  pin: (size: number | string = '1em') => wrap(size, svg`<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>`),
  folder: (size: number | string = '1em') => wrap(size, svg`<path d="M4 20a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2Z"/>`),
  copy: (size: number | string = '1em') => wrap(size, svg`<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>`),
  gitFork: (size: number | string = '1em') => wrap(size, svg`<circle cx="6" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><path d="M6 9v3a6 6 0 0 0 6 6h3"/><path d="M18 6h-3a6 6 0 0 0-6 6v0"/>`),
  gift: (size: number | string = '1em') => wrap(size, svg`<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.7 4.7 0 0 1 12 8"/><path d="M16.5 8a2.5 2.5 0 0 0 0-5A4.7 4.7 0 0 0 12 8"/>`),
  upload: (size: number | string = '1em') => wrap(size, svg`<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/>`),
  fileText: (size: number | string = '1em') => wrap(size, svg`<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M16 13H8M16 17H8M10 9H8"/>`),
  table: (size: number | string = '1em') => wrap(size, svg`<path d="M12 3v18"/><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18"/>`),
};
