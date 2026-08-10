import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { repeat } from 'lit/directives/repeat.js';
import { getUsage, type UsageEntry } from '../services/api.js';
import {
  architectureLabel as usageArchitectureLabel,
  buildUsageInsights,
  clientKindKey,
  clientKindLabel as usageClientKindLabel,
  groupByUser,
  platformLabel as usagePlatformLabel,
  type UsageBreakdown,
  type UsageSlice,
} from '../services/usage-insights.js';
import { skeletonStyles, skeletonRows } from '../styles/skeleton.js';
import { avatarStyle, initials, avatarImg, avatarStyles } from './avatar.js';
import { tooltip } from '../directives/tooltip.js';

type StatusBucket = 'today' | 'week' | 'inactive';
type ClientBucket = 'desktop' | 'browser' | 'unknown';

@customElement('kairos-usage')
export class DevaiUsage extends LitElement {
  @state() private users: UsageEntry[] = [];
  @state() private loading = true;
  @state() private error = '';
  @state() private filter: StatusBucket | 'all' = 'all';
  @state() private now = Date.now();

  private tickInterval: number | undefined;

  static styles = [skeletonStyles, avatarStyles, css`
    :host { display: block; }

    @keyframes card-fade-in {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }

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

    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .stat-card {
      position: relative;
      padding: 18px 22px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-lg);
      background: var(--glass-bg);
      backdrop-filter: blur(var(--glass-blur));
      -webkit-backdrop-filter: blur(var(--glass-blur));
      box-shadow: var(--widget-shadow);
      cursor: pointer;
      transition: all var(--transition-base);
      overflow: hidden;
      animation: card-fade-in 0.2s cubic-bezier(0.2, 0, 0, 1) both;
    }
    .stat-card:hover {
      border-color: var(--glass-border-hover);
      transform: translateY(-1px);
      box-shadow: var(--widget-shadow-hover);
    }
    .stat-card.active {
      border-color: var(--accent-a35);
      background: var(--accent-a10);
    }
    .stat-card::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 3px;
      background: var(--bar-color, var(--accent));
      opacity: 0.7;
    }
    .stat-row {
      display: flex;
      align-items: baseline;
      gap: 8px;
    }
    .stat-value {
      font-size: 24px;
      font-weight: 600;
      letter-spacing: -0.02em;
      color: var(--bright-white);
      font-variant-numeric: tabular-nums;
    }
    .stat-of {
      font-size: var(--font-size-base);
      color: var(--gray);
    }
    .stat-label {
      font-size: var(--font-size-sm);
      color: var(--gray);
      margin-top: 6px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-weight: 600;
    }
    .loading, .empty {
      text-align: center;
      padding: 48px;
      color: var(--gray);
    }
    .error {
      padding: 12px 16px;
      border-radius: var(--radius);
      background: var(--red-a15);
      border: 1px solid var(--red-a25);
      color: var(--red);
      margin-bottom: 20px;
    }

    .insights {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .chart-card {
      min-width: 0;
      padding: 18px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-lg);
      background: var(--glass-bg);
      backdrop-filter: blur(var(--glass-blur));
      -webkit-backdrop-filter: blur(var(--glass-blur));
      box-shadow: var(--widget-shadow);
      animation: card-fade-in 0.24s cubic-bezier(0.2, 0, 0, 1) both;
    }
    .chart-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
    }
    .chart-title {
      color: var(--bright-white);
      font-size: var(--font-size-md);
      font-weight: 700;
    }
    .chart-subtitle {
      color: var(--gray);
      font-size: var(--font-size-sm);
      white-space: nowrap;
    }
    .stack {
      display: flex;
      gap: 2px;
      width: 100%;
      height: 10px;
      border-radius: 999px;
      margin-bottom: 14px;
    }
    .stack-segment {
      min-width: 3px;
      background: var(--slice-color);
      cursor: default;
    }
    .stack-segment:first-child { border-radius: 999px 0 0 999px; }
    .stack-segment:last-child { border-radius: 0 999px 999px 0; }
    .stack-segment:only-child { border-radius: 999px; }
    .breakdown {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .breakdown-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 12px;
      align-items: center;
      padding: 2px 4px;
      margin: -2px -4px;
      border-radius: var(--radius-sm, 6px);
      cursor: default;
      transition: background var(--transition-fast);
    }
    .breakdown-row:hover { background: var(--w5); }
    .breakdown-label {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      color: var(--white);
      font-size: var(--font-size-sm);
      font-weight: 600;
    }
    .breakdown-label span:last-child {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .swatch {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      flex: 0 0 auto;
      background: var(--slice-color);
    }
    .breakdown-value {
      color: var(--gray);
      font-size: var(--font-size-sm);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .breakdown-track {
      grid-column: 1 / -1;
      height: 4px;
      overflow: hidden;
      border-radius: 999px;
      background: var(--w5);
      margin-top: -6px;
    }
    .breakdown-fill {
      height: 100%;
      width: var(--slice-width);
      min-width: 3px;
      border-radius: 999px;
      background: var(--slice-color);
    }
    .chart-empty {
      display: flex;
      align-items: center;
      min-height: 72px;
      color: var(--gray);
      font-size: var(--font-size-sm);
    }

    .panel {
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-lg);
      background: var(--glass-bg);
      backdrop-filter: blur(var(--glass-blur));
      -webkit-backdrop-filter: blur(var(--glass-blur));
      box-shadow: var(--widget-shadow);
      overflow: hidden;
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th, td {
      text-align: left;
      padding: 14px 20px;
      border-bottom: 1px solid var(--glass-border);
    }
    tbody tr:last-child td { border-bottom: none; }
    th {
      font-size: var(--font-size-sm);
      font-weight: 600;
      color: var(--gray);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      background: var(--w3);
    }
    td {
      font-size: var(--font-size-md);
      color: var(--white);
    }
    tr {
      transition: background var(--transition-fast);
    }
    tbody tr:hover td {
      background: var(--w5);
    }

    .user-cell {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .user-name {
      font-weight: 600;
      color: var(--bright-white);
      font-family: var(--font);
    }
    .user-host {
      font-size: var(--font-size-sm);
      color: var(--gray);
      font-family: var(--font-mono);
    }

    .pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 99px;
      font-size: var(--font-size-sm);
      font-weight: 600;
    }
    .pill.today { background: var(--accent-a15); color: var(--purple-light); }
    .pill.week { background: var(--teal-a14); color: var(--teal); }
    .pill.inactive { background: var(--w8); color: var(--gray); }
    .pill .dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: currentColor;
    }

    .client-cell {
      display: flex;
      flex-direction: column;
      gap: 4px;
      align-items: flex-start;
    }
    .client-pill {
      display: inline-flex;
      align-items: center;
      padding: 4px 10px;
      border-radius: 99px;
      font-size: var(--font-size-sm);
      font-weight: 700;
      border: 1px solid transparent;
    }
    .client-pill.desktop {
      color: var(--bright-white);
      background: var(--accent-a15);
      border-color: var(--accent-a25);
    }
    .client-pill.browser {
      color: var(--amber);
      background: var(--amber-a15);
      border-color: var(--amber-a25);
    }
    .client-pill.unknown {
      color: var(--gray);
      background: var(--w8);
      border-color: var(--glass-border);
    }
    .client-version {
      color: var(--gray);
      font-family: var(--font-mono);
      font-size: var(--font-size-sm);
    }
    .platform-cell {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .platform-os {
      color: var(--white);
      font-weight: 600;
    }
    .platform-arch {
      color: var(--gray);
      font-family: var(--font-mono);
      font-size: var(--font-size-sm);
    }

    .last-seen {
      font-family: var(--font);
      color: var(--white);
    }
    .last-seen-abs {
      display: block;
      font-size: var(--font-size-sm);
      color: var(--gray);
      margin-top: 2px;
    }

    .activity-bar {
      width: 90px;
      height: 6px;
      border-radius: 3px;
      background: var(--w5);
      overflow: hidden;
    }
    .activity-bar-fill {
      height: 100%;
      background: linear-gradient(90deg, var(--accent), var(--purple-light));
      border-radius: 3px;
      transition: width var(--transition-base);
    }

    @media (max-width: 1100px) {
      .insights { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }

    @media (max-width: 720px) {
      .header { align-items: flex-start; gap: 12px; flex-direction: column; }
      .insights { grid-template-columns: 1fr; }
      th, td { padding: 12px 14px; }
    }
  `];

