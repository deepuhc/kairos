import { LitElement, html, svg, css, nothing } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { getSessions, renameSession, pinSession, unpinSession, deleteSession, reorderPinnedSessions, type SessionEntry } from '../services/api.js';
import type { UsageInfo } from '../services/acp-types.js';
import { tooltip, overflowTooltip } from '../directives/tooltip.js';
import { focusRing } from '../styles/focus.js';
import { icon } from './icons.js';
import './agent-logo.js';
import { hasAgentLogo } from './agent-logo.js';
import './agents-pet.js';
import type { PetMood } from '../services/pet-mood.js';
import { moveId, reorderByIds, type DropPosition } from '../services/session-order.js';

// A single active in-UI agent session, as the sidebar needs to render it.
// `activity`, `usage`, and `queuedCount` give the sidebar the same at-a-glance
// awareness the old Mission Control board offered (in-progress tool / last
// snippet, token meter, queued steers) without a separate top-level surface.
export interface ActiveSessionSummary {
  id: string;
  title: string;
  cwd: string;
  agentId: string;
  agentName: string;
  phase: 'ready' | 'thinking' | 'error';
  /** Epoch ms the current thinking turn started; null when idle. Drives the elapsed readout. */
  turnStartedAt: number | null;
  stalled: boolean;
  /** Background tasks (run_in_background) still running; keeps the row "working"
   *  even after the prompt turn resolved (phase === 'ready'). */
  backgroundActive: number;
  hasPermission: boolean;
  hasElicitation: boolean;
  loading: boolean;
  activity: string;
  usage: UsageInfo | null;
  queuedCount: number;
  /** Finished/errored/needs-attention while unwatched, and not viewed since. */
  unseen: boolean;
  /** Epoch ms the last turn finished; null until first completion. Drives "Done · Nm ago". */
  doneAt: number | null;
}

type ReorderKind = 'active' | 'pinned';

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(n);
}

// Elapsed since a turn began, as m:ss (or h:mm:ss past an hour) for the sidebar
// "thinking for …" readout. Clamps negatives to 0:00.
function formatElapsed(startedAt: number): string {
  const total = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

// How many past sessions the sidebar's "Recent" shortcut list shows before it
// defers to the full History tab via "View all".
const RECENT_LIMIT = 7;
const REORDER_DRAG_THRESHOLD = 5;

const COLLAPSED_KEY = 'kairos-agents:sidebar-collapsed';

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function saveCollapsed(on: boolean) {
  try {
    localStorage.setItem(COLLAPSED_KEY, on ? '1' : '0');
  } catch { /* quota / disabled — ignore */ }
}

const WIDTH_KEY = 'kairos-agents:sidebar-width';
const WIDTH_MIN = 220;
const WIDTH_MAX = 560;
const WIDTH_DEFAULT = 312;
// Drag the pane narrower than this and it snaps shut, VSCode-style; drag the
// collapsed rail back past it and it reopens. Sits below WIDTH_MIN so there's a
// dead zone between "smallest usable" and "collapse".
const COLLAPSE_THRESHOLD = 150;

function clampWidth(px: number): number {
  return Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, Math.round(px)));
}

