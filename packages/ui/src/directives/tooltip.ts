import { directive } from 'lit/directive.js';
import { AsyncDirective } from 'lit/async-directive.js';
import type { ElementPart } from 'lit';

let tipEl: HTMLDivElement | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let showTimer: ReturnType<typeof requestAnimationFrame> | null = null;
// The element the currently-shown tip is anchored to. Tracked so a tip can be
// dismissed when its anchor is torn out by a re-render (mouseleave never fires
// on a detached node, which otherwise strands the shared tip half-faded/blank).
let activeAnchor: HTMLElement | null = null;
const GAP = 8;

function ensureTip(): HTMLDivElement {
  if (tipEl) return tipEl;

  tipEl = document.createElement('div');
  tipEl.className = 'kairos-tip';
  document.body.appendChild(tipEl);

  const style = document.createElement('style');
  style.textContent = `
    .kairos-tip {
      position: fixed; z-index: 99999; pointer-events: none;
      max-width: 320px; padding: 6px 10px; border-radius: var(--radius);
      background: var(--surface-tooltip);
      border: 1px solid rgba(255, 255, 255, 0.10);
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.28);
      backdrop-filter: blur(var(--overlay-blur)); -webkit-backdrop-filter: blur(var(--overlay-blur));
      font-family: var(--font);
      font-size: var(--font-size-sm); line-height: 1.45; color: rgba(255, 255, 255, 0.88);
      white-space: pre-line; word-break: break-word;
      opacity: 0; transform: translateY(4px) scale(0.97);
      transition: opacity 0.12s cubic-bezier(0.2, 0, 0, 1), transform 0.12s cubic-bezier(0.2, 0, 0, 1);
    }
    .kairos-tip.visible { opacity: 1; transform: translateY(0) scale(1); }
    .kairos-tip.above { transform: translateY(-4px) scale(0.97); }
    .kairos-tip.above.visible { transform: translateY(0) scale(1); }
    .kairos-tip.side { transform: scale(0.97); }
    .kairos-tip.side.visible { transform: scale(1); }
    .usage-tip { min-width: 220px; text-align: left; }
    .usage-tip-head {
      font-family: var(--font-mono); font-size: var(--font-size-xs);
      color: rgba(255, 255, 255, 0.55); padding-bottom: 6px; margin-bottom: 6px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.10);
    }
    .usage-tip-row {
      display: flex; align-items: center; gap: 8px;
      padding: 2px 0; font-size: var(--font-size-sm);
    }
    .usage-tip-swatch {
      width: 8px; height: 8px; border-radius: 2px; flex: 0 0 auto;
    }
    .usage-tip-label { flex: 1 1 auto; color: rgba(255, 255, 255, 0.88); }
    .usage-tip-val {
      font-family: var(--font-mono); font-size: var(--font-size-xs);
      color: rgba(255, 255, 255, 0.55); white-space: nowrap;
    }
    .usage-tip-foot {
      margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(255, 255, 255, 0.10);
      font-size: var(--font-size-xs); color: rgba(255, 255, 255, 0.50);
    }
    .usage-tip-cache {
      margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(255, 255, 255, 0.10);
    }
    .usage-tip-cache-head {
      display: flex; align-items: baseline; gap: 6px;
      font-size: var(--font-size-sm); color: rgba(255, 255, 255, 0.88); margin-bottom: 4px;
    }
    .usage-tip-cache-rate {
      font-family: var(--font-mono); font-weight: 600;
    }
    .usage-tip-cache-rate.cache-good { color: var(--emerald); }
    .usage-tip-cache-rate.cache-fair { color: var(--amber); }
    .usage-tip-cache-rate.cache-poor { color: var(--red); }
    .usage-tip-cache-summary {
      font-size: var(--font-size-xs); color: rgba(255, 255, 255, 0.50); margin-bottom: 5px;
    }
    .usage-tip-tip {
      margin-top: 5px; padding-left: 8px; border-left: 2px solid rgba(255, 255, 255, 0.10);
      font-size: var(--font-size-xs); line-height: 1.4;
    }
    .usage-tip-tip-cause { color: rgba(255, 255, 255, 0.88); }
    .usage-tip-tip-action { color: rgba(255, 255, 255, 0.50); }
  `;
  document.head.appendChild(style);
  return tipEl;
}

