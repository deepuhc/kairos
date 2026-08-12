import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { focusRing } from '../styles/focus.js';
import { io, type Socket } from '../services/events.js';
import {
  getOrchestratorState,
  getOrchestratorRoles,
  type OrchestratorRunState,
  type OrchestratorRole,
  type OrchestratorPhase,
  type OrchestratorPhaseStatus,
  type OrchestratorLiveness,
} from '../services/api.js';

// Activity view — surfaces the autonomous delivery orchestrator's current run:
// which persona is active, its phase/status, last activity, stalled/blocked
// state, and the pipeline's progress along the dependency DAG. Read-only; it
// renders the server's orchestrator state (GET /orchestrator/state) + the static
// role catalog (GET /orchestrator/roles), and refreshes live on the `orchestrator:*`
// events the server publishes on the /events bus (with a `_ext/stalled`-style
// liveness field per phase). This is the client half of Item 5.

// Human labels for phase status + the accent each maps to.
const STATUS_LABEL: Record<OrchestratorPhaseStatus, string> = {
  pending: 'Waiting',
  ready: 'Ready',
  running: 'Working',
  blocked: 'Blocked',
  done: 'Done',
};

const LIVENESS_LABEL: Record<OrchestratorLiveness, string> = {
  ok: 'Healthy',
  'soft-stall': 'Looping',
  stalled: 'Stalled',
  timeout: 'Timed out',
};

