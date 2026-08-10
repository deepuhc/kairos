import { html, css, nothing, type TemplateResult } from 'lit';

/**
 * Shared empty-state block: a muted icon, a title, a line of copy, and an
 * optional call-to-action button. Replaces bare "No X found" text so empty
 * views read as intentional (and get a little personality) rather than broken.
 *
 * Spread `emptyStateStyles` into the host's `static styles`, then render
 * `emptyState({...})` where the bare text used to be.
 */
export interface EmptyStateProps {
  icon?: TemplateResult;
  title: string;
  message?: string | TemplateResult;
  actionLabel?: string;
  onAction?: () => void;
}

export const emptyStateStyles = css`
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    gap: 10px;
    padding: 56px 24px;
    color: var(--gray);
  }
  .empty-state .es-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: var(--w5);
    color: var(--neutral-gray);
    margin-bottom: 2px;
  }
  .empty-state .es-icon svg { display: block; }
  .empty-state .es-title {
    font-size: var(--font-size-lg);
    font-weight: 600;
    color: var(--bright-white);
  }
  .empty-state .es-message {
    font-size: var(--font-size-md);
    color: var(--gray);
    max-width: 42ch;
    line-height: 1.5;
  }
  .empty-state .es-action {
    margin-top: 8px;
    padding: 8px 16px;
    border: 1px solid var(--accent-a35);
    border-radius: var(--radius);
    background: var(--accent-a15);
    color: var(--bright-white);
    font-size: var(--font-size-md);
    font-weight: 500;
    cursor: pointer;
    transition: all var(--transition-fast);
  }
  .empty-state .es-action:hover {
    background: var(--accent-a25);
    border-color: var(--accent);
  }
`;

export function emptyState(p: EmptyStateProps): TemplateResult {
  return html`
    <div class="empty-state">
      ${p.icon ? html`<div class="es-icon">${p.icon}</div>` : nothing}
      <div class="es-title">${p.title}</div>
      ${p.message ? html`<div class="es-message">${p.message}</div>` : nothing}
      ${p.actionLabel && p.onAction
        ? html`<button class="es-action" @click=${p.onAction}>${p.actionLabel}</button>`
        : nothing}
    </div>
  `;
}