type Placement = 'below' | 'above' | 'right' | 'left';

function fitsPlacement(
  p: Placement, tw: number, th: number,
  spaceBelow: number, spaceAbove: number, spaceRight: number, spaceLeft: number,
): boolean {
  switch (p) {
    case 'below': return spaceBelow >= th;
    case 'above': return spaceAbove >= th;
    case 'right': return spaceRight >= tw;
    case 'left': return spaceLeft >= tw;
  }
}

function positionTip(anchor: HTMLElement, prefer?: Placement): void {
  const tip = ensureTip();
  const ar = anchor.getBoundingClientRect();
  const tw = tip.offsetWidth;
  const th = tip.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const spaceBelow = vh - ar.bottom - GAP;
  const spaceAbove = ar.top - GAP;
  const spaceRight = vw - ar.right - GAP;
  const spaceLeft = ar.left - GAP;

  let top: number;
  let left: number;
  let placement: Placement = 'below';

  if (prefer && fitsPlacement(prefer, tw, th, spaceBelow, spaceAbove, spaceRight, spaceLeft)) {
    placement = prefer;
  } else if (spaceBelow >= th) {
    placement = 'below';
  } else if (spaceAbove >= th) {
    placement = 'above';
  } else if (spaceBelow >= spaceAbove) {
    if ((spaceRight >= tw || spaceLeft >= tw) && th > ar.height) {
      placement = spaceRight >= spaceLeft ? 'right' : 'left';
    } else {
      placement = 'below';
    }
  } else {
    if ((spaceRight >= tw || spaceLeft >= tw) && th > ar.height) {
      placement = spaceRight >= spaceLeft ? 'right' : 'left';
    } else {
      placement = 'above';
    }
  }

  tip.classList.remove('above', 'side');

  switch (placement) {
    case 'below':
      top = ar.bottom + GAP;
      left = ar.left + ar.width / 2 - tw / 2;
      break;
    case 'above':
      top = ar.top - th - GAP;
      left = ar.left + ar.width / 2 - tw / 2;
      tip.classList.add('above');
      break;
    case 'right':
      top = ar.top + ar.height / 2 - th / 2;
      left = ar.right + GAP;
      tip.classList.add('side');
      break;
    case 'left':
      top = ar.top + ar.height / 2 - th / 2;
      left = ar.left - tw - GAP;
      tip.classList.add('side');
      break;
  }

  left = Math.max(GAP, Math.min(left, vw - tw - GAP));
  top = Math.max(GAP, Math.min(top, vh - th - GAP));

  const tipBottom = top + th;
  const tipRight = left + tw;
  const overlapV = top < ar.bottom && tipBottom > ar.top;
  const overlapH = left < ar.right && tipRight > ar.left;

  if (overlapV && overlapH) {
    if (ar.bottom + GAP + th <= vh) {
      top = ar.bottom + GAP;
    } else if (ar.top - GAP - th >= 0) {
      top = ar.top - th - GAP;
    } else {
      left = Math.min(ar.right + GAP, vw - tw - GAP);
    }
  }

  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

function showTip(anchor: HTMLElement, content: string | Node, prefer?: Placement): void {
  // Guard against blank content slipping through to a visible, empty box.
  if (typeof content === 'string' && !content.trim()) return;

  if (hideTimer) clearTimeout(hideTimer);
  if (showTimer) cancelAnimationFrame(showTimer);

  const tip = ensureTip();
  activeAnchor = anchor;

  if (typeof content === 'string') {
    tip.textContent = content;
  } else {
    tip.textContent = '';
    tip.appendChild(content);
  }

  tip.style.left = '-9999px';
  tip.style.top = '-9999px';
  tip.classList.remove('visible');

  showTimer = requestAnimationFrame(() => {
    showTimer = requestAnimationFrame(() => {
      // A re-render between frames may have detached the anchor; showing a tip
      // for an element no longer on screen would strand it.
      if (!anchor.isConnected) { hideTip(); return; }
      positionTip(anchor, prefer);
      tip.classList.add('visible');
    });
  });
}

function hideTip(): void {
  if (showTimer) { cancelAnimationFrame(showTimer); showTimer = null; }
  activeAnchor = null;
  if (!tipEl) return;
  tipEl.classList.remove('visible');
  // Clear any prior pending clear-timer first. Calling hideTip twice in quick
  // succession (mouseleave + pointerdown, or mouseleave + a re-render's
  // disconnected()) would otherwise orphan the first timeout — a later showTip
  // only cancels the most recent one, so the orphan fires and blanks the text
  // of a tip that's since become visible again (an empty tooltip box).
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    hideTimer = null;
    // Guard against blanking a tip a newer showTip has already made visible.
    if (tipEl && !tipEl.classList.contains('visible')) tipEl.textContent = '';
  }, 160);
}