function relativeTime(ts: number | undefined, now: number): string {
  if (!ts) return '—';
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

@customElement('kairos-activity')
export class KairosActivity extends LitElement {
  @state() private run: OrchestratorRunState | null = null;
  @state() private roles: OrchestratorRole[] = [];
  @state() private loading = true;
  @state() private error: string | null = null;
  // Drives relative-time rendering ("2m ago") without refetching.
  @state() private clock = Date.now();

  private events: Socket | null = null;
  private ticker: ReturnType<typeof setInterval> | null = null;

  connectedCallback(): void {
    super.connectedCallback();
    void this.load();
    // Live updates: any orchestrator lifecycle event carries the fresh snapshot.
    this.events = io();
    this.events.on('orchestrator:update', this.onEvent);
    // Keep relative timestamps fresh between events.
    this.ticker = setInterval(() => { this.clock = Date.now(); }, 5000);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.events?.off('orchestrator:update', this.onEvent);
    this.events = null;
    if (this.ticker) { clearInterval(this.ticker); this.ticker = null; }
  }

  private onEvent = (data: unknown): void => {
    // The server publishes { state, ... }; accept a bare state too.
    const payload = data as { state?: OrchestratorRunState } | OrchestratorRunState | undefined;
    const next = payload && 'phases' in (payload as OrchestratorRunState)
      ? (payload as OrchestratorRunState)
      : (payload as { state?: OrchestratorRunState })?.state;
    if (next && (!this.run || next.seq >= this.run.seq)) {
      this.run = next;
      this.clock = Date.now();
    }
  };

  private async load(): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      const [run, roles] = await Promise.all([getOrchestratorState(), getOrchestratorRoles()]);
      this.run = run;
      this.roles = roles.roles;
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
    } finally {
      this.loading = false;
    }
  }

  static styles = [focusRing, css`
    :host { display: block; padding: 24px 28px; overflow-y: auto; }
    h2 { font-size: var(--font-size-2xl); font-weight: 600; color: var(--bright-white); margin: 0 0 4px; }
    .subtitle { color: var(--gray); font-size: var(--font-size-sm); margin-bottom: 20px; }
    .goal { color: var(--white); font-size: var(--font-size-md); margin-bottom: 16px; }
    .goal strong { color: var(--bright-white); }

    .run-status {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 3px 10px; border-radius: 999px; font-size: var(--font-size-xs);
      font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em;
      border: 1px solid var(--glass-border); background: var(--glass-bg);
    }
    .run-status[data-s="running"] { color: #7cc4ff; border-color: #7cc4ff55; }
    .run-status[data-s="done"] { color: #6ee7a0; border-color: #6ee7a055; }
    .run-status[data-s="blocked"], .run-status[data-s="failed"] { color: #ff9d7c; border-color: #ff9d7c55; }
    .run-status[data-s="idle"] { color: var(--gray); }

    .empty, .loading, .err {
      color: var(--gray); font-size: var(--font-size-md);
      padding: 48px 0; text-align: center;
    }
    .err { color: #ff9d7c; }

    .pipeline { display: flex; flex-direction: column; gap: 10px; margin-top: 18px; }
    .phase {
      display: grid; grid-template-columns: 28px 1fr auto; align-items: center; gap: 14px;
      padding: 14px 16px; border-radius: var(--radius);
      border: 1px solid var(--glass-border); background: var(--glass-bg);
      transition: border-color var(--transition-fast);
    }
    .phase[data-active] { border-color: #7cc4ff88; background: var(--glass-bg-hover); }
    .phase[data-blocked] { border-color: #ff9d7c55; }
    .dot {
      width: 10px; height: 10px; border-radius: 50%; justify-self: center;
      background: var(--neutral-gray);
    }
    .phase[data-status="running"] .dot { background: #7cc4ff; box-shadow: 0 0 0 4px #7cc4ff22; animation: pulse 1.6s ease-in-out infinite; }
    .phase[data-status="done"] .dot { background: #6ee7a0; }
    .phase[data-status="blocked"] .dot { background: #ff9d7c; }
    .phase[data-status="ready"] .dot { background: #d6c56a; }
    @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.45; } }

    .info { min-width: 0; }
    .role-name { color: var(--bright-white); font-weight: 600; font-size: var(--font-size-md); }
    .artifact { color: var(--gray); font-size: var(--font-size-xs); font-family: var(--font-mono); }
    .meta { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; text-align: right; }
    .status-label { font-size: var(--font-size-sm); color: var(--white); }
    .liveness { font-size: var(--font-size-xs); }
    .liveness[data-l="stalled"], .liveness[data-l="timeout"] { color: #ff9d7c; font-weight: 600; }
    .liveness[data-l="soft-stall"] { color: #d6c56a; }
    .liveness[data-l="ok"] { color: var(--gray); }
    .activity-time { font-size: var(--font-size-xs); color: var(--gray); }
    .blocked-reason {
      grid-column: 1 / -1; margin-top: 6px; padding: 8px 10px; border-radius: 6px;
      background: #ff9d7c11; color: #ffb499; font-size: var(--font-size-xs);
    }
    .attempts { font-size: var(--font-size-xs); color: var(--neutral-gray); }
  `];

  private phaseFor(roleId: string): OrchestratorPhase | undefined {
    return this.run?.phases.find((p) => p.role === roleId);
  }

  // The pipeline nodes to show: the phases in this run, joined to their role
  // metadata (name/artifact label). Falls back to the full catalog before a run.
  private pipelineRows(): Array<{ role: OrchestratorRole; phase?: OrchestratorPhase }> {
    const pipelineRoles = this.roles.filter((r) => !r.supervisorRole);
    if (this.run && this.run.phases.length) {
      return this.run.phases.map((phase) => ({
        role: this.roles.find((r) => r.id === phase.role) ?? {
          id: phase.role, name: phase.role, icon: 'activity', description: '',
          modelTier: 'mid', dependsOn: [], supervisorRole: false,
          artifact: { path: phase.artifact, label: phase.artifact },
        },
        phase,
      }));
    }
    return pipelineRoles.map((role) => ({ role }));
  }

  render() {
    if (this.loading) return html`<h2>Activity</h2><div class="loading">Loading…</div>`;
    if (this.error) return html`<h2>Activity</h2><div class="err">${this.error}</div>`;

    const run = this.run;
    const idle = !run || run.status === 'idle' || run.phases.length === 0;

    return html`
      <h2>Activity</h2>
      <div class="subtitle">The autonomous delivery team and its progress through the pipeline.</div>
      ${idle
        ? html`<div class="empty">No orchestrator run is active. Start one to watch the personas work here.</div>`
        : html`
            <div class="goal"><strong>Goal:</strong> ${run!.goal || 'Untitled run'}
              &nbsp;<span class="run-status" data-s=${run!.status}>${run!.status}</span>
            </div>
            <div class="pipeline">
              ${this.pipelineRows().map(({ role, phase }) => this.renderPhase(role, phase))}
            </div>
          `}
    `;
  }

  private renderPhase(role: OrchestratorRole, phase?: OrchestratorPhase) {
    const status = phase?.status ?? 'pending';
    const active = status === 'running';
    const blocked = status === 'blocked';
    return html`
      <div class="phase" data-status=${status} ?data-active=${active} ?data-blocked=${blocked}>
        <span class="dot"></span>
        <div class="info">
          <div class="role-name">${role.name}</div>
          <div class="artifact">${role.artifact.label} · ${role.artifact.path}</div>
        </div>
        <div class="meta">
          <span class="status-label">${STATUS_LABEL[status]}</span>
          ${phase?.liveness && status === 'running'
            ? html`<span class="liveness" data-l=${phase.liveness}>${LIVENESS_LABEL[phase.liveness]}</span>`
            : nothing}
          ${phase?.lastActivityAt
            ? html`<span class="activity-time">${relativeTime(phase.lastActivityAt, this.clock)}</span>`
            : nothing}
          ${phase && phase.attempts > 1
            ? html`<span class="attempts">attempt ${phase.attempts}</span>`
            : nothing}
        </div>
        ${blocked && phase?.blockedReason
          ? html`<div class="blocked-reason">${phase.blockedReason}</div>`
          : nothing}
      </div>
    `;
  }
}
