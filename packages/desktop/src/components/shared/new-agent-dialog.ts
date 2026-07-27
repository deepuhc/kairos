import { LitElement, html, css } from "lit";
import { customElement, property, state, query } from "lit/decorators.js";

export interface ModelOption {
  id: string;
  label: string;
  description: string;
  command: string;
  args: string[];
  streamJson?: boolean;
}

export const DEFAULT_MODELS: ModelOption[] = [
  {
    id: "ollama-mistral",
    label: "Mistral (Ollama)",
    description: "Fast local model, good for general tasks",
    command: "ollama",
    args: ["run", "mistral"],
  },
  {
    id: "ollama-llama3",
    label: "Llama 3.1 (Ollama)",
    description: "Local model, better for writing",
    command: "ollama",
    args: ["run", "llama3.1:8b"],
  },
  {
    id: "interpreter-mistral",
    label: "Open Interpreter + Mistral",
    description: "Agentic — file/shell access, local",
    command: "interpreter",
    args: ["--model", "ollama/mistral"],
  },
  {
    id: "goose",
    label: "Goose (Local)",
    description: "Agentic assistant with extensions",
    command: "goose",
    args: ["session"],
  },
  {
    id: "claude",
    label: "Claude (Cloud)",
    description: "Best reasoning, requires API key",
    command: "claude",
    args: ["--output-format", "stream-json", "--verbose"],
    streamJson: true,
  },
];

@customElement("new-agent-dialog")
export class NewAgentDialog extends LitElement {
  static styles = css`
    :host {
      display: contents;
    }

    .overlay {
      position: fixed;
      inset: 0;
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
      animation: fadeIn 150ms ease;
    }

    .overlay[hidden] { display: none; }

    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }

    @keyframes scaleIn {
      from { transform: scale(0.95); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }

    .backdrop {
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
    }

    .dialog {
      position: relative;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 24px;
      width: 420px;
      max-width: 90vw;
      box-shadow: var(--shadow-lg);
      animation: scaleIn 200ms ease;
    }

    h3 {
      font-size: 1rem;
      font-weight: 600;
      color: var(--text);
      margin-bottom: 16px;
    }

    .field {
      margin-bottom: 12px;
    }

    label {
      display: block;
      font-size: 0.75rem;
      font-weight: 500;
      color: var(--text-dim);
      margin-bottom: 6px;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    input, select {
      width: 100%;
      padding: 10px 12px;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      color: var(--text);
      font-family: var(--font-sans);
      font-size: 0.85rem;
      outline: none;
      transition: border-color var(--transition-fast);
    }

    input:focus, select:focus {
      border-color: var(--amber);
    }

    input::placeholder {
      color: var(--text-muted);
    }

    select {
      appearance: none;
      cursor: pointer;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%2364748b' d='M6 8L1 3h10z'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 12px center;
      padding-right: 32px;
    }

    select option {
      background: var(--surface);
      color: var(--text);
    }

    .model-desc {
      font-size: 0.72rem;
      color: var(--text-muted);
      margin-top: 4px;
    }

    .error {
      font-size: 0.78rem;
      color: var(--red);
      margin-bottom: 12px;
      padding: 8px 10px;
      background: rgba(239, 68, 68, 0.1);
      border-radius: var(--radius-sm);
    }

    .error[hidden] { display: none; }

    .actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
      margin-top: 16px;
    }

    button {
      padding: 8px 16px;
      border-radius: 6px;
      font-size: 0.82rem;
      font-weight: 500;
      cursor: pointer;
      transition: all var(--transition-fast);
    }

    .cancel-btn {
      background: transparent;
      border: 1px solid var(--border);
      color: var(--text-dim);
    }

    .cancel-btn:hover {
      background: var(--surface2);
      color: var(--text);
    }

    .create-btn {
      background: var(--amber);
      border: 1px solid var(--amber);
      color: var(--bg);
      font-weight: 600;
    }

    .create-btn:hover {
      opacity: 0.9;
    }
  `;

  @property({ type: Boolean }) open = false;
  @property() defaultName = "";
  @property() error = "";
  @property({ type: Array }) models: ModelOption[] = DEFAULT_MODELS;

  @state() private name = "";
  @state() private workingDirectory = "";
  @state() private selectedModelId = DEFAULT_MODELS[0].id;

  @query("#name-input") private nameInput!: HTMLInputElement;

  protected updated(changed: Map<string, unknown>): void {
    if (changed.has("open") && this.open) {
      this.name = "";
      this.workingDirectory = "";
      this.selectedModelId = this.models[0]?.id || DEFAULT_MODELS[0].id;
      requestAnimationFrame(() => this.nameInput?.focus());
    }
  }

  get selectedModel(): ModelOption {
    return this.models.find((m) => m.id === this.selectedModelId) || this.models[0];
  }

  render() {
    return html`
      <div class="overlay" ?hidden=${!this.open} @keydown=${this.handleKeydown}>
        <div class="backdrop" @click=${this.handleCancel}></div>
        <div class="dialog">
          <h3>New Agent</h3>

          <div class="field">
            <label for="model-select">Model</label>
            <select
              id="model-select"
              .value=${this.selectedModelId}
              @change=${(e: Event) => this.selectedModelId = (e.target as HTMLSelectElement).value}
            >
              ${this.models.map((m) => html`
                <option value=${m.id}>${m.label}</option>
              `)}
            </select>
            <div class="model-desc">${this.selectedModel.description}</div>
          </div>

          <div class="field">
            <label for="name-input">Name</label>
            <input
              id="name-input"
              type="text"
              placeholder=${this.defaultName}
              .value=${this.name}
              @input=${(e: InputEvent) => this.name = (e.target as HTMLInputElement).value}
            />
          </div>

          <div class="field">
            <label for="dir-input">Working Directory</label>
            <input
              id="dir-input"
              type="text"
              placeholder="~/projects/my-app"
              .value=${this.workingDirectory}
              @input=${(e: InputEvent) => this.workingDirectory = (e.target as HTMLInputElement).value}
            />
          </div>

          <div class="error" ?hidden=${!this.error}>${this.error}</div>

          <div class="actions">
            <button class="cancel-btn" @click=${this.handleCancel}>Cancel</button>
            <button class="create-btn" @click=${this.handleCreate}>Create</button>
          </div>
        </div>
      </div>
    `;
  }

  private handleKeydown(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      this.handleCancel();
    } else if (e.key === "Enter") {
      this.handleCreate();
    }
  }

  private handleCreate(): void {
    this.dispatchEvent(new CustomEvent("create-agent", {
      detail: {
        name: this.name || this.defaultName,
        workingDirectory: this.workingDirectory,
        model: this.selectedModel,
      },
      bubbles: true,
      composed: true,
    }));
  }

  private handleCancel(): void {
    this.dispatchEvent(new CustomEvent("cancel", { bubbles: true, composed: true }));
  }
}