  connectedCallback() {
    super.connectedCallback();
    this.fetchUsage();
    this.tickInterval = window.setInterval(() => {
      this.now = Date.now();
    }, 30_000);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.tickInterval) clearInterval(this.tickInterval);
  }

  private async fetchUsage() {
    this.loading = true;
    this.error = '';
    try {
      const data = await getUsage();
      this.users = data.users;
      this.now = Date.now();
    } catch (err: any) {
      this.error = err.message;
      this.users = [];
    } finally {
      this.loading = false;
    }
  }

  private bucketFor(iso: string): StatusBucket {
    const diff = this.now - new Date(iso).getTime();
    if (diff < 24 * 3600_000) return 'today';
    if (diff < 7 * 24 * 3600_000) return 'week';
    return 'inactive';
  }

  private clientBucket(u: UsageEntry): ClientBucket {
    const key = clientKindKey(u.client_kind);
    return key === 'desktop' || key === 'browser' ? key : 'unknown';
  }

  private clientLabel(bucket: ClientBucket): string {
    return usageClientKindLabel(bucket);
  }

  private platformLabel(os: string | null): string {
    return usagePlatformLabel(os);
  }

  private archLabel(arch: string | null): string {
    const label = usageArchitectureLabel(arch);
    return label === 'Unknown' ? '' : label;
  }

  private formatDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  }

  private timeAgo(iso: string): string {
    const diff = this.now - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    const months = Math.floor(days / 30);
    if (months < 12) return `${months}mo ago`;
    return `${Math.floor(days / 365)}y ago`;
  }

  private setFilter(f: StatusBucket | 'all') {
    this.filter = this.filter === f ? 'all' : f;
  }

  // Fixed nominal slots — distinct hues assigned by position so a series never
  // changes color when counts shift (color follows the entity, not its rank).
  // The tail folds into "Other" upstream, so this never needs to cycle.
  private static readonly NOMINAL_SLOTS = [
    'var(--accent)', 'var(--teal)', 'var(--amber)', 'var(--red)', 'var(--neutral-gray)',
  ];
  // Single-hue ordinal ramp off the theme accent: light→dark so the reader sees
  // the order in the color. Theme-cohesive — every theme re-tints from --accent.
  private static readonly ORDINAL_RAMP = [
    'var(--accent)', 'var(--accent-a50)', 'var(--accent-a35)', 'var(--accent-a25)',
  ];

  private sliceColor(slice: UsageSlice, index: number, ordinal: boolean): string {
    if (slice.key === 'other' || slice.key === 'unknown') return 'var(--neutral-gray)';
    if (ordinal) {
      const ramp = DevaiUsage.ORDINAL_RAMP;
      return ramp[Math.min(index, ramp.length - 1)];
    }
    const slots = DevaiUsage.NOMINAL_SLOTS;
    return slots[Math.min(index, slots.length - 1)];
  }

  private sliceTip(title: string, slice: UsageSlice, color: string): () => Node {
    return () => {
      const root = document.createElement('div');
      root.className = 'usage-tip';

      const head = document.createElement('div');
      head.className = 'usage-tip-head';
      head.textContent = title;
      root.appendChild(head);

      const row = document.createElement('div');
      row.className = 'usage-tip-row';
      const swatch = document.createElement('span');
      swatch.className = 'usage-tip-swatch';
      swatch.style.background = color;
      const label = document.createElement('span');
      label.className = 'usage-tip-label';
      label.textContent = slice.label;
      const val = document.createElement('span');
      val.className = 'usage-tip-val';
      val.textContent = `${slice.count} · ${slice.percent}%`;
      row.append(swatch, label, val);
      root.appendChild(row);

      return root;
    };
  }

  private renderBreakdown(title: string, subtitle: string, breakdown: UsageBreakdown, ordinal = false, emptyLabel = 'No data yet') {
    return html`
      <section class="chart-card" aria-label=${title}>
        <div class="chart-head">
          <div class="chart-title">${title}</div>
          <div class="chart-subtitle">${subtitle}</div>
        </div>
        ${breakdown.total === 0 ? html`
          <div class="chart-empty">${emptyLabel}</div>
        ` : html`
          <div class="stack">
            ${breakdown.slices.map((slice, index) => {
              const color = this.sliceColor(slice, index, ordinal);
              return html`
                <div
                  class="stack-segment"
                  style="width: ${Math.max(slice.percent, 2)}%; --slice-color: ${color};"
                  ${tooltip(this.sliceTip(title, slice, color))}
                ></div>
              `;
            })}
          </div>
          <div class="breakdown">
            ${breakdown.slices.map((slice, index) => {
              const color = this.sliceColor(slice, index, ordinal);
              return html`
                <div
                  class="breakdown-row"
                  style="--slice-color: ${color}; --slice-width: ${Math.max(slice.percent, 3)}%;"
                  ${tooltip(this.sliceTip(title, slice, color))}
                >
                  <div class="breakdown-label">
                    <span class="swatch"></span>
                    <span>${slice.label}</span>
                  </div>
                  <div class="breakdown-value">${slice.count} · ${slice.percent}%</div>
                  <div class="breakdown-track" aria-hidden="true">
                    <div class="breakdown-fill"></div>
                  </div>
                </div>
              `;
            })}
          </div>
        `}
      </section>
    `;
  }

  render() {
    if (this.loading) {
      return html`
        <div class="header">
          <h2>Usage</h2>
        </div>
        ${skeletonRows(5)}
      `;
    }

    const people = groupByUser(this.users);

    const counts = { today: 0, week: 0, inactive: 0 };
    for (const p of people) counts[this.bucketFor(p.lastSeen)]++;

    const total = people.length;
    const machineCount = this.users.length;
    const insights = buildUsageInsights(this.users, this.now);
    const filtered = this.filter === 'all'
      ? people
      : people.filter((p) => this.bucketFor(p.lastSeen) === this.filter);

    const oldestSeen = this.users.reduce((min, u) => {
      const t = new Date(u.last_seen).getTime();
      return t < min ? t : min;
    }, this.now);
    const span = Math.max(this.now - oldestSeen, 1);

    return html`
      <div class="header">
        <h2>Usage</h2>
        <button class="btn" @click=${() => this.fetchUsage()}>Refresh</button>
      </div>

      ${this.error ? html`<div class="error">${this.error}</div>` : ''}

      <div class="stats">
        <div
          class="stat-card ${this.filter === 'all' ? 'active' : ''}"
          style="--bar-color: var(--accent);"
          @click=${() => this.setFilter('all')}
        >
          <div class="stat-row">
            <div class="stat-value">${total}</div>
            <div class="stat-of">${machineCount} machine${machineCount === 1 ? '' : 's'}</div>
          </div>
          <div class="stat-label">Total Users</div>
        </div>
        <div
          class="stat-card ${this.filter === 'today' ? 'active' : ''}"
          style="--bar-color: var(--purple-light);"
          @click=${() => this.setFilter('today')}
        >
          <div class="stat-row">
            <div class="stat-value">${counts.today}</div>
            <div class="stat-of">/ ${total}</div>
          </div>
          <div class="stat-label">Active Today</div>
        </div>
        <div
          class="stat-card ${this.filter === 'week' ? 'active' : ''}"
          style="--bar-color: var(--teal);"
          @click=${() => this.setFilter('week')}
        >
          <div class="stat-row">
            <div class="stat-value">${counts.today + counts.week}</div>
            <div class="stat-of">/ ${total}</div>
          </div>
          <div class="stat-label">Active This Week</div>
        </div>
      </div>

      <div class="insights">
        ${this.renderBreakdown('Operating Systems', 'All machines', insights.platforms)}
        ${this.renderBreakdown('Client Split', 'By machine', insights.clients)}
        ${this.renderBreakdown('Desktop Versions', 'Desktop machines', insights.versions, true, 'No desktop version data yet')}
        ${this.renderBreakdown('CPU Architecture', 'All machines', insights.architectures)}
        ${this.renderBreakdown('Activity Bands', 'Last seen · by machine', insights.activity, true)}
        ${this.renderBreakdown('Adoption Cohorts', 'First seen · by machine', insights.tenure, true)}
      </div>

      ${filtered.length === 0 ? html`
        <div class="panel"><div class="empty">No users in this group.</div></div>
      ` : html`
        <div class="panel">
          <table>
            <thead>
              <tr>
                <th>User</th>
                <th>Status</th>
                <th>Client</th>
                <th>Platform</th>
                <th>Recency</th>
                <th>Last Seen</th>
              </tr>
            </thead>
            <tbody>
              ${repeat(filtered, (p) => p.username, (p) => {
                const m = p.latest;
                const bucket = this.bucketFor(p.lastSeen);
                const recency = 1 - Math.min((this.now - new Date(p.lastSeen).getTime()) / span, 1);
                const pillLabel = {
                  today: 'Today',
                  week: 'This week',
                  inactive: 'Inactive',
                }[bucket];
                const client = this.clientBucket(m);
                const hostLabel = p.machineCount === 1
                  ? m.hostname
                  : `${p.machineCount} machines`;
                return html`
                  <tr>
                    <td>
                      <div class="user-cell">
                        <div class="avatar" style=${avatarStyle(p.username)}>
                          ${initials(p.username)}
                          ${avatarImg(p.username)}
                        </div>
                        <div>
                          <div class="user-name">${p.username}</div>
                          <div class="user-host">${hostLabel}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span class="pill ${bucket}">
                        <span class="dot"></span>${pillLabel}
                      </span>
                    </td>
                    <td>
                      <div class="client-cell">
                        <span class="client-pill ${client}">${this.clientLabel(client)}</span>
                        ${client === 'desktop' && m.kairos_version
                          ? html`<span class="client-version">v${m.kairos_version}</span>`
                          : ''}
                      </div>
                    </td>
                    <td>
                      <div class="platform-cell">
                        <span class="platform-os">${this.platformLabel(m.client_os)}</span>
                        ${this.archLabel(m.client_arch)
                          ? html`<span class="platform-arch">${this.archLabel(m.client_arch)}</span>`
                          : ''}
                      </div>
                    </td>
                    <td>
                      <div class="activity-bar">
                        <div class="activity-bar-fill" style="width: ${Math.max(recency * 100, 4)}%;"></div>
                      </div>
                    </td>
                    <td>
                      <span class="last-seen">${this.timeAgo(p.lastSeen)}</span>
                      <span class="last-seen-abs">${this.formatDate(p.lastSeen)}</span>
                    </td>
                  </tr>
                `;
              })}
            </tbody>
          </table>
        </div>
      `}
    `;
  }
}