function loadWidth(): number {
  try {
    const raw = Number(localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(raw) && raw > 0 ? clampWidth(raw) : WIDTH_DEFAULT;
  } catch {
    return WIDTH_DEFAULT;
  }
}

function saveWidth(px: number) {
  try {
    localStorage.setItem(WIDTH_KEY, String(px));
  } catch { /* quota / disabled — ignore */ }
}

function relativeTime(iso: string): string {
  if (!iso) return '';
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return '';
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

// Like relativeTime but for an epoch-ms stamp (session doneAt), for the
// "Done · Nm ago" readout on finished-but-idle active sessions.
function relativeDone(epoch: number): string {
  const sec = Math.floor((Date.now() - epoch) / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function shortDir(dir: string): string {
  return dir.replace(/^\/Users\/[^/]+/, '~').replace(/^\/home\/[^/]+/, '~');
}

// Activity readout for a session whose prompt turn resolved but still has
// detached background tasks (run_in_background) running.
function backgroundLabel(count: number): string {
  return count === 1 ? 'Working in background…' : `Working — ${count} background tasks…`;
}

// Left rail for the Agents tab: switch between live sessions and reopen past ones.
@customElement('agents-sidebar')
export class AgentsSidebar extends LitElement {
  @property({ attribute: false }) active: ActiveSessionSummary[] = [];
  @property({ attribute: false }) previouslyOpen: SessionEntry[] = [];
  @property({ type: String }) activeId: string | null = null;
  // True when the "Behind the Scenes" pane is open — pins the matching sidebar
  // entry as the current item without affecting the live session selection.
  @property({ type: Boolean }) behindActive = false;
  // Last-used picker values. When present, "New session" splits into a quick
  // start (reuse these) and a caret that opens the picker.
  @property({ type: String }) lastCwd = '';
  @property({ type: String }) lastAgentLabel = '';
  // Whether the right side-panel (Files/Review/Summary/Plan) is open, and whether
  // it's even applicable (only within a live session). Owned by <kairos-agents>;
  // the toolbar's right button emits `toggle-right-panel` and fills its right
  // column to match. Disabled when unavailable so the control stays put.
  @property({ type: Boolean }) rightPanelOpen = false;
  @property({ type: Boolean }) rightPanelAvailable = false;
  @property({ type: String }) petMood: PetMood = 'idle';

  @state() private recent: SessionEntry[] = [];
  @state() private loadingRecent = false;
  @state() private recentError = '';
  @state() private collapsed = loadCollapsed();
  @state() private width = loadWidth();
  @state() private resizing = false;
  // Id of the row currently being renamed inline, and its working text.
  @state() private renamingId: string | null = null;
  @state() private renameValue = '';
  // Delete for Recent rows: id whose confirmation dialog is open, and id mid-delete.
  @state() private confirmingDeleteId: string | null = null;
  @state() private deletingId: string | null = null;
  @state() private pinningId: string | null = null;
  @state() private dragging: { kind: ReorderKind; id: string } | null = null;
  @state() private dropTarget: { kind: ReorderKind; id: string; position: DropPosition } | null = null;
  private reorderPointer: {
    kind: ReorderKind;
    id: string;
    pointerId: number;
    source: HTMLElement;
    startX: number;
    startY: number;
    started: boolean;
  } | null = null;
  private suppressClick: { kind: ReorderKind; id: string } | null = null;

  static styles = [focusRing, css`
    :host {
      display: flex;
      flex-direction: column;
      position: relative;
      width: var(--sidebar-width, 312px);
      flex-shrink: 0;
      height: 100%;
      border-right: 1px solid var(--glass-border);
      background: var(--w3);
      transition: width var(--transition-fast);
    }
    :host([data-collapsed]) { width: 52px; }
    /* While dragging, drop the width transition so the pane tracks the pointer. */
    :host([data-resizing]) { transition: none; }

    /* Drag handle straddling the right border. Widened hit area, thin visible
       affordance on hover/drag. Stays present when collapsed so a drag to the
       right reopens the pane (VSCode-style). */
    .pet-footer { flex: 0 0 auto; }
    .resize-handle {
      position: absolute;
      top: 0;
      right: -3px;
      width: 7px;
      height: 100%;
      cursor: col-resize;
      z-index: 5;
      touch-action: none;
    }
    .resize-handle::after {
      content: '';
      position: absolute;
      top: 0;
      left: 3px;
      width: 1px;
      height: 100%;
      background: transparent;
      transition: background var(--transition-fast);
    }
    .resize-handle:hover::after,
    :host([data-resizing]) .resize-handle::after { background: var(--accent); }

    .header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 12px 12px 0;
    }
    :host([data-collapsed]) .header {
      padding: 12px 0 0;
      flex-direction: column;
      align-items: center;
      gap: 8px;
    }
    .new-session-group {
      flex: 1;
      display: flex;
      align-items: stretch;
      border: 1px solid var(--accent-a35);
      border-radius: var(--radius);
      background: var(--accent-a15);
      overflow: hidden;
      transition: border-color var(--transition-fast);
    }
    .new-session-group:hover { border-color: var(--accent); }
    .new-session {
      flex: 1;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px;
      border: none;
      background: transparent;
      color: var(--bright-white);
      font-size: var(--font-size-md);
      font-weight: 600;
      font-family: var(--font);
      cursor: pointer;
      transition: background var(--transition-fast);
      min-width: 0;
    }
    .new-session:hover { background: var(--accent-a18); }
    .new-session svg { flex-shrink: 0; }
    .new-session-sub {
      font-size: var(--font-size-xs);
      font-weight: 500;
      color: var(--gray);
      font-family: var(--font-mono);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      margin-top: 1px;
    }
    .new-session-label {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      text-align: left;
      min-width: 0;
      flex: 1;
    }
    .new-session-title {
      font-size: var(--font-size-md);
      font-weight: 600;
      color: var(--bright-white);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 100%;
    }
    .new-session-caret {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 30px;
      flex-shrink: 0;
      border: none;
      border-left: 1px solid var(--accent-a35);
      background: transparent;
      color: var(--bright-white);
      cursor: pointer;
      transition: background var(--transition-fast);
    }
    .new-session-caret:hover { background: var(--accent-a18); }
    .new-session.icon-only {
      flex: 0 0 auto;
      width: 28px;
      height: 28px;
      padding: 0;
      justify-content: center;
      border: 1px solid var(--accent-a35);
      border-radius: var(--radius);
      background: var(--accent-a15);
    }
    .new-session.icon-only:hover { background: var(--accent-a25); border-color: var(--accent); }

    .scroll { flex: 1; overflow-y: auto; padding: 0 8px 12px; }
    :host([data-collapsed]) .scroll { padding: 8px 4px 12px; }

    /* theme.css scrollbar rules don't pierce the shadow DOM, so redeclare here
       or the .scroll region falls back to the default OS scrollbar. */
    .scroll::-webkit-scrollbar { width: 8px; height: 8px; }
    .scroll::-webkit-scrollbar-track { background: transparent; }
    .scroll::-webkit-scrollbar-thumb { background: var(--w8); border-radius: 4px; }
    .scroll::-webkit-scrollbar-thumb:hover { background: var(--w15); }

    /* VSCode-style layout toolbar: its own row above New session, one button per
       collapsible region. Each glyph is a viewport frame whose matching edge/band
       fills solid when that region is visible — the unambiguous idiom for
       toggling chrome, and not something that twins the New session dropdown.
       Right-aligned so it tucks into the top corner like VSCode's. */
    .layout-toolbar {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      gap: 2px;
      padding: 8px 10px 0;
      box-sizing: border-box;
      max-width: 100%;
      min-width: 0;
      overflow: hidden;
    }
    .layout-toolbar-spacer { flex: 1 1 auto; min-width: 0; }
    :host([data-collapsed]) .layout-toolbar {
      justify-content: center;
      flex-direction: column;
      padding: 8px 0 0;
    }
    /* Collapsed rail stacks the toggles vertically; the spacer would push them
       apart, so drop it and let the BTS button sit icon-only at the top. */
    :host([data-collapsed]) .layout-toolbar-spacer { display: none; }

    /* "Behind the Scenes" — hidden unless app is in developer mode.
       The global CSS hides [data-requires-mode='developer'] elements,
       but shadow DOM needs its own rule checking the host attribute. */
    .bts-btn {
      flex: 0 1 auto;
      min-width: 0;
      display: none;
      align-items: center;
      gap: 7px;
      height: 30px;
      padding: 0 10px;
      border: 1px solid transparent;
      border-radius: var(--radius-sm);
      background: transparent;
      color: var(--neutral-gray);
      font-size: var(--font-size-sm);
      font-weight: 550;
      font-family: var(--font);
      cursor: pointer;
      white-space: nowrap;
      overflow: hidden;
      transition: background var(--transition-fast), color var(--transition-fast), border-color var(--transition-fast);
    }
    :host([developer-mode]) .bts-btn { display: inline-flex; }
    .bts-btn svg { flex-shrink: 0; display: block; }
    .bts-label {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .bts-btn:hover { background: var(--w8); color: var(--bright-white); }
    .bts-btn.on {
      background: var(--w5);
      border-color: var(--accent-a35);
      color: var(--bright-white);
    }
    .bts-btn.on svg { color: var(--accent); }
    .bts-btn.on:hover { background: var(--w8); }
    :host([data-collapsed]) .bts-btn { padding: 0; width: 30px; justify-content: center; }
    :host([data-collapsed]) .bts-label { display: none; }
    .layout-btn {
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 30px;
      height: 30px;
      border: none;
      border-radius: var(--radius-sm);
      background: transparent;
      color: var(--neutral-gray);
      cursor: pointer;
      transition: background var(--transition-fast), color var(--transition-fast);
    }
    .layout-btn:hover:not(:disabled) { background: var(--w8); color: var(--bright-white); }
    .layout-btn:disabled { opacity: 0.35; cursor: default; }
    /* The glyph carries all the state: the frame is a constant outline and the
       region block fills in when that region is open (VSCode's idiom), so the
       button itself never recolors — only the icon's interior changes. The frame
       is dimmed relative to the fill so the solid "open" block reads clearly. */
    .layout-btn svg { width: 17px; height: 17px; display: block; }
    .layout-btn svg .frame { opacity: 0.55; }
    .layout-btn:hover:not(:disabled) svg .frame { opacity: 0.8; }
    :host([data-collapsed]) .section-label,
    :host([data-collapsed]) .body,
    :host([data-collapsed]) .close,
    :host([data-collapsed]) .muted,
    :host([data-collapsed]) .err { display: none; }
    :host([data-collapsed]) .item {
      justify-content: center;
      padding: 8px 4px;
      gap: 0;
    }
    .section-label {
      padding: 10px 8px 6px;
      font-size: var(--font-size-xs);
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.6px;
      color: var(--neutral-gray);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .refresh {
      border: none;
      background: none;
      color: var(--neutral-gray);
      cursor: pointer;
      font-size: var(--font-size-xs);
      padding: 2px 4px;
      border-radius: var(--radius-sm, 5px);
    }
    .refresh:hover { color: var(--bright-white); background: var(--w8); }
    .refresh svg, .close svg { display: block; }
    .section-tools { display: flex; align-items: center; gap: 2px; }

    .item {
      position: relative;
      display: flex;
      align-items: center;
      gap: 9px;
      padding: 9px 10px;
      border-radius: var(--radius);
      cursor: pointer;
      transition: background var(--transition-fast);
    }
    .item:hover { background: var(--w8); }
    .item.current {
      background: var(--accent-a10);
      border-left: 3px solid var(--accent);
      padding-left: 7px;
    }
    .item.current:hover { background: var(--accent-a15); }
    .item.reorderable {
      cursor: grab;
      user-select: none;
      -webkit-user-select: none;
    }
    .item.reorderable:active { cursor: grabbing; }
    .item.dragging {
      opacity: 0.45;
      background: var(--w8);
    }
    .item.dragging .row-actions { opacity: 0; pointer-events: none; }
    .item.drop-before::before,
    .item.drop-after::after {
      content: '';
      position: absolute;
      left: 10px;
      right: 10px;
      height: 2px;
      border-radius: 99px;
      background: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-a15);
      pointer-events: none;
    }
    .item.drop-before::before { top: -2px; }
    .item.drop-after::after { bottom: -2px; }

    .dot-wrap { position: relative; display: inline-flex; flex-shrink: 0; }
    .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--neutral-gray); flex-shrink: 0; }
    .dot.ready { background: var(--emerald); box-shadow: 0 0 6px var(--green-a30); }
    .dot.active { background: var(--accent); box-shadow: 0 0 6px var(--accent-a35); }
    .dot.waiting { background: var(--accent); }
    .dot.error { background: var(--red); }
    /* Finished + idle: solid emerald. Unread (finished since last viewed) adds a
       ring — an inner gap in the row background, then an emerald halo — so a
       just-done session reads distinctly from one the user has already seen. */
    .dot.done { background: var(--emerald); }
    .dot.done.unread { box-shadow: 0 0 0 2px var(--w3), 0 0 0 4px var(--emerald); }
    .item.current .dot.done.unread { box-shadow: 0 0 0 2px var(--accent-a18), 0 0 0 4px var(--emerald); }

    /* Attention pip on the status dot — only rendered in the collapsed rail,
       where the .body badges are hidden. Sits at the dot's corner. */
    .pip {
      position: absolute;
      top: -6px;
      right: -7px;
      min-width: 12px;
      height: 12px;
      padding: 0 2px;
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 99px;
      font-size: 9px;
      font-weight: 700;
      line-height: 1;
      color: var(--bright-white);
    }
    .pip.needs { background: var(--accent); }
    .pip.stuck { background: var(--red); }
    .pip.queued { background: var(--amber); color: #1a1a1a; }
    /* Bare unread dot on the collapsed rail — no glyph, just an emerald marker. */
    .pip.unread {
      min-width: 8px;
      width: 8px;
      height: 8px;
      padding: 0;
      top: -3px;
      right: -4px;
      background: var(--emerald);
      box-shadow: 0 0 0 2px var(--w3);
    }

    .body { min-width: 0; flex: 1; }
    .pinned-marker {
      flex-shrink: 0;
      display: inline-flex;
      color: var(--amber);
    }
    .title {
      font-size: var(--font-size-base);
      color: var(--white);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .item.current .title { color: var(--bright-white); font-weight: 600; }
    .sub {
      font-size: var(--font-size-xs);
      color: var(--neutral-gray);
      font-family: var(--font-mono);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      margin-top: 1px;
    }
    /* Row actions (rename / delete / end-session) float over the row's right
       edge instead of taking inline width — so the title spans the full row at
       rest and never gets squeezed by reserved button space. Revealed as a group
       on hover; a left gradient fades the title out behind them (Claude.ai /
       VSCode explorer idiom) rather than colliding with it. */
    .row-actions {
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      display: flex;
      align-items: center;
      gap: 2px;
      padding-right: 8px;
      padding-left: 6px;
      border-radius: 0 var(--radius) var(--radius) 0;
      --actions-bg: var(--bg-elevated-hover);
      background: var(--actions-bg);
      opacity: 0;
      transition: opacity var(--transition-fast);
      pointer-events: none;
    }
    .item:hover .row-actions { opacity: 1; pointer-events: auto; }
    .item.current .row-actions {
      --actions-bg: color-mix(in srgb, var(--accent) 22%, var(--bg-elevated-hover));
    }
    .row-actions::before {
      content: '';
      position: absolute;
      top: 0;
      bottom: 0;
      right: 100%;
      width: 20px;
      background: linear-gradient(to right, transparent, var(--actions-bg));
      pointer-events: none;
    }

    .close {
      flex-shrink: 0;
      border: none;
      background: none;
      color: var(--neutral-gray);
      cursor: pointer;
      font-size: 15px;
      line-height: 1;
      padding: 2px 4px;
      border-radius: var(--radius-sm, 5px);
      transition: color var(--transition-fast), background var(--transition-fast);
    }
    .close:hover { color: var(--red); background: var(--red-a15); }

    /* Compact row actions for Recent sessions. */
    .edit,
    .pin {
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: none;
      background: none;
      color: var(--neutral-gray);
      cursor: pointer;
      padding: 2px 4px;
      border-radius: var(--radius-sm, 5px);
      transition: color var(--transition-fast), background var(--transition-fast);
    }
    .edit:hover { color: var(--bright-white); background: var(--w8); }
    .pin.pinned { color: var(--amber); }
    .pin:hover:not(:disabled) {
      color: var(--amber);
      background: color-mix(in srgb, var(--amber) 14%, transparent);
    }
    .pin:disabled { opacity: 0.5; cursor: default; }

    /* Trash to delete a Recent session, styled like .edit. */
    .trash {
      flex-shrink: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: none;
      background: none;
      color: var(--neutral-gray);
      cursor: pointer;
      padding: 2px 4px;
      border-radius: var(--radius-sm, 5px);
      transition: color var(--transition-fast), background var(--transition-fast);
    }
    .trash:hover { color: var(--red); background: var(--red-a15); }

    /* Permanent-delete confirmation modal, overlaying the whole sidebar pane. */
    .delete-backdrop {
      position: fixed;
      inset: var(--overlay-top-inset, 0px) 0 0 0;
      z-index: 200;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      background: var(--overlay-scrim, rgba(0, 0, 0, 0.5));
      backdrop-filter: blur(2px);
      -webkit-backdrop-filter: blur(2px);
    }
    .delete-dialog {
      width: min(360px, 100%);
      background: var(--surface-modal);
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-lg, 12px);
      box-shadow: var(--shadow-lg, 0 16px 48px rgba(0, 0, 0, 0.45));
      padding: 18px 18px 16px;
      animation: pop-in 0.16s ease-out;
    }
    @keyframes pop-in {
      from { opacity: 0; transform: scale(0.97); }
      to { opacity: 1; transform: scale(1); }
    }
    .dd-title {
      font-size: var(--font-size-md);
      font-weight: 600;
      color: var(--bright-white);
      margin-bottom: 8px;
    }
    .dd-body {
      font-size: var(--font-size-sm);
      color: var(--gray);
      line-height: 1.5;
    }
    .dd-name {
      display: block;
      color: var(--bright-white);
      font-weight: 600;
      margin-bottom: 4px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .dd-actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 18px;
    }
    .dd-btn {
      padding: 7px 14px;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius);
      background: var(--glass-bg);
      color: var(--white);
      font-size: var(--font-size-sm);
      font-family: var(--font);
      cursor: pointer;
      transition: all var(--transition-fast);
    }
    .dd-btn:hover:not(:disabled) { border-color: var(--glass-border-hover); background: var(--w8); }
    .dd-btn.danger {
      background: var(--red-a15);
      border-color: var(--red-a25, var(--red));
      color: var(--red);
      font-weight: 600;
    }
    .dd-btn.danger:hover:not(:disabled) { background: var(--red); color: var(--bright-white); border-color: var(--red); }
    .dd-btn:disabled { opacity: 0.5; cursor: default; }

    .rename-input {
      width: 100%;
      box-sizing: border-box;
      padding: 1px 5px;
      border: 1px solid var(--accent-a35);
      border-radius: 4px;
      background: var(--w5);
      color: var(--bright-white);
      font-size: var(--font-size-base);
      font-family: var(--font);
      outline: none;
    }

    .muted { padding: 10px 8px; font-size: var(--font-size-sm); color: var(--neutral-gray); }

    /* Escape hatch from the capped Recent shortcut list to the full History tab. */
    .view-all {
      display: block;
      width: 100%;
      margin-top: 4px;
      padding: 8px 10px;
      border: none;
      background: none;
      color: var(--neutral-gray);
      font-size: var(--font-size-xs);
      font-weight: 600;
      font-family: var(--font);
      text-align: left;
      cursor: pointer;
      border-radius: var(--radius);
      transition: all var(--transition-fast);
    }
    .view-all:hover { color: var(--bright-white); background: var(--w8); }
    .err { padding: 8px; margin: 4px 8px; font-size: var(--font-size-xs); color: var(--red); background: var(--red-a15); border-radius: var(--radius); }


    /* Per-agent badge so Claude vs Gemini sessions are distinguishable at a glance */
    .agent-badge {
      flex-shrink: 0;
      font-size: var(--font-size-xs);
      font-weight: 600;
      letter-spacing: 0.3px;
      color: var(--purple-light);
      background: var(--accent-a15);
      border: 1px solid var(--accent-a25);
      padding: 1px 7px;
      border-radius: 99px;
      text-transform: capitalize;
    }
    .agent-badge.gemini { color: var(--gemini-fg); background: var(--gemini-bg); border-color: var(--gemini-border); }
    .agent-mark { flex-shrink: 0; display: inline-flex; opacity: 0.9; }
    .sub-row { display: flex; align-items: center; gap: 6px; margin-top: 2px; }
    .sub-row .sub { margin-top: 0; flex: 1; min-width: 0; }

    /* Title row: title shrinks so badges stay visible when titles get long. */
    .title-row { display: flex; align-items: center; gap: 6px; min-width: 0; }
    .title-row .title { flex: 1; min-width: 0; }
    .needs-you {
      flex-shrink: 0;
      font-size: 9px;
      font-weight: 600;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      color: var(--bright-white);
      background: var(--accent);
      padding: 1px 6px;
      border-radius: 99px;
      line-height: 1.4;
    }
    .queued-badge {
      flex-shrink: 0;
      font-size: 10px;
      font-weight: 600;
      color: var(--amber);
      background: var(--amber-a15, rgba(245,158,11,0.12));
      border: 1px solid var(--amber-a25, rgba(245,158,11,0.25));
      padding: 0 6px;
      border-radius: 99px;
      line-height: 1.5;
    }
    .stuck-badge {
      flex-shrink: 0;
      font-size: 9px;
      font-weight: 600;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      color: var(--bright-white);
      background: var(--red);
      padding: 1px 6px;
      border-radius: 99px;
      line-height: 1.4;
    }
    .done-badge {
      flex-shrink: 0;
      font-size: 9px;
      font-weight: 600;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      color: var(--emerald);
      background: var(--green-a15, rgba(63, 185, 80, 0.15));
      border: 1px solid var(--green-a30, rgba(63, 185, 80, 0.28));
      padding: 1px 6px;
      border-radius: 99px;
      line-height: 1.4;
    }

    /* In-progress tool / last assistant snippet / Thinking… — a single ellipsised
       line below the agent/cwd row so the user can see what's happening without
       switching to that session. */
    .activity {
      margin-top: 2px;
      font-size: var(--font-size-xs);
      color: var(--gray);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .activity.thinking { color: var(--accent); }
    .activity.idle { color: var(--neutral-gray); font-style: italic; }
    .activity.stalled { color: var(--red); }
    .activity.done { color: var(--neutral-gray); }
    .activity.done-unread { color: var(--emerald); font-weight: 500; }
    /* Elapsed turn time, trailing the activity text — muted + tabular so it
       doesn't jitter as the seconds tick. */
    .activity .elapsed {
      margin-left: 4px;
      color: var(--neutral-gray);
      font-variant-numeric: tabular-nums;
    }

    /* Compact context-usage meter — same visual language as the timeline meter,
       slimmer so it fits in the sidebar row. */
    .meter-row {
      display: flex;
      align-items: center;
      gap: 7px;
      margin-top: 4px;
      font-size: 10px;
      color: var(--neutral-gray);
      font-family: var(--font-mono);
    }
    .meter-bar {
      flex: 1;
      height: 3px;
      border-radius: 99px;
      background: var(--w10);
      overflow: hidden;
    }
    .meter-fill {
      display: block;
      height: 100%;
      background: var(--emerald);
      transition: width var(--transition-fast), background var(--transition-fast);
    }
    .meter-fill.warn { background: var(--amber); }
    .meter-fill.high { background: var(--red); }
  `];

  // 1s tick that repaints the elapsed "thinking for m:ss" readouts. Cheap and
  // only fires while at least one session is mid-turn (see updated()).
  private elapsedTimer: ReturnType<typeof setInterval> | null = null;
  // The Recent list is a snapshot of `kairos sessions list`; poll it so an ended
  // session's stale green dot ages out (the CLI's `active` flag is time-windowed)
  // without the user having to hit Refresh.
  private recentTimer: ReturnType<typeof setInterval> | null = null;

  connectedCallback() {
    super.connectedCallback();
    this.syncCollapsedAttr();
    this.syncWidth();
    this.loadRecent();
    this.recentTimer = setInterval(() => this.loadRecent(), 20000);
    window.addEventListener('keydown', this.onKeydown);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.endResize();
    this.clearReorderPointer();
    this.stopElapsedTimer();
    if (this.recentTimer != null) { clearInterval(this.recentTimer); this.recentTimer = null; }
    window.removeEventListener('keydown', this.onKeydown);
  }

  // Escape dismisses the delete confirmation (unless a delete is mid-flight).
  private onKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && this.confirmingDeleteId && !this.deletingId) {
      this.confirmingDeleteId = null;
    }
  };

  updated() {
    // Run the per-second repaint only while a turn is in flight, so an idle
    // sidebar isn't waking up once a second forever.
    const anyThinking = this.active.some((a) => a.phase === 'thinking' && a.turnStartedAt != null);
    if (anyThinking) this.startElapsedTimer();
    else this.stopElapsedTimer();
  }

  private startElapsedTimer() {
    if (this.elapsedTimer != null) return;
    this.elapsedTimer = setInterval(() => this.requestUpdate(), 1000);
  }

  private stopElapsedTimer() {
    if (this.elapsedTimer == null) return;
    clearInterval(this.elapsedTimer);
    this.elapsedTimer = null;
  }

  private syncWidth() {
    this.style.setProperty('--sidebar-width', `${this.width}px`);
  }

  // Drag-to-resize with VSCode-style collapse: pull the pane below the collapse
  // threshold and it snaps shut; drag the collapsed rail back past it and it
  // reopens. Pointer capture keeps events flowing even when the cursor outruns
  // the thin handle; width/collapsed state persist on release.
  private resizeStartX = 0;
  private resizeStartW = 0;

  private startResize = (e: PointerEvent) => {
    e.preventDefault();
    this.resizing = true;
    this.resizeStartX = e.clientX;
    // A collapsed pane drags from its rendered rail width, not the stored width,
    // so the reopen threshold is measured from where the handle actually sits.
    this.resizeStartW = this.collapsed ? this.offsetWidth : this.width;
    this.setAttribute('data-resizing', '');
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    window.addEventListener('pointermove', this.onResizeMove);
    window.addEventListener('pointerup', this.onResizeEnd);
  };

  private onResizeMove = (e: PointerEvent) => {
    if (!this.resizing) return;
    const raw = this.resizeStartW + (e.clientX - this.resizeStartX);
    if (raw < COLLAPSE_THRESHOLD) {
      if (!this.collapsed) { this.collapsed = true; this.syncCollapsedAttr(); }
    } else {
      if (this.collapsed) { this.collapsed = false; this.syncCollapsedAttr(); this.loadRecent(); }
      this.width = clampWidth(raw);
      this.syncWidth();
    }
  };

  private onResizeEnd = () => {
    if (!this.resizing) return;
    this.endResize();
    saveCollapsed(this.collapsed);
    if (!this.collapsed) saveWidth(this.width);
  };

  private endResize() {
    this.resizing = false;
    this.removeAttribute('data-resizing');
    window.removeEventListener('pointermove', this.onResizeMove);
    window.removeEventListener('pointerup', this.onResizeEnd);
  }

  // Double-click the handle to reset to the default width (and reopen if collapsed).
  private resetWidth = () => {
    const wasCollapsed = this.collapsed;
    this.collapsed = false;
    this.syncCollapsedAttr();
    this.width = WIDTH_DEFAULT;
    this.syncWidth();
    saveCollapsed(false);
    saveWidth(this.width);
    if (wasCollapsed) this.loadRecent();
  };

  // Layout-toolbar toggle for this sidebar's own collapse (drag-to-collapse is
  // the other path). Restores the default width when reopening from the rail so
  // it doesn't reopen at some tiny dragged-down width.
  private toggleCollapsed = () => {
    this.collapsed = !this.collapsed;
    if (!this.collapsed && this.width < WIDTH_MIN) this.width = WIDTH_DEFAULT;
    this.syncCollapsedAttr();
    this.syncWidth();
    saveCollapsed(this.collapsed);
    if (!this.collapsed) { saveWidth(this.width); this.loadRecent(); }
  };

  private syncCollapsedAttr() {
    if (this.collapsed) this.setAttribute('data-collapsed', '');
    else this.removeAttribute('data-collapsed');
  }

  /** Reload the on-disk session list — call after a session ends so it appears. */
  async loadRecent() {
    this.loadingRecent = true;
    this.recentError = '';
    try {
      // All ACP agents' past sessions — each entry carries its `tool`, and
      // resume routes to the right agent by it.
      const res = await getSessions({ apps: 'all', since: '30d' });
      this.recent = res.sessions;
    } catch (err: any) {
      // Silently ignore connection errors (backend not running) — only show
      // actual server-side failures to the user.
      const msg = err?.message ?? '';
      const isConnectionError = msg === 'Not Found' || msg === 'Failed to fetch' || msg.includes('ECONNREFUSED');
      if (!isConnectionError) {
        this.recentError = msg || 'Failed to load sessions';
      }
    } finally {
      this.loadingRecent = false;
    }
  }

  private emit(name: string, detail?: unknown) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  private eventStartedOnControl(e: Event): boolean {
    return e.composedPath().some((node) =>
      node instanceof HTMLElement
      && node !== this
      && node.matches('button, input, textarea, select, a, [contenteditable="true"]'));
  }

  private itemClass(kind: ReorderKind | null, id: string, extra = ''): string {
    const classes = ['item'];
    if (extra) classes.push(extra);
    if (kind && this.dragging?.kind === kind && this.dragging.id === id) {
      classes.push('dragging');
    }
    if (kind && this.dropTarget?.kind === kind && this.dropTarget.id === id) {
      classes.push(`drop-${this.dropTarget.position}`);
    }
    return classes.join(' ');
  }

  private startReorderPointer(kind: ReorderKind, id: string, e: PointerEvent) {
    if (
      this.collapsed
      || this.renamingId === id
      || this.eventStartedOnControl(e)
      || e.button !== 0
      || !e.isPrimary
    ) {
      return;
    }

    const source = e.currentTarget as HTMLElement;
    this.reorderPointer = {
      kind,
      id,
      pointerId: e.pointerId,
      source,
      startX: e.clientX,
      startY: e.clientY,
      started: false,
    };
    source.setPointerCapture?.(e.pointerId);
    window.addEventListener('pointermove', this.onReorderPointerMove, { passive: false });
    window.addEventListener('pointerup', this.onReorderPointerUp);
    window.addEventListener('pointercancel', this.onReorderPointerCancel);
  }

  private onReorderPointerMove = (e: PointerEvent) => {
    const drag = this.reorderPointer;
    if (!drag || drag.pointerId !== e.pointerId) return;

    if (!drag.started) {
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      if (Math.hypot(dx, dy) < REORDER_DRAG_THRESHOLD) return;
      drag.started = true;
      this.dragging = { kind: drag.kind, id: drag.id };
      this.dropTarget = null;
    }

    e.preventDefault();
    this.updateReorderDropTarget(drag.kind, drag.id, e.clientX, e.clientY);
  };

  private onReorderPointerUp = (e: PointerEvent) => {
    const drag = this.reorderPointer;
    if (!drag || drag.pointerId !== e.pointerId) return;

    if (drag.started) {
      this.updateReorderDropTarget(drag.kind, drag.id, e.clientX, e.clientY);
    }
    const target = drag.started ? this.dropTarget : null;
    if (drag.started) {
      e.preventDefault();
      this.suppressNextRowClick(drag.kind, drag.id);
    }
    this.clearReorderPointer();

    if (!target || target.kind !== drag.kind || target.id === drag.id) return;
    this.commitReorder(drag.kind, drag.id, target.id, target.position);
  };

  private onReorderPointerCancel = (e: PointerEvent) => {
    const drag = this.reorderPointer;
    if (!drag || drag.pointerId !== e.pointerId) return;
    this.clearReorderPointer();
  };

  private updateReorderDropTarget(kind: ReorderKind, sourceId: string, clientX: number, clientY: number) {
    const target = this.shadowRoot?.elementFromPoint(clientX, clientY);
    const row = target?.closest<HTMLElement>('[data-reorder-kind]');
    const id = row?.dataset.reorderId;
    if (!row || row.dataset.reorderKind !== kind || !id || id === sourceId) {
      if (this.dropTarget) this.dropTarget = null;
      return;
    }

    const rect = row.getBoundingClientRect();
    const position: DropPosition = clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    if (
      this.dropTarget?.kind !== kind
      || this.dropTarget.id !== id
      || this.dropTarget.position !== position
    ) {
      this.dropTarget = { kind, id, position };
    }
  }

  private commitReorder(kind: ReorderKind, sourceId: string, targetId: string, position: DropPosition) {
    if (kind === 'active') {
      this.emit('reorder-active-sessions', { sourceId, targetId, position });
    } else {
      void this.reorderPinnedRows(sourceId, targetId, position);
    }
  }

  private clearReorderPointer() {
    const drag = this.reorderPointer;
    if (drag) {
      try {
        drag.source.releasePointerCapture?.(drag.pointerId);
      } catch {
        // The browser may have already released the capture.
      }
    }
    this.reorderPointer = null;
    this.dragging = null;
    this.dropTarget = null;
    window.removeEventListener('pointermove', this.onReorderPointerMove);
    window.removeEventListener('pointerup', this.onReorderPointerUp);
    window.removeEventListener('pointercancel', this.onReorderPointerCancel);
  }

  private suppressNextRowClick(kind: ReorderKind, id: string) {
    this.suppressClick = { kind, id };
    window.setTimeout(() => {
      if (this.suppressClick?.kind === kind && this.suppressClick.id === id) {
        this.suppressClick = null;
      }
    }, 0);
  }

  private handleRowClick(kind: ReorderKind | null, id: string, e: MouseEvent, action: () => void) {
    if (kind && this.suppressClick?.kind === kind && this.suppressClick.id === id) {
      e.preventDefault();
      e.stopPropagation();
      this.suppressClick = null;
      return;
    }
    action();
  }

  private sameIds(a: string[], b: string[]): boolean {
    return a.length === b.length && a.every((id, index) => id === b[index]);
  }

  private async reorderPinnedRows(sourceId: string, targetId: string, position: DropPosition) {
    const pinnedIds = this.recent.filter((s) => s.pinned).map((s) => s.id);
    const nextIds = moveId(pinnedIds, sourceId, targetId, position);
    if (this.sameIds(pinnedIds, nextIds)) return;

    const orderedPinned = reorderByIds(
      this.recent.filter((s) => s.pinned),
      nextIds,
      (s) => s.id,
    );
    let pinnedIndex = 0;
    this.recent = this.recent.map((s) => s.pinned ? orderedPinned[pinnedIndex++] : s);
    this.recentError = '';

    try {
      await reorderPinnedSessions(nextIds);
      await this.loadRecent();
    } catch (err: any) {
      this.recentError = err?.message ?? 'Failed to reorder pinned sessions';
      await this.loadRecent();
    }
  }

  // ── Inline rename ──────────────────────────────────────────────────────────
  // The durable write goes to the backend override map (the kairos CLI can't
  // rename); for active sessions we also emit `rename-session` so the parent
  // patches the live AgentSession (and its sessionStorage copy).
  private startRename(id: string, currentTitle: string) {
    this.renamingId = id;
    this.renameValue = currentTitle;
    this.updateComplete.then(() => {
      const input = this.renderRoot.querySelector<HTMLInputElement>('.rename-input');
      input?.focus();
      input?.select();
    });
  }

  private async commitRename(id: string, currentTitle: string, isActive: boolean) {
    const newName = this.renameValue.trim();
    if (this.renamingId !== id) return;
    this.renamingId = null;
    if (newName === currentTitle) return;
    try {
      await renameSession(id, newName);
      if (isActive) this.emit('rename-session', { id, title: newName });
      await this.loadRecent();
    } catch {
      // network/disk error — leave the existing title in place
    }
  }

  private cancelRename() {
    this.renamingId = null;
  }

  // Inline text field shared by active and recent rows during a rename.
  private renderRenameInput(id: string, currentTitle: string, isActive: boolean) {
    return html`<input
      class="rename-input"
      type="text"
      .value=${this.renameValue}
      @click=${(e: Event) => e.stopPropagation()}
      @input=${(e: Event) => { this.renameValue = (e.target as HTMLInputElement).value; }}
      @keydown=${(e: KeyboardEvent) => {
        e.stopPropagation();
        if (e.key === 'Enter') this.commitRename(id, currentTitle, isActive);
        if (e.key === 'Escape') this.cancelRename();
      }}
      @blur=${() => this.commitRename(id, currentTitle, isActive)}
    />`;
  }

  private renderEditButton(id: string, currentTitle: string) {
    return html`<button
      class="edit"
      ${tooltip('Rename')}
      aria-label="Rename session"
      @click=${(e: Event) => { e.stopPropagation(); this.startRename(id, currentTitle); }}
    >
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M11.5 2.5l2 2L6 12l-2.5.5.5-2.5 7.5-7.5z"/>
      </svg>
    </button>`;
  }

  private async togglePin(s: SessionEntry) {
    this.pinningId = s.id;
    try {
      if (s.pinned) {
        await unpinSession(s.id);
      } else {
        await pinSession(s.id);
      }
      await this.loadRecent();
    } catch (err: any) {
      this.recentError = err?.message ?? 'Failed to update pinned session';
    } finally {
      this.pinningId = null;
    }
  }

  private renderPinButton(s: SessionEntry) {
    return html`<button
      class="pin ${s.pinned ? 'pinned' : ''}"
      ?disabled=${this.pinningId === s.id}
      ${tooltip(s.pinned ? 'Unpin from top' : 'Pin to top')}
      aria-label=${s.pinned ? 'Unpin session' : 'Pin session'}
      @click=${(e: Event) => { e.stopPropagation(); this.togglePin(s); }}
    >
      ${icon.pin(13)}
    </button>`;
  }

  // ── Delete (Recent rows only) ──────────────────────────────────────────────
  // Deleting a session permanently unlinks its transcript from disk, so the
  // trash icon opens an explicit confirmation dialog (a bare arm-then-confirm on
  // a 13px icon is too easy to miss and to trigger by accident).
  private async confirmDelete() {
    const id = this.confirmingDeleteId;
    if (!id) return;
    this.deletingId = id;
    try {
      await deleteSession(id);
      this.recent = this.recent.filter((s) => s.id !== id);
      this.confirmingDeleteId = null;
    } catch (err: any) {
      this.recentError = err?.message ?? 'Failed to delete session';
      this.confirmingDeleteId = null;
    } finally {
      this.deletingId = null;
    }
  }

  private renderDeleteButton(id: string) {
    return html`<button
      class="trash"
      ${tooltip('Delete session')}
      aria-label="Delete session"
      @click=${(e: Event) => { e.stopPropagation(); this.confirmingDeleteId = id; }}
    >
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M2.5 4h11M6 4V2.5h4V4M5 4l.5 9h5l.5-9"/>
      </svg>
    </button>`;
  }

  // Modal confirmation for a permanent session delete. Rendered at the sidebar
  // root so it overlays the whole pane; Escape / backdrop-click / Cancel dismiss.
  private renderDeleteDialog() {
    const id = this.confirmingDeleteId;
    if (!id) return nothing;
    const s = this.recent.find((r) => r.id === id);
    const title = s ? (s.title || s.firstMessage || s.id.slice(0, 8)) : 'this session';
    const deleting = this.deletingId === id;
    return html`
      <div
        class="delete-backdrop"
        @click=${() => { if (!deleting) this.confirmingDeleteId = null; }}
      >
        <div
          class="delete-dialog"
          role="alertdialog"
          aria-modal="true"
          aria-label="Delete session"
          @click=${(e: Event) => e.stopPropagation()}
        >
          <div class="dd-title">Delete session?</div>
          <div class="dd-body">
            <span class="dd-name">${title}</span>
            This permanently deletes the conversation transcript from disk. This can't be undone.
          </div>
          <div class="dd-actions">
            <button class="dd-btn" ?disabled=${deleting} @click=${() => { this.confirmingDeleteId = null; }}>Cancel</button>
            <button class="dd-btn danger" ?disabled=${deleting} @click=${() => this.confirmDelete()}>
              ${deleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  // VSCode-style layout toolbar: one button per collapsible in-pane region
  // (this left sidebar and the right side-panel). Each uses the panel-frame
  // glyph so the icon mirrors the actual layout. Sits in its own row above New
  // session; always reachable regardless of session state.
  private renderLayoutToolbar() {
    const sidebarOpen = !this.collapsed;
    return html`
      <div class="layout-toolbar" role="group" aria-label="Toggle layout regions">
        <button
          class="bts-btn ${this.behindActive ? 'on' : ''}"
          @click=${() => this.emit('show-behind-scenes')}
          ${tooltip(this.behindActive
            ? 'Behind the Scenes — click to close'
            : 'Behind the Scenes — how the Agents tab talks to Claude')}
          aria-label="Behind the Scenes"
          aria-pressed=${this.behindActive}
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M1.5 8S3.8 3.5 8 3.5 14.5 8 14.5 8 12.2 12.5 8 12.5 1.5 8 1.5 8z"/>
            <circle cx="8" cy="8" r="2"/>
          </svg>
          <span class="bts-label">Behind the Scenes</span>
        </button>
        <span class="layout-toolbar-spacer"></span>
        <button
          class="layout-btn"
          @click=${this.toggleCollapsed}
          ${tooltip(sidebarOpen
            ? 'Collapse the sidebar to a narrow rail'
            : 'Expand the sidebar')}
          aria-label=${sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          aria-pressed=${sidebarOpen}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round">
            <g class="frame"><rect x="2" y="2.5" width="12" height="11" rx="2"/><path d="M6 2.5v11"/></g>
            ${sidebarOpen ? svg`<rect x="2.7" y="3.1" width="2.7" height="9.8" rx="0.6" fill="currentColor" stroke="none"/>` : nothing}
          </svg>
        </button>
        <button
          class="layout-btn"
          ?disabled=${!this.rightPanelAvailable}
          @click=${() => this.emit('toggle-right-panel')}
          ${tooltip(!this.rightPanelAvailable
            ? 'The side-panel opens inside a session'
            : this.rightPanelOpen ? 'Close the side-panel' : 'Open the side-panel (Files, Review, Summary, Plan)')}
          aria-label=${this.rightPanelOpen ? 'Close side-panel' : 'Open side-panel'}
          aria-pressed=${this.rightPanelOpen}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round">
            <g class="frame"><rect x="2" y="2.5" width="12" height="11" rx="2"/><path d="M10 2.5v11"/></g>
            ${this.rightPanelOpen ? svg`<rect x="10.6" y="3.1" width="2.7" height="9.8" rx="0.6" fill="currentColor" stroke="none"/>` : nothing}
          </svg>
        </button>
      </div>
    `;
  }

  render() {
    const activeIds = new Set(this.active.map((a) => a.id));
    const previous = this.previouslyOpen.filter((s) => !activeIds.has(s.id));
    const previousIds = new Set(previous.map((s) => s.id));
    // Don't list a past session that's already open as a live session.
    const visible = this.recent.filter((s) => !activeIds.has(s.id) && !previousIds.has(s.id));
    // Pinned sessions get their own section above Recent — deliberate keeps,
    // surfaced in full and never subject to the recency cap. The sidebar is a
    // "jump back in" shortcut, not a browser, so the unpinned list is capped and
    // defers to the History tab for the full archive.
    const pinned = visible.filter((s) => s.pinned);
    const unpinned = visible.filter((s) => !s.pinned).slice(0, RECENT_LIMIT);
    const hasMore = visible.length - pinned.length > unpinned.length;
    const collapsed = this.collapsed;
    const canQuickStart = !!this.lastCwd && !!this.lastAgentLabel;
    return html`
      ${this.renderLayoutToolbar()}
      <div class="header">
        ${collapsed
          ? html`
              <button
                class="new-session icon-only"
                ${tooltip('New session')}
                @click=${() => this.emit('new-session')}
              >
                <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M8 3.5v9M3.5 8h9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
              </button>
            `
          : html`
                <button
                  class="new-session"
                  ${tooltip('New session')}
                  @click=${() => this.emit('new-session')}
                >
                  <svg width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M8 3.5v9M3.5 8h9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                  <span>New session</span>
                </button>
              `}
      </div>
      <div class="scroll">
        ${this.active.length > 0 ? html`
          ${collapsed ? nothing : html`
            <div class="section-label">
              Active
              <button class="refresh" ${tooltip({ content: () => this.renderDotLegend(), prefer: 'right' })} aria-label="What the status dots mean">${icon.circle(13)}</button>
            </div>`}
          ${this.active.map((a) => this.renderActive(a))}
        ` : nothing}

        ${previous.length > 0 ? html`
          ${collapsed ? nothing : html`
            <div class="section-label">
              Previously open
            </div>`}
          ${previous.map((s) => this.renderRecent(s, 'previous'))}
        ` : nothing}

        ${pinned.length > 0 ? html`
          ${collapsed ? nothing : html`
            <div class="section-label">
              Pinned
              <span class="pinned-marker" ${tooltip('Sessions you pinned stay here')}>${icon.pin(13)}</span>
            </div>`}
          ${pinned.map((s) => this.renderRecent(s, 'pinned'))}
        ` : nothing}

        ${collapsed ? nothing : html`
          <div class="section-label">
            Recent
            <button class="refresh" ${tooltip('Refresh')} @click=${() => this.loadRecent()}>${icon.refresh(13)}</button>
          </div>
        `}
        ${this.recentError ? html`<div class="err">${this.recentError}</div>` : nothing}
        ${this.loadingRecent && visible.length === 0
          ? html`<div class="muted">Loading…</div>`
          : unpinned.length === 0
            ? html`<div class="muted">${pinned.length > 0 ? 'No other recent sessions.' : 'No past sessions yet.'}</div>`
            : html`
                ${unpinned.map((s) => this.renderRecent(s))}
                ${collapsed ? nothing : html`
                  <button
                    class="view-all"
                    ${tooltip('Search, filter, and export every session in History')}
                    @click=${() => this.emit('open-history')}
                  >${hasMore ? 'View all sessions' : 'View in History'} →</button>
                `}
              `}
      </div>
      <kairos-agents-pet class="pet-footer" .mood=${this.petMood} ?collapsed=${collapsed}></kairos-agents-pet>
      <div
        class="resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar (drag to collapse, double-click to reset)"
        @pointerdown=${this.startResize}
        @dblclick=${this.resetWidth}
      ></div>
      ${this.renderDeleteDialog()}
    `;
  }

  // Agent identity mark: the brand logo when we have one (Claude, Gemini),
  // otherwise the text badge so logo-less agents (e.g. codex) stay legible.
  private renderAgentMark(agent: string, label?: string) {
    return hasAgentLogo(agent)
      ? html`<agent-logo class="agent-mark" ${tooltip(label || agent)} .agent=${agent} .size=${14}></agent-logo>`
      : html`<span class="agent-badge ${agent}">${label || agent}</span>`;
  }

  // Hand-rolled DOM legend for the status-dot colors (the tooltip directive
  // takes a Node, not a Lit template). Reuses the shared `.usage-tip*` classes.
  private renderDotLegend(): Node {
    const root = document.createElement('div');
    root.className = 'usage-tip';
    const head = document.createElement('div');
    head.className = 'usage-tip-head';
    head.textContent = 'What the dots mean';
    root.appendChild(head);
    const rows: Array<[string, string]> = [
      ['var(--accent)', 'Working'],
      ['var(--accent)', 'Needs you'],
      ['var(--red)', 'Stuck / error'],
      ['var(--emerald)', 'Done, unread'],
      ['var(--emerald)', 'Done'],
      ['var(--neutral-gray)', 'Not started'],
    ];
    for (const [color, label] of rows) {
      const row = document.createElement('div');
      row.className = 'usage-tip-row';
      const swatch = document.createElement('span');
      swatch.className = 'usage-tip-swatch';
      swatch.style.background = color;
      swatch.style.borderRadius = '50%';
      row.appendChild(swatch);
      const text = document.createElement('span');
      text.className = 'usage-tip-label';
      text.textContent = label;
      row.appendChild(text);
      root.appendChild(row);
    }
    return root;
  }

  private renderActive(a: ActiveSessionSummary) {
    const needsYou = a.hasPermission || a.hasElicitation;
    // A background task (run_in_background) outlives the prompt turn, so the
    // session is still working even after phase flips to 'ready'. Treat that as
    // a working state so the row doesn't read "Done" while detached work runs.
    const bgOnly = a.phase === 'ready' && a.backgroundActive > 0 && !a.loading;
    const working = a.phase === 'thinking' || bgOnly;
    // A finished, idle session (no live attention state). `unread` = finished
    // since the user last looked at it — the "recently done, not yet visited"
    // case this row is here to surface.
    const doneIdle = a.phase === 'ready' && !a.loading && !a.stalled && !needsYou && !bgOnly && a.doneAt != null;
    const unread = doneIdle && a.unseen;
    const dotClass =
      a.stalled ? 'dot error'
      : needsYou ? 'dot waiting'
      : working ? 'dot active'
      : a.phase === 'error' ? 'dot error'
      : unread ? 'dot done unread'
      : doneIdle ? 'dot done'
      : 'dot';
    // Same branch order as dotClass — so hovering the dot explains its color.
    const dotTip =
      a.stalled ? 'Stuck — no response'
      : needsYou ? 'Needs you'
      : working ? (bgOnly ? backgroundLabel(a.backgroundActive) : 'Working…')
      : a.phase === 'error' ? 'Error'
      : unread ? `Done · ${relativeDone(a.doneAt!)} · unread`
      : doneIdle ? `Done · ${relativeDone(a.doneAt!)}`
      : 'Not started';
    const u = a.usage;
    const frac = u && u.size ? Math.min(u.used / u.size, 1) : 0;
    const pct = Math.round(frac * 100);
    const meterLevel = frac >= 0.9 ? 'high' : frac >= 0.7 ? 'warn' : '';
    // Idle sessions get italic placeholder text; thinking shows accent blue to
    // match the chat's "Working…" label. The
    // activity string already handles in-progress tool > last snippet > literal
    // "Thinking…" upstream.
    const activityClass =
      a.stalled ? 'stalled'
      : needsYou || working ? 'thinking'
      : unread ? 'done-unread'
      : doneIdle ? 'done'
      : a.phase === 'ready' ? 'idle'
      : '';
    const elapsed = a.phase === 'thinking' && a.turnStartedAt != null && !a.loading && !a.stalled
      ? formatElapsed(a.turnStartedAt)
      : '';
    const activityText = a.loading ? 'Resuming…'
      : a.stalled ? 'No response — may be stuck'
      : bgOnly ? backgroundLabel(a.backgroundActive)
      : doneIdle ? `Done · ${relativeDone(a.doneAt!)}`
      : a.activity || (a.phase === 'ready' ? 'Idle' : '');
    // Collapsed rail hides the whole .body, and with it the Needs-you / Stuck /
    // queued badges — the most attention-worthy signals. Re-surface them as a
    // small pip on the status dot so they survive at 52px; the tooltip carries
    // the full wording. Precedence mirrors the badge precedence above.
    const pip =
      this.collapsed && a.stalled ? { cls: 'pip stuck', text: '!', tip: 'Stuck — no response' }
      : this.collapsed && needsYou ? { cls: 'pip needs', text: '!', tip: 'Needs you' }
      : this.collapsed && a.queuedCount > 0 ? { cls: 'pip queued', text: String(a.queuedCount), tip: `${a.queuedCount} queued message${a.queuedCount === 1 ? '' : 's'}` }
      : this.collapsed && unread ? { cls: 'pip unread', text: '', tip: `Done · ${relativeDone(a.doneAt!)}` }
      : null;
    // At 52px the row shows only a status dot, so carry the identity in a tooltip.
    const collapsedTip = this.collapsed
      ? `${a.loading ? 'Resuming…' : a.title} — ${shortDir(a.cwd)}`
      : '';
    const reorderable = !this.collapsed && this.renamingId !== a.id;
    const rowExtra = [
      a.id === this.activeId ? 'current' : '',
      reorderable ? 'reorderable' : '',
    ].filter(Boolean).join(' ');
    return html`
      <div
        class=${this.itemClass('active', a.id, rowExtra)}
        data-reorder-kind="active"
        data-reorder-id=${a.id}
        ${this.collapsed ? tooltip(collapsedTip) : nothing}
        @pointerdown=${(e: PointerEvent) => this.startReorderPointer('active', a.id, e)}
        @click=${(e: MouseEvent) => this.handleRowClick('active', a.id, e, () => this.emit('switch-session', a.id))}
      >
        <span class="dot-wrap">
          <span class=${dotClass} ${this.collapsed ? nothing : tooltip(dotTip)}></span>
          ${pip ? html`<span class=${pip.cls} ${tooltip(pip.tip)}>${pip.text}</span>` : nothing}
        </span>
        <div class="body">
          <div class="title-row">
            ${this.renamingId === a.id
              ? this.renderRenameInput(a.id, a.title, true)
              : html`<div class="title" ${overflowTooltip(undefined, 'right')}>${a.loading ? 'Resuming…' : a.title}</div>`}
            ${a.stalled
              ? html`<span class="stuck-badge">Stuck</span>`
              : needsYou
              ? html`<span class="needs-you">Needs you</span>`
              : a.queuedCount > 0
                ? html`<span class="queued-badge" ${tooltip(`${a.queuedCount} queued message${a.queuedCount === 1 ? '' : 's'}`)}>+${a.queuedCount}</span>`
                : unread
                ? html`<span class="done-badge">Done</span>`
                : nothing}
          </div>
          <div class="sub-row">
            ${this.renderAgentMark(a.agentId, a.agentName || a.agentId)}
            <span class="sub" ${overflowTooltip(a.cwd, 'right')}>${shortDir(a.cwd)}</span>
          </div>
          ${this.collapsed
            ? nothing
            : html`<div class="activity ${activityClass}">${activityText}${elapsed ? html`<span class="elapsed">· ${elapsed}</span>` : nothing}</div>`}
          ${this.collapsed || !u || !u.size
            ? nothing
            : html`
                <div class="meter-row" ${tooltip(`${u.used.toLocaleString()} / ${u.size.toLocaleString()} tokens (${pct}%)`)}>
                  <span class="meter-bar"><span class="meter-fill ${meterLevel}" style="width:${pct}%"></span></span>
                  <span>${formatTokens(u.used)}/${formatTokens(u.size)}</span>
                </div>
              `}
        </div>
        ${this.collapsed ? nothing : html`
          <div class="row-actions">
            ${a.loading || this.renamingId === a.id ? nothing : this.renderEditButton(a.id, a.title)}
            <button
              class="close"
              ${tooltip('End this session')}
              @click=${(e: Event) => { e.stopPropagation(); this.emit('close-session', a.id); }}
            >${icon.close(14)}</button>
          </div>
        `}
      </div>
    `;
  }

  // No liveness dot here: a session that's genuinely live in this UI shows up in
  // the Active section (filtered out of Recent above), so a Recent-only row is
  // never one we're driving. The CLI's `s.active` flag is time-windowed and would
  // paint a phantom green dot on sessions that already ended elsewhere.
  private renderRecent(s: SessionEntry, group: 'pinned' | 'recent' | 'previous' = 'recent') {
    const agent = (s.tool || 'claude').toLowerCase();
    const displayTitle = s.title || s.firstMessage || s.id.slice(0, 8);
    const reorderKind: ReorderKind | null = group === 'pinned' ? 'pinned' : null;
    const reorderable = !!reorderKind && !this.collapsed && this.renamingId !== s.id;
    const age = group === 'previous' ? 'open last time' : relativeTime(s.lastActive);
    const meta = age ? `${shortDir(s.dir)} · ${age}` : shortDir(s.dir);
    return html`
      <div
        class=${this.itemClass(reorderKind, s.id, reorderable ? 'reorderable' : '')}
        data-reorder-kind=${reorderKind ?? nothing}
        data-reorder-id=${reorderKind ? s.id : nothing}
        @pointerdown=${(e: PointerEvent) => { if (reorderKind) this.startReorderPointer(reorderKind, s.id, e); }}
        @click=${(e: MouseEvent) => this.handleRowClick(reorderKind, s.id, e, () => this.emit('resume-session', s))}
      >
        <div class="body">
          ${this.renamingId === s.id
            ? this.renderRenameInput(s.id, displayTitle, false)
            : html`
                <div class="title-row">
                  ${s.pinned ? html`<span class="pinned-marker" ${tooltip('Pinned')}>${icon.pin(12)}</span>` : nothing}
                  <div class="title" ${overflowTooltip(undefined, 'right')}>${displayTitle}</div>
                </div>
              `}
          <div class="sub-row">
            ${this.renderAgentMark(agent)}
            <span class="sub" ${overflowTooltip(`${s.dir}${age ? ` · ${age}` : ''}`, 'right')}>${meta}</span>
          </div>
        </div>
        ${this.collapsed || this.renamingId === s.id || group === 'previous'
          ? nothing
          : html`<div class="row-actions">${this.renderPinButton(s)}${this.renderEditButton(s.id, displayTitle)}${this.renderDeleteButton(s.id)}</div>`}
      </div>
    `;
  }
}