type TooltipValue = string | (() => string | Node) | null | undefined;
interface TooltipOptions { content: TooltipValue; prefer?: Placement }
type TooltipContent = TooltipValue | TooltipOptions;

function isOptions(v: TooltipContent): v is TooltipOptions {
  return v !== null && typeof v === 'object' && 'content' in v;
}

const tooltip = directive(
  class extends AsyncDirective {
    _el: HTMLElement | null = null;
    _onEnter: ((e: Event) => void) | null = null;
    _onLeave: (() => void) | null = null;
    _content: TooltipValue = null;
    _prefer: Placement | undefined = undefined;

    update(part: ElementPart, [raw]: [TooltipContent]): void {
      const el = part.element as HTMLElement;
      this._el = el;
      if (isOptions(raw)) {
        this._content = raw.content;
        this._prefer = raw.prefer;
      } else {
        this._content = raw;
        this._prefer = undefined;
      }

      if (el.hasAttribute('title')) {
        el.removeAttribute('title');
      }

      if (!this._onEnter) {
        this._onEnter = () => {
          const c = this._content;
          if (!c) return;
          const resolved = typeof c === 'function' ? c() : c;
          if (!resolved) return;
          showTip(el, resolved, this._prefer);
        };
        this._onLeave = () => hideTip();

        el.addEventListener('mouseenter', this._onEnter);
        el.addEventListener('mouseleave', this._onLeave);
        el.addEventListener('pointerdown', this._onLeave);
      }
    }

    // Lit tears the directive down when its anchor leaves the DOM. mouseleave
    // won't fire on a detached node, so dismiss any tip anchored here to keep
    // the shared tip from being stranded (blank/half-faded) by a re-render.
    disconnected(): void {
      if (this._el && activeAnchor === this._el) hideTip();
    }

    reconnected(): void {}

    render(_content: TooltipContent): void {}
  },
);

// Shows the element's own text as a tooltip, but only when that text is actually
// truncated (ellipsised). Applied to any single-line clamped label — session
// titles, paths, etc. — so the full text is recoverable on hover without
// littering static tooltips on labels that fit. Optional override text lets a
// caller surface a richer string than the visible label when it does overflow.
const overflowTooltip = directive(
  class extends AsyncDirective {
    _el: HTMLElement | null = null;
    _override: string | null = null;
    _prefer: Placement | undefined = undefined;
    _onEnter: ((e: Event) => void) | null = null;
    _onLeave: (() => void) | null = null;

    update(part: ElementPart, [override, prefer]: [string | undefined, Placement | undefined]): void {
      const el = part.element as HTMLElement;
      this._el = el;
      this._override = override ?? null;
      this._prefer = prefer;

      if (!this._onEnter) {
        this._onEnter = () => {
          const target = this._el;
          if (!target) return;
          if (target.scrollWidth <= target.clientWidth) return;
          const content = this._override ?? target.textContent ?? '';
          if (!content.trim()) return;
          showTip(target, content, this._prefer);
        };
        this._onLeave = () => hideTip();

        el.addEventListener('mouseenter', this._onEnter);
        el.addEventListener('mouseleave', this._onLeave);
        el.addEventListener('pointerdown', this._onLeave);
      }
    }

    disconnected(): void {
      if (this._el && activeAnchor === this._el) hideTip();
    }

    reconnected(): void {}

    render(_override?: string, _prefer?: Placement): void {}
  },
);

export { tooltip, overflowTooltip, showTip, hideTip };
