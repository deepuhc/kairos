import { html, css, type TemplateResult } from 'lit';

/**
 * Inline two-step delete confirmation, shared by the settings-hub editors
 * (Rules/Prompts/Roles/Hooks/MCP). Replaces the native `window.confirm()` —
 * which breaks the app's visual language — with an in-place "Delete → Confirm /
 * Cancel" swap that matches the benchmark bar.
 *
 * The host owns a single boolean (`confirming`) and passes it in; arming sets it
 * true, Cancel/confirm reset it. Keep the button label short ("Delete",
 * "Remove") — the confirm copy renders as "<label>?".
 */
export interface ConfirmDeleteProps {
  confirming: boolean;
  saving: boolean;
  label?: string;
  onArm: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function renderDeleteButton(p: ConfirmDeleteProps): TemplateResult {
  const label = p.label ?? 'Delete';
  if (!p.confirming) {
    return html`
      <button class="btn danger" ?disabled=${p.saving} @click=${p.onArm}>${label}</button>
    `;
  }
  return html`
    <span class="confirm-delete">
      <span class="confirm-delete-label">${label}?</span>
      <button class="btn danger" ?disabled=${p.saving} @click=${p.onConfirm}>
        ${p.saving ? 'Deleting…' : 'Confirm'}
      </button>
      <button class="btn" ?disabled=${p.saving} @click=${p.onCancel}>Cancel</button>
    </span>
  `;
}

/** Spread into the editor's `static styles`. */
export const confirmDeleteStyles = css`
  .confirm-delete {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .confirm-delete-label {
    font-size: var(--font-size-sm);
    color: var(--red);
    font-weight: 500;
  }
`;
