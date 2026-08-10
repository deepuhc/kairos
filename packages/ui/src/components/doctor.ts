import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { getDoctorStatus, execute } from '../services/api.js';
import { io, type Socket } from '../services/events.js';
import { tooltip } from '../directives/tooltip.js';

interface DoctorCheck {
  group: string;
  name: string;
  passed: boolean;
  details: string[];
}

@customElement('kairos-doctor')
export class DevaiDoctor extends LitElement {
  @state() private checks: DoctorCheck[] = [];
  @state() private allPassed = true;
  @state() private loading = true;
  @state() private fixing = false;
  private socket: Socket | null = null;

  static styles = css`
    :host { display: block; }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
    }
    h2 {
      font-size: var(--font-size-2xl);
      font-weight: 600;
      color: var(--bright-white);
    }
    .header-actions {
      display: flex;
      gap: 8px;
    }
    .btn {
      padding: 8px 16px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--glass-bg);
      backdrop-filter: blur(var(--glass-blur));
      -webkit-backdrop-filter: blur(var(--glass-blur));
      color: var(--gray);
      font-size: var(--font-size-base);
      cursor: pointer;
      transition: all var(--transition-fast);
    }
    .btn:hover { background: var(--w10); border-color: var(--glass-border-hover); color: var(--white); }
    .btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .btn.primary {
      background: var(--accent-a25);
      border-color: var(--accent-a35);
      color: var(--purple-light);
    }
    .btn.primary:hover { background: var(--accent-a35); color: var(--bright-white); }
    .loading {
      text-align: center;
      padding: 48px;
      color: var(--gray);
    }
    .summary {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 16px;
      border-radius: var(--radius-lg);
      margin-bottom: 20px;
      font-weight: 600;
      font-size: var(--font-size-lg);
    }
    .summary.pass {
      background: var(--green-a15);
      border: 1px solid var(--green-a30);
      color: var(--emerald);
    }
    .summary.fail {
      background: var(--red-a15);
      border: 1px solid var(--red-a25);
      color: var(--red);
    }
    .group-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      font-size: var(--font-size-lg);
      font-weight: 600;
      color: var(--bright-white);
      margin: 20px 0 10px;
      padding-bottom: 6px;
      border-bottom: 1px solid var(--glass-border);
    }
    .group-fix {
      padding: 4px 10px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: transparent;
      color: var(--gray);
      font-size: var(--font-size-sm);
      font-weight: 500;
      cursor: pointer;
      transition: all var(--transition-fast);
    }
    .group-fix:hover {
      background: var(--accent-a15);
      border-color: var(--accent-a35);
      color: var(--bright-white);
    }
    .group-fix:disabled { opacity: 0.4; cursor: not-allowed; }
    .check {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 10px 14px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--glass-bg);
      backdrop-filter: blur(var(--glass-blur));
      -webkit-backdrop-filter: blur(var(--glass-blur));
      margin-bottom: 6px;
      transition: all var(--transition-fast);
    }
    .check:hover {
      border-color: var(--glass-border-hover);
      background: var(--glass-bg-hover);
    }
    .indicator {
      flex-shrink: 0;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      margin-top: 5px;
    }
    .indicator.pass { background: var(--emerald); box-shadow: 0 0 6px var(--green-a30); }
    .indicator.fail { background: var(--red); box-shadow: 0 0 6px var(--red-a25); }
    .check-body { flex: 1; min-width: 0; }
    .check-name {
      font-size: var(--font-size-md);
      font-weight: 500;
      color: var(--white);
      font-family: var(--font-mono);
    }
    .check-details {
      font-size: var(--font-size-sm);
      color: var(--gray);
      margin-top: 4px;
      font-family: var(--font-mono);
      line-height: 1.5;
    }
    .check-actions {
      flex-shrink: 0;
    }
    .fix-btn {
      padding: 4px 12px;
      border: 1px solid var(--amber-a15);
      border-radius: var(--radius);
      background: var(--amber-a15);
      color: var(--amber);
      font-size: var(--font-size-sm);
      cursor: pointer;
      transition: all var(--transition-fast);
    }
    .fix-btn:hover { background: rgba(245, 158, 11, 0.25); color: var(--bright-white); }
    .fix-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  `;

  connectedCallback() {
    super.connectedCallback();
    this.socket = io();
    this.fetchDoctorStatus();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.socket?.disconnect();
  }

  private async fetchDoctorStatus() {
    this.loading = true;
    try {
      const data = await getDoctorStatus();
      this.checks = data.checks;
      this.allPassed = data.allPassed;
    } catch {
      this.checks = [];
      this.allPassed = false;
    } finally {
      this.loading = false;
    }
  }

  private async runFix(target?: string) {
    this.fixing = true;
    const args = ['doctor', '--fix'];
    if (target) args.push(target);
    try {
      const { operationId } = await execute(args);
      this.dispatchEvent(new CustomEvent('operation', {
        detail: { operationId, args },
        bubbles: true,
        composed: true,
      }));
      this.socket?.on(`done:${operationId}`, () => {
        this.socket?.off(`done:${operationId}`);
        this.fixing = false;
        this.fetchDoctorStatus();
      });
    } catch {
      this.fixing = false;
    }
  }

  private async runExportZip() {
    const args = ['doctor', '--zip'];
    try {
      const { operationId } = await execute(args);
      this.dispatchEvent(new CustomEvent('operation', {
        detail: { operationId, args },
        bubbles: true,
        composed: true,
      }));
    } catch { /* ignore */ }
  }

  render() {
    if (this.loading) return html`<div class="loading">Running diagnostics...</div>`;

    const groups = new Map<string, DoctorCheck[]>();
    for (const check of this.checks) {
      const list = groups.get(check.group) ?? [];
      list.push(check);
      groups.set(check.group, list);
    }

    const failedCount = this.checks.filter((c) => !c.passed).length;

    return html`
      <div class="header">
        <h2>Diagnostics</h2>
        <div class="header-actions">
          ${failedCount > 0 ? html`
            <button class="btn primary" ?disabled=${this.fixing} @click=${() => this.runFix()}>
              ${this.fixing ? 'Fixing...' : `Fix All (${failedCount})`}
            </button>
          ` : ''}
          <button class="btn" @click=${() => this.runExportZip()}>Export Zip</button>
          <button class="btn" @click=${() => this.fetchDoctorStatus()}>Refresh</button>
        </div>
      </div>

      <div class="summary ${this.allPassed ? 'pass' : 'fail'}">
        ${this.allPassed ? 'All checks passed' : `${failedCount} check${failedCount !== 1 ? 's' : ''} failed`}
      </div>

      ${[...groups.entries()].map(([group, checks]) => html`
        <div class="group-header">
          <span>${group}</span>
          <button
            class="group-fix"
            ?disabled=${this.fixing}
            ${tooltip(`kairos doctor --fix ${group.toLowerCase()}`)}
            @click=${() => this.runFix(group.toLowerCase())}
          >Fix group</button>
        </div>
        ${checks.map((check) => html`
          <div class="check">
            <div class="indicator ${check.passed ? 'pass' : 'fail'}"></div>
            <div class="check-body">
              <div class="check-name">${check.name}</div>
              ${check.details.length > 0 ? html`
                <div class="check-details">
                  ${check.details.map((d) => html`${d}<br/>`)}
                </div>
              ` : ''}
            </div>
            ${!check.passed ? html`
              <div class="check-actions">
                <button class="fix-btn" ?disabled=${this.fixing} @click=${() => this.runFix(check.name)}>Fix</button>
              </div>
            ` : ''}
          </div>
        `)}
      `)}
    `;
  }
}
