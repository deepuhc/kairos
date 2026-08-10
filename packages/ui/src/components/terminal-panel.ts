import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { io, type Socket } from '../services/events.js';
import { focusRing } from '../styles/focus.js';
import { icon } from './icons.js';

interface LogEntry {
  stream: 'stdout' | 'stderr';
  text: string;
}

@customElement('kairos-terminal')
export class DevaiTerminal extends LitElement {
  @state() private lines: LogEntry[] = [];
  @state() private expanded = false;
  @state() private running = false;
  @state() private currentOp = '';
  @state() private copied = false;
  private socket: Socket | null = null;
  private currentListener: string | null = null;
  private copyResetTimer: ReturnType<typeof setTimeout> | null = null;

  static styles = [focusRing, css`
    :host { display: block; }
    :host([hidden]) { display: none; }
    .panel {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      background: var(--surface-modal);
      border-top: 1px solid var(--glass-border);
      box-shadow: 0 -2px 12px rgba(0, 0, 0, 0.4);
      transition: height 0.18s cubic-bezier(0.2, 0, 0, 1);
      z-index: 100;
    }
    .panel.collapsed { height: 40px; }
    .panel.expanded { height: 320px; }
    .bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 16px;
      height: 40px;
      cursor: pointer;
      user-select: none;
    }
    .bar-left {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: var(--font-size-base);
      color: var(--gray);
    }
    .indicator {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--neutral-gray);
    }
    .indicator.running { background: var(--emerald); animation: pulse 1s infinite; }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
    .bar-right {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .toggle {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      font-size: var(--font-size-md);
      color: var(--gray);
      background: none;
      border: none;
      border-radius: var(--radius-sm);
      cursor: pointer;
      transition: color var(--transition-fast), background var(--transition-fast);
    }
    .toggle:hover { color: var(--white); background: var(--w8); }
    .output {
      height: 280px;
      overflow-y: auto;
      padding: 0 16px 16px;
      font-family: var(--font-mono);
      font-size: var(--font-size-base);
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .output .stderr { color: var(--red); }
    .output .stdout { color: var(--white); }
    .empty-msg {
      color: var(--neutral-gray);
      font-style: italic;
    }
    .clear-btn {
      font-size: var(--font-size-sm);
      color: var(--gray);
      background: none;
      border: none;
      border-radius: var(--radius-sm);
      padding: 5px 8px;
      cursor: pointer;
      transition: color var(--transition-fast), background var(--transition-fast);
    }
    .clear-btn:hover { color: var(--white); background: var(--w8); }
  `];

  connectedCallback() {
    super.connectedCallback();
    this.socket = io();

    // Listen for any operation start
    window.addEventListener('kairos-operation', ((e: CustomEvent) => {
      this.subscribe(e.detail.operationId);
    }) as EventListener);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.socket?.disconnect();
  }

  private subscribe(operationId: string) {
    if (!this.socket) return;

    // Unsubscribe from previous
    if (this.currentListener) {
      this.socket.off(`output:${this.currentListener}`);
      this.socket.off(`done:${this.currentListener}`);
    }

    this.currentOp = operationId;
    this.currentListener = operationId;
    this.running = true;
    this.expanded = true;
    this.lines = [];

    this.socket.on(`output:${operationId}`, (entry: LogEntry) => {
      this.lines = [...this.lines, entry];
      this.scrollToBottom();
    });

    this.socket.on(`done:${operationId}`, (result: { code: number }) => {
      this.running = false;
      this.lines = [...this.lines, {
        stream: result.code === 0 ? 'stdout' : 'stderr',
        text: `\n--- Process exited with code ${result.code} ---\n`,
      }];
    });
  }

  private async copyOutput(e: Event) {
    e.stopPropagation();
    const text = this.lines.map((l) => l.text).join('');
    try {
      await navigator.clipboard.writeText(text);
      this.copied = true;
      if (this.copyResetTimer) clearTimeout(this.copyResetTimer);
      this.copyResetTimer = setTimeout(() => { this.copied = false; }, 1500);
    } catch {
      // Clipboard unavailable (insecure context / denied) — nothing to surface.
    }
  }

  private scrollToBottom() {
    requestAnimationFrame(() => {
      const el = this.shadowRoot?.querySelector('.output');
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  render() {
    return html`
      <div class="panel ${this.expanded ? 'expanded' : 'collapsed'}">
        <div class="bar" @click=${() => { this.expanded = !this.expanded; }}>
          <div class="bar-left">
            <div class="indicator ${this.running ? 'running' : ''}"></div>
            <span>${this.running ? 'Running...' : this.lines.length ? 'Terminal' : 'No output'}</span>
          </div>
          <div class="bar-right">
            ${this.lines.length ? html`
              <button class="clear-btn" @click=${this.copyOutput}>${this.copied ? 'Copied' : 'Copy'}</button>
              <button class="clear-btn" @click=${(e: Event) => { e.stopPropagation(); this.lines = []; }}>Clear</button>
            ` : ''}
            <button class="toggle" aria-label=${this.expanded ? 'Collapse terminal' : 'Expand terminal'}>${this.expanded ? icon.chevronDown(16) : icon.chevronUp(16)}</button>
          </div>
        </div>
        ${this.expanded ? html`
          <div class="output">
            ${this.lines.length === 0
              ? html`<span class="empty-msg">Command output will appear here...</span>`
              : this.lines.map((l) => html`<span class="${l.stream}">${l.text}</span>`)
            }
          </div>
        ` : ''}
      </div>
    `;
  }
}
