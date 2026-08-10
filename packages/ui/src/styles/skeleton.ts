import { css, html, type TemplateResult } from 'lit';

/**
 * Shared skeleton-loading styles + helpers. Replaces centered "Loading…" text
 * with shimmering placeholder shapes so a view reads as *arriving* rather than
 * blank. Spread `skeletonStyles` into a component's `static styles`, then render
 * `skeletonCardGrid()` / `skeletonRows()` while `loading` is true.
 *
 * The shimmer is a moving highlight over a base fill (both token-driven), gated
 * behind prefers-reduced-motion so it holds still for users who opt out.
 */
export const skeletonStyles = css`
  .sk {
    position: relative;
    overflow: hidden;
    background: var(--w5);
    border-radius: var(--radius-sm);
  }
  .sk::after {
    content: '';
    position: absolute;
    inset: 0;
    transform: translateX(-100%);
    background: linear-gradient(90deg, transparent, var(--w8), transparent);
    animation: sk-shimmer 1.4s ease-in-out infinite;
  }
  @media (prefers-reduced-motion: reduce) {
    .sk::after { animation: none; }
  }
  @keyframes sk-shimmer {
    100% { transform: translateX(100%); }
  }
  .sk-card {
    border: 1px solid var(--glass-border);
    border-radius: var(--radius-lg);
    padding: 16px;
    background: var(--glass-bg);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .sk-line { height: 10px; }
  .sk-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 12px;
  }
`;

/** A grid of placeholder cards matching the catalog's card rhythm. */
export function skeletonCardGrid(count = 6): TemplateResult {
  return html`
    <div class="sk-grid" aria-hidden="true">
      ${Array.from({ length: count }, () => html`
        <div class="sk-card">
          <div class="sk sk-line" style="width: 45%; height: 14px;"></div>
          <div class="sk sk-line" style="width: 90%;"></div>
          <div class="sk sk-line" style="width: 75%;"></div>
          <div class="sk sk-line" style="width: 30%; margin-top: 6px;"></div>
        </div>
      `)}
    </div>
  `;
}

/** A stack of placeholder rows for list-style views (sessions, etc.). */
export function skeletonRows(count = 6): TemplateResult {
  return html`
    <div aria-hidden="true" style="display:flex;flex-direction:column;gap:10px;">
      ${Array.from({ length: count }, () => html`
        <div style="display:flex;flex-direction:column;gap:8px;padding:14px 16px;border:1px solid var(--glass-border);border-radius:var(--radius-lg);">
          <div class="sk sk-line" style="width: 35%; height: 13px;"></div>
          <div class="sk sk-line" style="width: 60%;"></div>
        </div>
      `)}
    </div>
  `;
}
