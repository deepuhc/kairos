import { LitElement, html, css, nothing, unsafeCSS } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import xtermStyles from '@xterm/xterm/css/xterm.css?inline';
import { tooltip } from '../directives/tooltip.js';
import { ensureBackendCookie } from '../services/backend-auth.js';
import { icon } from './icons.js';

type TerminalStatus = 'connecting' | 'open' | 'closed' | 'error';

type ServerMessage =
  | { type: 'output'; data: string }
  | { type: 'exit'; code: number; signal?: string | null }
  | { type: 'error'; message: string };

@customElement('agents-terminal')
export class AgentsTerminal extends LitElement {
  @property({ type: Boolean, reflect: true }) override hidden = false;
  @property({ type: String }) sessionId = '';
  @property({ type: String }) cwd = '';
  @state() private status: TerminalStatus = 'connecting';
  @state() private error = '';

  private term?: Terminal;
  private fitAddon?: FitAddon;
  private ws?: WebSocket;
  private wsSeq = 0;
  private resizeObserver?: ResizeObserver;
  private themeObserver?: MutationObserver;
  private resizeFrame = 0;
  private fitTimer = 0;
  private currentSessionId = '';
  private currentCwd = '';
  private receivedOutput = false;

  static styles = [unsafeCSS(xtermStyles), css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      background: var(--bg-base);
    }
    :host([hidden]) { display: none; }
    .head {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 16px;
      border-bottom: 1px solid var(--glass-border);
      background: var(--surface-modal, var(--bg));
      flex-shrink: 0;
    }
    .title {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    h2 {
      margin: 0;
      font-size: var(--font-size-md);
      font-weight: 600;
      color: var(--white);
    }
    .cwd {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--neutral-gray);
      font-size: var(--font-size-xs);
      font-family: var(--font-mono);
    }
    .status {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--neutral-gray);
      font-size: var(--font-size-xs);
      font-weight: 600;
    }
    .dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--neutral-gray);
    }
    .status.open .dot { background: var(--success, #22c55e); }
    .status.connecting .dot { background: var(--accent); animation: pulse 1.2s ease-in-out infinite; }
    .status.error .dot { background: var(--danger, #e5484d); }
    .action,
    .close {
      border: none;
      border-radius: var(--radius);
      background: transparent;
      color: var(--neutral-gray);
      cursor: pointer;
      transition: background var(--transition-fast), color var(--transition-fast);
    }
    .action {
      padding: 5px 10px;
      border: 1px solid var(--glass-border);
      font-size: var(--font-size-sm);
      font-weight: 600;
    }
    .action:hover { border-color: var(--accent-a35); background: var(--accent-a15); color: var(--white); }
    .close {
      padding: 2px 6px;
      font-size: 18px;
      line-height: 1;
    }
    .close:hover { color: var(--white); background: var(--w5); }
    .close svg { display: block; }
    .terminal-frame {
      flex: 1;
      min-height: 0;
      padding: 10px;
      background:
        radial-gradient(circle at 15% 0%, var(--accent-a10), transparent 32%),
        linear-gradient(180deg, var(--bg-subtle) 0%, var(--bg-base) 100%);
    }
    .terminal-host {
      --terminal-inset: 9px;
      width: 100%;
      height: 100%;
      overflow: hidden;
      border: 1px solid var(--glass-border);
      border-radius: 10px;
      background: var(--bg-base);
      box-shadow: inset 0 1px 0 var(--w4);
    }
    .terminal-host:focus-within {
      border-color: var(--accent-a35);
      box-shadow: 0 0 0 3px var(--accent-a10);
    }
    .error-bar {
      flex-shrink: 0;
      padding: 8px 12px;
      border-top: 1px solid rgba(229, 72, 77, 0.25);
      background: rgba(229, 72, 77, 0.12);
      color: var(--danger, #e5484d);
      font-size: var(--font-size-xs);
    }
    .xterm {
      height: 100%;
      padding: var(--terminal-inset);
      box-sizing: border-box;
    }
    .xterm .xterm-viewport {
      top: var(--terminal-inset);
      right: var(--terminal-inset);
      bottom: var(--terminal-inset);
      left: var(--terminal-inset);
      background: transparent !important;
      scrollbar-color: var(--w25) transparent;
    }
    .xterm .xterm-viewport::-webkit-scrollbar {
      width: 10px;
      height: 10px;
    }
    .xterm .xterm-viewport::-webkit-scrollbar-track,
    .xterm .xterm-viewport::-webkit-scrollbar-corner {
      background: transparent;
    }
    .xterm .xterm-viewport::-webkit-scrollbar-button {
      display: none;
      width: 0;
      height: 0;
    }
    .xterm .xterm-viewport::-webkit-scrollbar-thumb {
      background: var(--w15);
      border: 2px solid transparent;
      border-radius: 999px;
      background-clip: content-box;
    }
    .xterm .xterm-viewport::-webkit-scrollbar-thumb:hover {
      background: var(--w25);
      background-clip: content-box;
    }
    @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
  `];

  firstUpdated() {
    this.initTerminal();
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has('hidden') && !this.hidden) {
      this.scheduleFit(180);
    }
    if (
      (changed.has('cwd') || changed.has('sessionId')) &&
      this.term &&
      (this.cwd !== this.currentCwd || this.sessionId !== this.currentSessionId)
    ) {
      this.reconnect();
    }
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener('theme-changed', this.applyTheme);
    this.themeObserver = new MutationObserver(this.applyTheme);
    this.themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-theme-kind'],
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener('theme-changed', this.applyTheme);
    this.themeObserver?.disconnect();
    this.themeObserver = undefined;
    this.teardown();
  }

  private initTerminal() {
    const host = this.renderRoot.querySelector<HTMLElement>('.terminal-host');
    if (!host) return;
    this.term = new Terminal({
      cursorBlink: true,
      convertEol: false,
      fontFamily: 'var(--font-mono), ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 12,
      lineHeight: 1.28,
      scrollback: 5000,
      theme: this.xtermTheme(),
    });
    this.fitAddon = new FitAddon();
    this.term.loadAddon(this.fitAddon);
    this.term.open(host);
    this.term.attachCustomKeyEventHandler((event) => this.handleKeyEvent(event));
    this.term.onData((data) => this.send({ type: 'input', data }));
    this.resizeObserver = new ResizeObserver(() => this.scheduleFit(90));
    this.resizeObserver.observe(host);
    this.fit();
    this.connect();
    this.scheduleFit(90);
  }

  private handleKeyEvent(event: KeyboardEvent): boolean {
    if (event.type !== 'keydown' || event.altKey) return true;
    const key = event.key.toLowerCase();
    const primary = event.ctrlKey || event.metaKey;
    const copy = key === 'c' && primary && (event.shiftKey || event.metaKey);
    const paste = key === 'v' && primary;

    if (copy) {
      event.preventDefault();
      event.stopPropagation();
      void this.copySelectionToClipboard();
      return false;
    }
    if (paste) {
      event.preventDefault();
      event.stopPropagation();
      void this.pasteFromClipboard();
      return false;
    }

    return true;
  }

  private async copySelectionToClipboard() {
    const text = this.term?.getSelection() ?? '';
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard may be unavailable or denied by the host webview.
    }
  }

  private async pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) this.term?.paste(text);
    } catch {
      // Clipboard may be unavailable or denied by the host webview.
    }
  }

  private applyTheme = () => {
    if (!this.term) return;
    this.term.options.theme = this.xtermTheme();
  };

  private xtermTheme(): ITheme {
    const root = document.documentElement;
    const light = root.getAttribute('data-theme-kind') === 'light';
    const token = (name: string, fallback: string) =>
      getComputedStyle(this).getPropertyValue(name).trim() || fallback;
    const bg = token('--bg-base', light ? '#fbfbfb' : '#05070a');
    const fg = token('--white', light ? '#27272a' : '#d6dde8');
    const strong = token('--bright-white', light ? '#18181b' : '#ffffff');
    const muted = token('--neutral-gray', light ? '#71717a' : '#6b7280');
    const subtleBg = token('--bg-elevated', light ? '#ffffff' : '#111827');

    return {
      background: bg,
      foreground: fg,
      cursor: strong,
      cursorAccent: bg,
      selectionBackground: token('--accent-a35', light ? 'rgba(59, 130, 246, 0.30)' : 'rgba(59, 130, 246, 0.34)'),
      selectionInactiveBackground: token('--accent-a15', light ? 'rgba(59, 130, 246, 0.12)' : 'rgba(59, 130, 246, 0.16)'),
      scrollbarSliderBackground: token('--w12', light ? 'rgba(9, 9, 11, 0.11)' : 'rgba(255, 255, 255, 0.11)'),
      scrollbarSliderHoverBackground: token('--w25', light ? 'rgba(9, 9, 11, 0.22)' : 'rgba(255, 255, 255, 0.24)'),
      scrollbarSliderActiveBackground: token('--w40', light ? 'rgba(9, 9, 11, 0.40)' : 'rgba(255, 255, 255, 0.40)'),
      black: light ? strong : subtleBg,
      red: token('--red', '#ef4444'),
      green: token('--green', '#22c55e'),
      yellow: token('--yellow', '#eab308'),
      blue: token('--accent', '#60a5fa'),
      magenta: token('--pink', '#d946ef'),
      cyan: token('--teal', '#22d3ee'),
      white: light ? fg : token('--w80', '#e5e7eb'),
      brightBlack: muted,
      brightRed: token('--red', '#f87171'),
      brightGreen: token('--emerald', '#4ade80'),
      brightYellow: token('--yellow', '#facc15'),
      brightBlue: token('--purple-light', '#93c5fd'),
      brightMagenta: token('--pink', '#e879f9'),
      brightCyan: token('--teal', '#67e8f9'),
      brightWhite: strong,
    };
  }

  private async connect() {
    if (!this.term) return;
    this.currentSessionId = this.sessionId;
    this.currentCwd = this.cwd;
    this.status = 'connecting';
    this.error = '';
    this.receivedOutput = false;
    this.fit();
    this.term.reset();
    this.term.writeln('\x1b[2mOpening terminal...\x1b[0m');
    const params = new URLSearchParams({
      sessionId: this.sessionId,
      cwd: this.cwd,
      cols: String(this.term.cols || 80),
      rows: String(this.term.rows || 24),
    });
    const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const seq = ++this.wsSeq;
    await ensureBackendCookie();
    if (seq !== this.wsSeq || !this.term) return;
    const ws = new WebSocket(`${scheme}//${location.host}/terminal/ws?${params.toString()}`);
    this.ws = ws;
    ws.addEventListener('open', () => {
      if (seq !== this.wsSeq) return;
      this.status = 'open';
      this.scheduleFit(90);
      this.term?.focus();
    });
    ws.addEventListener('message', (event) => {
      if (seq === this.wsSeq) this.onMessage(String(event.data));
    });
    ws.addEventListener('close', (event) => {
      if (seq !== this.wsSeq) return;
      if (this.status !== 'error') {
        this.status = 'closed';
        if (event.reason) this.error = event.reason;
      }
    });
    ws.addEventListener('error', () => {
      if (seq !== this.wsSeq) return;
      this.status = 'error';
      this.error = 'Terminal socket failed.';
    });
  }

  private reconnect() {
    this.closeSocket();
    this.connect();
  }

  private onMessage(raw: string) {
    let message: ServerMessage;
    try {
      message = JSON.parse(raw) as ServerMessage;
    } catch {
      return;
    }
    if (message.type === 'output') {
      if (!this.receivedOutput) {
        this.term?.reset();
        this.receivedOutput = true;
      }
      this.term?.write(message.data);
      return;
    }
    if (message.type === 'exit') {
      const suffix = message.signal ? ` (${message.signal})` : '';
      this.term?.writeln(`\r\n\x1b[2m[process exited ${message.code}${suffix}]\x1b[0m`);
      this.status = 'closed';
      return;
    }
    if (message.type === 'error') {
      this.status = 'error';
      this.error = message.message;
      this.term?.writeln(`\r\n\x1b[31m${message.message}\x1b[0m`);
    }
  }

  private send(message: Record<string, unknown>) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(message));
  }

  private scheduleFit(delayMs = 0) {
    if (delayMs > 0) {
      if (this.fitTimer) window.clearTimeout(this.fitTimer);
      this.fitTimer = window.setTimeout(() => {
        this.fitTimer = 0;
        this.scheduleFit();
      }, delayMs);
      return;
    }
    if (this.resizeFrame) return;
    this.resizeFrame = requestAnimationFrame(() => {
      this.resizeFrame = 0;
      if (this.fit()) this.sendResize();
    });
  }

  private fit(): boolean {
    const host = this.renderRoot.querySelector<HTMLElement>('.terminal-host');
    const rect = host?.getBoundingClientRect();
    if (this.hidden || !rect || rect.width < 40 || rect.height < 40) return false;
    try {
      this.fitAddon?.fit();
      return true;
    } catch {
      // Xterm can briefly report zero geometry while the side-panel animates.
      return false;
    }
  }

  private sendResize() {
    if (!this.term) return;
    this.send({ type: 'resize', cols: this.term.cols, rows: this.term.rows });
  }

  private closeSocket() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.send({ type: 'close' });
    }
    try { this.ws?.close(); } catch { /* already closed */ }
    this.ws = undefined;
    this.wsSeq++;
  }

  private teardown() {
    if (this.fitTimer) window.clearTimeout(this.fitTimer);
    this.fitTimer = 0;
    if (this.resizeFrame) cancelAnimationFrame(this.resizeFrame);
    this.resizeFrame = 0;
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    this.closeSocket();
    this.term?.dispose();
    this.term = undefined;
    this.fitAddon = undefined;
  }

  render() {
    const statusLabel = this.status === 'open'
      ? 'Connected'
      : this.status === 'connecting'
        ? 'Connecting'
        : this.status === 'error'
          ? 'Error'
          : 'Closed';
    return html`
      <div class="head">
        <div class="title">
          <h2>Terminal</h2>
          <div class="cwd" ${tooltip(this.cwd)}>${this.cwd}</div>
        </div>
        <div class="status ${this.status}"><span class="dot"></span>${statusLabel}</div>
        ${this.status === 'closed' || this.status === 'error'
          ? html`<button class="action" @click=${this.reconnect}>Reconnect</button>`
          : nothing}
        <button class="close" ${tooltip('Hide terminal')} @click=${() => this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }))}>${icon.close(18)}</button>
      </div>
      <div class="terminal-frame">
        <div class="terminal-host"></div>
      </div>
      ${this.error ? html`<div class="error-bar">${this.error}</div>` : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'agents-terminal': AgentsTerminal;
  }
}
