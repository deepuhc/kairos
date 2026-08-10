import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { getAuthStatus, getVaultStatus, changePassphrase, resetPassphrase, setupSsh, rotateKey, trustCert, untrustCert, type VaultStatus } from '../services/api.js';
import { io, type Socket } from '../services/events.js';

interface AuthInfo {
  loggedIn: boolean;
  user: string | null;
  expires: string | null;
}

@customElement('kairos-security')
export class DevaiSecurity extends LitElement {
  @state() private auth: AuthInfo = { loggedIn: false, user: null, expires: null };
  @state() private vault: VaultStatus | null = null;
  @state() private loading = true;

  private socket: Socket | null = null;

  static styles = css`
    :host { display: block; }
    h2 {
      font-size: var(--font-size-2xl);
      font-weight: 600;
      color: var(--bright-white);
      margin: 0 0 4px;
    }
    .subtitle {
      color: var(--gray);
      font-size: var(--font-size-sm);
      margin-bottom: 20px;
    }
    .loading, .hint { color: var(--gray); padding: 24px 0; }

    .vault-row {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 20px;
    }
    .vault-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 12px;
      border-radius: 99px;
      font-size: var(--font-size-sm);
      font-weight: 600;
    }
    .vault-pill.ok { background: var(--green-a15); color: var(--emerald); border: 1px solid var(--green-a30); }
    .vault-pill.fail { background: var(--red-a15); color: var(--red); border: 1px solid var(--red-a25); }

    .group { margin-bottom: 24px; }
    .group-title {
      font-size: var(--font-size-sm);
      color: var(--neutral-gray);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      font-weight: 600;
      margin-bottom: 10px;
    }
    .group-note {
      max-width: 720px;
      margin: -4px 0 10px;
      color: var(--neutral-gray);
      font-size: var(--font-size-sm);
      line-height: 1.45;
    }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .btn {
      padding: 8px 16px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--glass-bg);
      color: var(--white);
      font-size: var(--font-size-base);
      font-weight: 500;
      cursor: pointer;
      white-space: nowrap;
      transition: all var(--transition-fast);
    }
    .btn:hover {
      border-color: var(--accent-a35);
      background: var(--accent-a15);
      color: var(--bright-white);
    }
    .btn.danger { color: var(--red); }
    .btn.danger:hover { border-color: var(--red-a25); background: var(--red-a15); }
  `;

  connectedCallback() {
    super.connectedCallback();
    this.socket = io();
    this.socket.on('auth:changed', async () => {
      await this.loadData();
    });
    this.loadData();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.socket?.disconnect();
  }

  private async loadData() {
    this.loading = true;
    try {
      const [authRes, vaultRes] = await Promise.allSettled([getAuthStatus(), getVaultStatus()]);
      if (authRes.status === 'fulfilled') this.auth = authRes.value;
      if (vaultRes.status === 'fulfilled') this.vault = vaultRes.value;
    } finally {
      this.loading = false;
    }
  }

  private async runAuthOp(fn: () => Promise<{ operationId: string; args: string[] }>, confirmMsg?: string) {
    if (confirmMsg && !confirm(confirmMsg)) return;
    const { operationId, args } = await fn();
    window.dispatchEvent(new CustomEvent('kairos-operation', { detail: { operationId, args } }));
    this.socket?.on(`done:${operationId}`, async () => {
      this.socket?.off(`done:${operationId}`);
      try { this.vault = await getVaultStatus(); } catch { /* ignore */ }
    });
  }

  render() {
    return html`
      <h2>Security</h2>
      <div class="subtitle">Manage the credential vault passphrase, encryption key, and proxy CA trust.</div>
      ${this.loading
        ? html`<div class="loading">Loading security status...</div>`
        : !this.auth.loggedIn
          ? html`<div class="hint">Log in to manage security settings.</div>`
          : html`
              <div class="vault-row">
                <span class="vault-pill ${this.vault?.kekAccessible ? 'ok' : 'fail'}">
                  ${this.vault?.kekAccessible ? 'Vault unlocked' : 'Vault locked'}
                </span>
              </div>

              <div class="group">
                <div class="group-title">Vault</div>
                <div class="actions">
                  ${this.vault && this.vault.hasPassphraseSlot ? html`
                    <button class="btn" @click=${() => this.runAuthOp(changePassphrase)}>Change passphrase…</button>
                    <button class="btn" @click=${() => this.runAuthOp(resetPassphrase, "Reset the vault passphrase?\n\nThis will clear the existing passphrase. You'll need to set a new one.")}>Reset passphrase…</button>
                  ` : ''}
                  <button class="btn" @click=${() => this.runAuthOp(rotateKey, 'Re-encrypt all stored credentials with a new key?')}>Rotate encryption key…</button>
                </div>
              </div>

              <div class="group">
                <div class="group-title">SSH / headless access</div>
                <div class="group-note">
                  Create a passphrase slot so kairos credentials can unlock over SSH or on machines without an OS keychain.
                </div>
                <div class="actions">
                  <button
                    class="btn"
                    @click=${() => this.runAuthOp(
                      () => setupSsh(),
                      'Set up passphrase-based vault access for SSH/headless sessions?\n\nRun this from a desktop session where the OS keychain is accessible.',
                    )}
                  >Set up SSH passphrase…</button>
                  <button
                    class="btn danger"
                    @click=${() => this.runAuthOp(
                      () => setupSsh(true),
                      'Force reset the vault for SSH/headless access?\n\nThis destroys all stored service credentials and creates a fresh passphrase-only store. You will need to log in again.',
                    )}
                  >Force reset for SSH…</button>
                </div>
              </div>

              <div class="group">
                <div class="group-title">Proxy CA</div>
                <div class="actions">
                  <button class="btn" @click=${() => this.runAuthOp(trustCert, 'Trust the proxy CA in the OS trust store?\n\nThis lets curl/git work through the credential proxy. May prompt for sudo.')}>Trust proxy CA…</button>
                  <button class="btn danger" @click=${() => this.runAuthOp(untrustCert, 'Remove the proxy CA from the OS trust store?')}>Untrust proxy CA…</button>
                </div>
              </div>
            `}
    `;
  }
}
