import { LitElement, html, css, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { getAuthStatus, login, getSystemUser, getTestimonials, type SessionEntry } from './services/api.js';
import { isMuted, setMuted } from './services/notify.js';
import { getAppMode, setAppMode, getAllModes, type AppMode } from './services/app-mode.js';
import { updateMonitor } from './services/update-monitor.js';
import { getRuntimeKairosVersion } from './services/desktop-updater.js';
import { KAIROS_VERSION } from './services/app-version.js';
import { getWhatsNew, peekWhatsNew, markWhatsNewSeen, type WhatsNew } from './services/whats-new.js';
import { io, type Socket } from './services/events.js';
import { keyed } from 'lit/directives/keyed.js';
import { tooltip } from './directives/tooltip.js';
import { focusRing } from './styles/focus.js';
import './components/theme-picker.js';
import './components/sessions.js';
import './components/settings-hub.js';
import './components/update-button.js';
import './components/user-menu.js';
import './components/help-drawer.js';
import './components/whats-new-panel.js';
import './components/presence-pill.js';
import './components/testimonials.js';
import './components/file-drop.js';
import './components/feedback-dialog.js';
import { installErrorCapture } from './services/feedback-log.js';

type View = 'agents' | 'files' | 'prompts' | 'plan' | 'review' | 'sessions' | 'customize' | 'settings';

const TERMINAL_VIEWS = new Set<View>([]);
const TESTIMONIAL_HINT_KEY = 'kairos:testimonial-hint-seen';

type NativeTitlebarPlatform = 'macos' | 'windows' | null;

function nativeTitlebarPlatform(): NativeTitlebarPlatform {
  if (typeof window === 'undefined' || !Boolean((window as any).__TAURI_INTERNALS__)) return null;
  const platform = `${navigator.platform} ${navigator.userAgent}`;
  if (/Mac/i.test(platform)) return 'macos';
  if (/Win/i.test(platform)) return 'windows';
  return null;
}

const NATIVE_TITLEBAR_PLATFORM = nativeTitlebarPlatform();
const IS_TAURI_MACOS = NATIVE_TITLEBAR_PLATFORM === 'macos';
const IS_TAURI_WINDOWS = NATIVE_TITLEBAR_PLATFORM === 'windows';
const HAS_NATIVE_TITLEBAR = NATIVE_TITLEBAR_PLATFORM !== null;

const VIEW_LABELS: Record<View, string> = {
  agents: 'Agents',
  files: 'Files',
  prompts: 'Prompts',
  plan: 'Plan',
  review: 'Review',
  sessions: 'History',
  customize: 'Customize',
  settings: 'Settings',
};

// Lucide-style SVG icons for nav tabs (16×16, 1.8px stroke)
const NAV_ICONS: Record<View, ReturnType<typeof html>> = {
  agents: html`<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
  files: html`<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>`,
  prompts: html`<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/></svg>`,
  plan: html`<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`,
  review: html`<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="m9 15 2 2 4-4"/></svg>`,
  sessions: html`<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
  customize: html`<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`,
  settings: html`<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="4" x2="4" y1="21" y2="14"/><line x1="4" x2="4" y1="10" y2="3"/><line x1="12" x2="12" y1="21" y2="12"/><line x1="12" x2="12" y1="8" y2="3"/><line x1="20" x2="20" y1="21" y2="16"/><line x1="20" x2="20" y1="12" y2="3"/><line x1="2" x2="6" y1="14" y2="14"/><line x1="10" x2="14" y1="8" y2="8"/><line x1="18" x2="22" y1="16" y2="16"/></svg>`,
};

function testimonialHintSeen(): boolean {
  try {
    return localStorage.getItem(TESTIMONIAL_HINT_KEY) === '1';
  } catch {
    return true;
  }
}

function markTestimonialHintSeen() {
  try {
    localStorage.setItem(TESTIMONIAL_HINT_KEY, '1');
  } catch { /* quota / disabled — ignore */ }
}

@customElement('kairos-app')
export class DevaiApp extends LitElement {
  @state() private view: View = 'agents';
  // Once the Agents tab is opened it stays mounted (just hidden when inactive)
  // so live ACP sessions — their sockets, subprocesses, and timelines — survive
  // navigating away and back. Mounting stays lazy: nothing spins up, and no
  // socket opens, until the first visit.
  @state() private agentsEverVisited = false;
  // Session handed to the Agents tab when the user resumes from Sessions/Dashboard.
  @state() private resumeEntry: SessionEntry | null = null;
  // New-session request handed to the Agents tab when the user clicks "Start
  // session" on an agent-capable app in the Dashboard/Apps catalog.
  @state() private startRequest: { agent: string; cwd?: string } | null = null;
  // Deep-search request handed to the Agents tab when the user clicks "Search
  // with <agent>" in History — launches a session that greps the transcripts.
  @state() private searchRequest: { query: string; sessions: SessionEntry[]; allSessions?: SessionEntry[] } | null = null;
  @state() private helpOpen = false;
  @state() private modePickerOpen = false;
  @state() private appMode: AppMode = getAppMode();
  // Which doc the help drawer should open on. null → the Tour (the Help "?"
  // button); a doc id → jump straight into that Full-guide chapter (the "Why"
  // button opens on 'why-kairos').
  @state() private helpDoc: string | null = null;
  @state() private whatsNew: WhatsNew | null = null;
  private runtimeVersion = KAIROS_VERSION;
  @state() private testimonialsOpen = false;
  @state() private showTestimonialHint = false;
  @state() private muted = isMuted();
  // Tracks kairos gateway auth so an expired session (e.g. left overnight) shows
  // a global banner rather than only failing when an agent turn hits a 401.
  @state() private authLoggedIn = true;
  @state() private reloggingIn = false;
  @state() private windowMaximized = false;
  @state() private feedbackOpen = false;

  static styles = [focusRing, css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100vh;
      min-height: 0;
      overflow: hidden;
      /* Height reserved for the top app header. Views that size themselves
         against the chrome (the Agents workspace) read this rather than a
         hardcoded pixel count. */
      --app-chrome-height: 65px;
      /* Full-viewport modal scrims start below this. 0 in the browser (no
         custom titlebar); the measured chrome height under a native titlebar,
         so overlays never cover the in-webview window controls / drag region. */
      --overlay-top-inset: 0px;
      --header-control-size: 36px;
      --header-control-radius: var(--radius);
      --header-control-bg: transparent;
      --header-control-bg-hover: var(--w6);
      --header-control-border: transparent;
      --header-control-border-hover: transparent;
      --header-pill-pad-x: 12px;
      --header-avatar-size: 36px;
    }
    :host([tauri-native-titlebar]) {
      --app-chrome-height: 45px;
      --overlay-top-inset: var(--app-chrome-height);
      --native-titlebar-left-padding: 16px;
      --native-titlebar-right-padding: 16px;
      --windows-titlebar-control-width: 138px;
      --header-control-size: 30px;
      --header-control-radius: 6px;
      --header-control-bg: transparent;
      --header-control-bg-hover: var(--native-control-bg-hover, var(--w8));
      --header-control-border: transparent;
      --header-control-border-hover: transparent;
      --header-pill-pad-x: 9px;
      --header-avatar-size: 30px;
    }
    :host([tauri-macos-titlebar]) {
      --native-titlebar-left-padding: 104px;
    }
    :host([tauri-windows-titlebar]) {
      --native-titlebar-right-padding: calc(16px + var(--windows-titlebar-control-width));
    }

    .auth-banner {
      position: relative;
      z-index: 10;
      flex: none;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 16px;
      padding: 10px 24px;
      background: var(--red-a15);
      border-bottom: 1px solid var(--red-a25);
      color: var(--bright-white);
      font-size: var(--font-size-md);
    }
    .auth-banner button {
      padding: 5px 14px;
      border: 1px solid var(--red-a25);
      border-radius: var(--radius);
      background: var(--red-a15);
      color: var(--bright-white);
      font-size: var(--font-size-sm);
      font-weight: 600;
      cursor: pointer;
      transition: all var(--transition-fast);
      white-space: nowrap;
    }
    .auth-banner button:hover:not(:disabled) { background: var(--red-a25); }
    .auth-banner button:disabled { opacity: 0.6; cursor: not-allowed; }

    header {
      position: relative;
      z-index: 10;
      flex: none;
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      grid-template-areas: "logo nav actions";
      align-items: center;
      gap: 10px 24px;
      padding: 14px 24px;
      border-bottom: 1px solid var(--glass-border);
      background: var(--glass-bg);
      backdrop-filter: blur(var(--glass-blur)) saturate(1.8);
      -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(1.8);
      max-width: 100%;
    }
    :host([tauri-native-titlebar]) header {
      min-height: 44px;
      gap: 8px 16px;
      padding: 5px var(--native-titlebar-right-padding) 5px var(--native-titlebar-left-padding);
      border-bottom-color: var(--native-toolbar-border, var(--glass-border));
      background: var(--native-toolbar-bg, var(--glass-bg));
    }
    .native-titlebar-drag-strip {
      display: none;
    }
    :host([tauri-native-titlebar]) .native-titlebar-drag-strip {
      position: absolute;
      z-index: 1;
      inset: 0 0 auto 0;
      display: block;
      height: 10px;
    }
    :host([tauri-native-titlebar]) .logo,
    :host([tauri-native-titlebar]) nav,
    :host([tauri-native-titlebar]) .header-actions {
      position: relative;
      z-index: 2;
    }
    .logo {
      grid-area: logo;
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
      font-size: 18px;
      font-weight: 400;
      letter-spacing: 0.07em;
      text-transform: uppercase;
      color: var(--bright-white);
      cursor: default;
      user-select: none;
      -webkit-user-select: none;
    }
    :host([tauri-native-titlebar]) .logo {
      gap: 7px;
      font-size: 15px;
      font-weight: 300;
      letter-spacing: 0.12em;
      color: var(--bright-white);
    }
    :host([tauri-native-titlebar]) .logo-mark {
      width: 22px;
      height: 22px;
    }
    .logo-mark {
      flex: none;
      display: block;
      filter: drop-shadow(0 2px 10px rgba(var(--accent-rgb), 0.25));
      cursor: pointer;
    }
    .logo-mark:hover .tine {
      animation: tine-ripple 0.6s ease-out;
    }
    .logo-mark:hover .tine:nth-child(1) { animation-delay: 0s; }
    .logo-mark:hover .tine:nth-child(2) { animation-delay: 0.05s; }
    .logo-mark:hover .tine:nth-child(3) { animation-delay: 0.10s; }
    .logo-mark:hover .tine:nth-child(4) { animation-delay: 0.15s; }
    .logo-mark:hover .tine:nth-child(5) { animation-delay: 0.20s; }
    .logo-mark:hover .tine:nth-child(6) { animation-delay: 0.15s; }
    .logo-mark:hover .tine:nth-child(7) { animation-delay: 0.10s; }
    .logo-mark:hover .tine:nth-child(8) { animation-delay: 0.05s; }
    .logo-mark:hover .tine:nth-child(9) { animation-delay: 0s; }
    @keyframes tine-ripple {
      0% { transform: translateY(0); opacity: 1; }
      30% { transform: translateY(-3px); opacity: 0.7; }
      60% { transform: translateY(1px); }
      100% { transform: translateY(0); opacity: 1; }
    }
    .logo-mark .tine {
      fill: none;
      stroke: var(--accent);
      stroke-width: 2.4;
      stroke-linecap: round;
      transition: transform 0.2s ease, opacity 0.2s ease;
      transform-origin: center bottom;
    }
    .logo-mark .tine-short { stroke-width: 2.2; }
    .logo-mark .body-frame {
      fill: none;
      stroke: var(--accent);
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
      opacity: 0.6;
    }
    .logo-mark .bridge {
      fill: var(--accent);
      opacity: 0.9;
    }
    .logo-mark .sound-hole {
      fill: var(--accent);
      opacity: 0.3;
    }
    /* Breathing glow when AI is active */
    :host([agent-active]) .logo-mark {
      animation: logo-breathe 2s ease-in-out infinite;
    }
    @keyframes logo-breathe {
      0%, 100% { filter: drop-shadow(0 2px 10px rgba(var(--accent-rgb), 0.25)); }
      50% { filter: drop-shadow(0 2px 18px rgba(var(--accent-rgb), 0.5)); }
    }
    /* Entrance animation on first load */
    .logo-mark .tine {
      stroke-dasharray: 30;
      stroke-dashoffset: 30;
      animation: tine-draw 0.8s ease-out forwards;
    }
    .logo-mark .tine:nth-child(1) { animation-delay: 0.05s; }
    .logo-mark .tine:nth-child(2) { animation-delay: 0.10s; }
    .logo-mark .tine:nth-child(3) { animation-delay: 0.15s; }
    .logo-mark .tine:nth-child(4) { animation-delay: 0.20s; }
    .logo-mark .tine:nth-child(5) { animation-delay: 0.25s; }
    .logo-mark .tine:nth-child(6) { animation-delay: 0.30s; }
    .logo-mark .tine:nth-child(7) { animation-delay: 0.35s; }
    .logo-mark .tine:nth-child(8) { animation-delay: 0.40s; }
    .logo-mark .tine:nth-child(9) { animation-delay: 0.45s; }
    @keyframes tine-draw {
      to { stroke-dashoffset: 0; }
    }
    .logo-mark .body-frame {
      stroke-dasharray: 120;
      stroke-dashoffset: 120;
      animation: frame-draw 0.9s ease-out 0.1s forwards;
    }
    @keyframes frame-draw {
      to { stroke-dashoffset: 0; }
    }
    .new-name { color: var(--bright-white); font-weight: 400; letter-spacing: 0.07em; }
    :host([tauri-native-titlebar]) .new-name {
      color: var(--bright-white);
    }
    nav {
      grid-area: nav;
      display: flex;
      flex-wrap: nowrap;
      gap: 2px;
      min-width: 0;
      margin: 0 auto;
      padding: 4px;
      background: var(--w4);
      border-radius: 100px;
      overflow-x: auto;
      overflow-y: hidden;
      scrollbar-width: none;
      -ms-overflow-style: none;
      overscroll-behavior-x: contain;
    }
    nav::-webkit-scrollbar {
      display: none;
    }
    nav button {
      position: relative;
      flex: 0 0 auto;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 7px 14px;
      border: none;
      border-radius: 100px;
      background: transparent;
      color: var(--gray);
      font-size: var(--font-size-md);
      white-space: nowrap;
      font-weight: 500;
      cursor: pointer;
      transition: all var(--transition-fast);
    }
    .nav-icon {
      width: 16px;
      height: 16px;
      flex: none;
    }
    .nav-label {
      font-size: 13px;
    }
    nav button:hover { background: var(--w6); color: var(--white); }
    nav button[active] {
      background: var(--accent-a18);
      color: var(--accent);
      border: none;
    }
    nav button[active]::after { display: none; }
    :host([tauri-native-titlebar]) nav {
      gap: 2px;
      padding: 3px;
      border-radius: 100px;
      background: var(--w4);
    }
    :host([tauri-native-titlebar]) nav button {
      height: 26px;
      padding: 0 11px;
      border-radius: 100px;
      color: var(--gray);
      font-size: var(--font-size-sm);
      font-weight: 500;
    }
    :host([tauri-native-titlebar]) nav button:hover {
      background: var(--w8);
      color: var(--bright-white);
    }
    :host([tauri-native-titlebar]) nav button[active] {
      background: var(--accent-a18);
      color: var(--accent);
    }
    :host([tauri-native-titlebar]) nav button[active]::after { display: none; }
    .spacer { display: none; }

    .header-actions {
      grid-area: actions;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      min-width: 0;
    }
    .header-actions > * { flex: none; }

    .feedback-link {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border-radius: var(--header-control-radius);
      color: var(--gray);
      font-size: var(--font-size-sm);
      text-decoration: none;
      transition: all var(--transition-fast);
      white-space: nowrap;
      /* Rendered as a <button>: strip the native chrome so it matches the
         other header controls. */
      border: none;
      background: none;
      font-family: inherit;
      cursor: pointer;
    }
    .feedback-link:hover {
      background: var(--header-control-bg-hover);
      color: var(--bright-white);
    }
    :host([tauri-native-titlebar]) .feedback-link {
      height: var(--header-control-size);
      padding: 0 9px;
    }

    .testimonial-wrap {
      position: relative;
      display: inline-flex;
    }

    .testimonial-hint {
      position: absolute;
      top: 100%;
      right: 0;
      margin-top: 8px;
      width: 268px;
      z-index: 60;
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 12px;
      background: var(--surface-raised);
      border: 1px solid var(--accent-a35);
      border-radius: var(--radius);
      box-shadow: var(--shadow-md);
      animation: testimonial-hint-in 0.16s cubic-bezier(0.2, 0, 0, 1) both;
    }
    .testimonial-hint::before {
      content: '';
      position: absolute;
      top: -6px;
      right: 14px;
      width: 10px;
      height: 10px;
      transform: rotate(45deg);
      background: var(--surface-raised);
      border-left: 1px solid var(--accent-a35);
      border-top: 1px solid var(--accent-a35);
    }
    .testimonial-hint .th-message {
      color: var(--white);
      font-size: var(--font-size-sm);
      line-height: 1.4;
    }
    .testimonial-hint .th-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 6px;
    }
    .testimonial-hint .th-primary {
      border: none;
      background: var(--accent);
      color: #fff;
      font-size: var(--font-size-sm);
      font-weight: 600;
      padding: 5px 12px;
      border-radius: var(--radius-sm);
      cursor: pointer;
    }
    .testimonial-hint .th-primary:hover { filter: brightness(1.08); }
    .testimonial-hint .th-dismiss {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: none;
      background: none;
      color: var(--gray);
      padding: 4px;
      border-radius: var(--radius-sm);
      cursor: pointer;
    }
    .testimonial-hint .th-dismiss:hover {
      color: var(--bright-white);
      background: var(--w5);
    }
    @keyframes testimonial-hint-in {
      from { opacity: 0; transform: translateY(-6px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .theme-toggle {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: var(--header-control-size);
      height: var(--header-control-size);
      border: 1px solid var(--header-control-border);
      border-radius: var(--header-control-radius);
      background: var(--header-control-bg);
      color: var(--gray);
      cursor: pointer;
      transition: all var(--transition-fast);
    }
    .theme-toggle:hover {
      border-color: var(--header-control-border-hover);
      background: var(--header-control-bg-hover);
      color: var(--bright-white);
    }
    .theme-toggle svg { width: 18px; height: 18px; display: block; }
    .theme-toggle.testimonial-toggle svg { width: 20px; height: 20px; }

    /* Mode picker dropdown */
    .mode-picker-wrap { position: relative; }
    .mode-btn span { font-weight: 600; }
    .mode-dropdown {
      position: absolute;
      top: calc(100% + 8px);
      right: 0;
      z-index: 9999;
      min-width: 240px;
      padding: 6px;
      background: var(--surface-modal);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      box-shadow: var(--shadow-lg);
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .mode-option {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      border: none;
      border-radius: var(--radius-sm);
      background: transparent;
      cursor: pointer;
      text-align: left;
      font-family: var(--font);
      transition: background var(--transition-fast);
    }
    .mode-option:hover { background: var(--w6); }
    .mode-option.active { background: var(--accent-a15); }
    .mode-option.active .mode-label { color: var(--accent); font-weight: 600; }
    .mode-icon { font-size: 16px; flex: none; width: 24px; text-align: center; }
    .mode-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .mode-label { font-size: var(--font-size-md); color: var(--white); font-weight: 500; }
    .mode-desc { font-size: var(--font-size-xs); color: var(--neutral-gray); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    /* Labeled "Why" pill — a word alongside the icon-only toggles so it's easy to
       find, but styled with the same quiet neutral header-control tokens so it
       doesn't shout. Opens the help drawer straight to the Why Kairos chapter. */
    .why-button {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: var(--header-control-size);
      padding: 0 11px;
      border: 1px solid var(--header-control-border);
      border-radius: var(--header-control-radius);
      background: var(--header-control-bg);
      color: var(--gray);
      cursor: pointer;
      font-size: var(--font-size-sm);
      font-weight: 550;
      white-space: nowrap;
      transition: all var(--transition-fast);
    }
    .why-button:hover {
      border-color: var(--header-control-border-hover);
      background: var(--header-control-bg-hover);
      color: var(--bright-white);
    }
    .why-button svg { width: 16px; height: 16px; display: block; }

    .windows-window-controls {
      display: none;
    }
    :host([tauri-windows-titlebar]) .windows-window-controls {
      position: absolute;
      top: 0;
      right: 0;
      z-index: 3;
      display: grid;
      grid-template-columns: repeat(3, 46px);
      width: var(--windows-titlebar-control-width);
      height: 44px;
    }
    .window-control {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 46px;
      height: 44px;
      border: none;
      border-radius: 0;
      background: transparent;
      color: var(--gray);
      cursor: default;
      transition: background-color var(--transition-fast), color var(--transition-fast);
    }
    .window-control:hover {
      background: var(--native-control-bg-hover, var(--w8));
      color: var(--bright-white);
    }
    .window-control.close:hover {
      background: #c42b1c;
      color: #fff;
    }
    .window-control svg {
      width: 12px;
      height: 12px;
      display: block;
      stroke-width: 1.5;
    }

    main {
      flex: 1 1 auto;
      min-height: 0;
      width: 100%;
      /* border-box so width:100% + padding stays within the viewport; without
         it the 24px horizontal padding pushed content 48px past the edge, which
         overflow-x:hidden then silently clipped (e.g. History's Refresh pill). */
      box-sizing: border-box;
      padding: 24px;
      overflow-x: hidden;
      overflow-y: auto;
      scrollbar-gutter: stable;
    }
    main::-webkit-scrollbar { width: 10px; height: 10px; }
    main::-webkit-scrollbar-track { background: transparent; }
    main::-webkit-scrollbar-thumb {
      background: var(--w10);
      border-radius: 5px;
      border: 2px solid transparent;
      background-clip: padding-box;
    }
    main::-webkit-scrollbar-thumb:hover { background: var(--w15); background-clip: padding-box; }
    /* The Agents view manages its own internal layout (sidebar + full-height
       session column) and is a workspace surface, not a grid page — it benefits
       from the full window. Drop the 24px frame entirely so the sidebar sits
       flush left, the panel rail flush right, and content tucks under the header
       (matching Cursor/Zed/Claude.ai). The view's own height calc keys off this
       (100vh - header, no main padding). The 1200px measure and frame still
       apply to the grid-based views. */
    main.full-bleed {
      max-width: none;
      padding: 0;
      overflow: hidden;
    }
    /* View entrance: content arrives with a short fade + rise instead of a hard
       swap. keyed() in render() recreates the wrapper per view so this replays.
       fill-mode is 'backwards' (not 'both') so the wrapper reverts to a
       transform-free resting state once the animation ends — a lingering
       transform would make this the containing block for any fixed-position
       descendant (modals), pinning them to the view instead of the viewport. */
    .placeholder-view {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 400px;
      text-align: center;
      padding: 48px 24px;
    }
    .placeholder-view h2 {
      font-size: var(--font-size-2xl);
      font-weight: 600;
      color: var(--bright-white);
      margin: 0 0 12px;
      letter-spacing: -0.02em;
    }
    .placeholder-view p {
      font-size: var(--font-size-md);
      color: var(--gray);
      max-width: 480px;
      line-height: 1.6;
      margin: 0;
    }
    .files-upload {
      width: 100%;
      max-width: 640px;
      margin-top: 28px;
      text-align: left;
    }
    .view-enter {
      max-width: 1200px;
      margin: 0 auto;
      animation: view-enter 0.24s cubic-bezier(0.2, 0, 0, 1) backwards;
    }
    @keyframes view-enter {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @media (prefers-reduced-motion: reduce) {
      .view-enter { animation: none; }
    }
    @media (max-width: 1180px) {
      header {
        padding: 14px 18px;
      }
      :host([tauri-native-titlebar]) header {
        padding: 5px var(--native-titlebar-right-padding) 5px var(--native-titlebar-left-padding);
      }
    }
    @media (max-width: 1320px) {
      .nav-label { display: none; }
      nav button { padding: 7px 10px; }
    }
    @media (max-width: 700px) {
      header {
        gap: 8px 12px;
        padding: 12px;
      }
      .header-actions { gap: 6px; }
      kairos-presence-pill,
      .feedback-link {
        display: none;
      }
      nav button {
        padding: 7px 11px;
        font-size: var(--font-size-sm);
      }
      :host([tauri-macos-titlebar]) {
        --native-titlebar-left-padding: 92px;
      }
      :host([tauri-windows-titlebar]) {
        --native-titlebar-left-padding: 10px;
        --native-titlebar-right-padding: calc(10px + var(--windows-titlebar-control-width));
      }
      :host([tauri-native-titlebar]) header {
        padding: 5px var(--native-titlebar-right-padding) 5px var(--native-titlebar-left-padding);
      }
    }
    @media (max-width: 520px) {
      .new-name { display: none; }
      .logo { gap: 0; }
      nav button { padding-inline: 10px; }
    }
  `];

  connectedCallback() {
    super.connectedCallback();
    // Capture client errors early so a feedback report includes anything that
    // went wrong before the tester opened the dialog.
    installErrorCapture(window as never);
    this.syncPlatformAttributes();
    void this.installWindowsWindowStateTracking();
    // Agents is the default landing view, so mount its subtree on startup.
    this.loadAgents();
    document.addEventListener('keydown', this.onGlobalKeydown);
    document.addEventListener('click', this.onDocClick);

    // Auth expiry: refresh on the backend's auth:changed push, when the tab
    // regains focus, and once now. The Agents view raises auth-expired the
    // instant a turn hits a 401 so the banner doesn't wait for the next poll.
    this.checkAuth();
    this.authSocket = io();
    this.authSocket.on('auth:changed', () => this.checkAuth());
    document.addEventListener('visibilitychange', this.onVisibility);
    this.addEventListener('auth-expired', this.onAuthExpired);
    window.addEventListener('kairos-agent-done', this.onAgentDoneForTestimonial);
    this.stopUpdateMonitor = updateMonitor.subscribe(() => {});
    void this.checkWhatsNew();
  }

  // On the first launch after a packaged auto-update, auto-show the release
  // notes stashed at install time (services/whats-new.ts) once per updated
  // version. The header button (always present) opens the notes on demand.
  private async checkWhatsNew() {
    try {
      this.runtimeVersion = await getRuntimeKairosVersion();
    } catch {
      this.runtimeVersion = KAIROS_VERSION;
    }
    this.whatsNew = getWhatsNew(this.runtimeVersion);
  }

  private openWhatsNew() {
    // Prefer the per-install notes; otherwise the build-time changelog. When
    // there's genuinely nothing, open with an empty-notes "up to date" state.
    this.whatsNew = peekWhatsNew(this.runtimeVersion)
      ?? { version: this.runtimeVersion, notes: '' };
  }

  private dismissWhatsNew() {
    if (this.whatsNew) markWhatsNewSeen(this.whatsNew.version);
    this.whatsNew = null;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.clearPlatformAttributes();
    document.removeEventListener('keydown', this.onGlobalKeydown);
    document.removeEventListener('click', this.onDocClick);
    this.authSocket?.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.removeEventListener('auth-expired', this.onAuthExpired);
    window.removeEventListener('kairos-agent-done', this.onAgentDoneForTestimonial);
    this.stopUpdateMonitor?.();
    this.stopUpdateMonitor = null;
    this.chromeObserver?.disconnect();
    this.unlistenWindowResized?.();
    this.unlistenWindowResized = null;
  }

  private chromeObserver: ResizeObserver | null = null;
  private unlistenWindowResized: (() => void) | null = null;

  firstUpdated() {
    // The Agents workspace sizes itself as calc(100vh - --app-chrome-height), so
    // that variable must equal the ACTUAL chrome height (header, plus the auth
    // banner when shown). Hardcoding it caused an 8px overflow when the header's
    // real height drifted from the guess; measuring main's offset keeps them
    // exactly in lockstep across font sizes, zoom, and the banner toggling.
    const main = this.shadowRoot?.querySelector('main');
    if (!main) return;
    const sync = () => {
      this.style.setProperty('--app-chrome-height', `${main.offsetTop}px`);
    };
    this.chromeObserver = new ResizeObserver(sync);
    // Observe the host so header/banner size changes (and their add/remove) are
    // caught; offsetTop then reflects wherever main actually starts.
    this.chromeObserver.observe(this);
    sync();
  }

  updated(changed: Map<string, unknown>) {
    // Reading main.offsetTop forces a synchronous layout, so only do it when a
    // property that actually changes the chrome height toggled — the auth
    // banner's presence. The ResizeObserver (firstUpdated) already keeps
    // --app-chrome-height in sync with any real size change, so an unrelated
    // re-render (nav switch, muted toggle, dialogs) needn't re-measure.
    if (!changed.has('authLoggedIn') && !changed.has('reloggingIn')) return;
    const main = this.shadowRoot?.querySelector('main');
    if (main) {
      this.style.setProperty('--app-chrome-height', `${main.offsetTop}px`);
    }
  }

  private authSocket: Socket | null = null;
  private stopUpdateMonitor: (() => void) | null = null;
  private checkingTestimonialHint = false;

  private syncPlatformAttributes() {
    this.clearPlatformAttributes();
    if (!HAS_NATIVE_TITLEBAR) return;
    document.documentElement.setAttribute('data-tauri-native-titlebar', '');
    if (IS_TAURI_MACOS) document.documentElement.setAttribute('data-tauri-macos', '');
    if (IS_TAURI_WINDOWS) document.documentElement.setAttribute('data-tauri-windows', '');
  }

  private clearPlatformAttributes() {
    document.documentElement.removeAttribute('data-tauri-native-titlebar');
    document.documentElement.removeAttribute('data-tauri-macos');
    document.documentElement.removeAttribute('data-tauri-windows');
  }

  private async installWindowsWindowStateTracking() {
    if (!IS_TAURI_WINDOWS) return;
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      const sync = () => {
        win.isMaximized()
          .then((maximized) => { this.windowMaximized = maximized; })
          .catch(() => {});
      };
      sync();
      this.unlistenWindowResized = await win.onResized(sync);
    } catch {
      // Browser mode and older shells simply skip the custom control state.
    }
  }

  private async controlWindow(action: 'minimize' | 'toggle-maximize' | 'close') {
    if (!IS_TAURI_WINDOWS) return;
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      if (action === 'minimize') {
        await win.minimize();
        return;
      }
      if (action === 'toggle-maximize') {
        await win.toggleMaximize();
        this.windowMaximized = await win.isMaximized();
        return;
      }
      await win.close();
    } catch {
      // Window controls are non-critical; the OS menu/taskbar still work.
    }
  }

  private onVisibility = () => {
    if (document.visibilityState === 'visible') this.checkAuth();
  };

  private onAuthExpired = () => { this.authLoggedIn = false; };

  private onAgentDoneForTestimonial = () => {
    void this.maybeShowTestimonialHint();
  };

  private async checkAuth() {
    try {
      const auth = await getAuthStatus();
      this.authLoggedIn = auth.loggedIn;
    } catch { /* leave the last-known state; a transient fetch error isn't expiry */ }
  }

  private async handleReLogin() {
    this.reloggingIn = true;
    try {
      await login();
      await this.checkAuth();
    } finally {
      this.reloggingIn = false;
    }
  }

  // "?" opens the help drawer from anywhere, the way GitHub/Linear do — but not
  // while the user is typing into a field (composer, search, rename), and not
  // when a modifier is held (so it never collides with a real shortcut). Esc-to-
  // close is owned by the drawer itself.
  private onDocClick = (e: MouseEvent) => {
    if (!this.modePickerOpen) return;
    const path = e.composedPath();
    const wrap = this.shadowRoot?.querySelector('.mode-picker-wrap');
    if (wrap && !path.includes(wrap)) this.modePickerOpen = false;
  };

  private onGlobalKeydown = (e: KeyboardEvent) => {
    if (e.key !== '?' || e.metaKey || e.ctrlKey || e.altKey) return;
    if (this.helpOpen) return;
    if (this.isTypingEvent(e)) return;
    e.preventDefault();
    this.helpDoc = null;
    this.helpOpen = true;
  };

  // Walk the event's composed path so focus inside a component's shadow DOM (the
  // Agents composer textarea lives in one) still counts as "typing".
  private isTypingEvent(e: KeyboardEvent): boolean {
    return e.composedPath().some((n) => {
      const el = n as HTMLElement;
      const tag = el?.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable === true;
    });
  }


  // The Agents subtree is the largest slice of the bundle, so it's split into
  // its own chunk and loaded lazily rather than bundled into the main entry.
  private loadAgents() {
    this.agentsEverVisited = true;
    import('./components/agents-view.js');
  }

  private navigate(view: View) {
    if (view === 'agents') this.loadAgents();
    this.view = view;
  }

  // Mute/unmute the agent done/needs-input chimes. The favicon badge is silent
  // and always shown, so there's nothing to mute there.
  private toggleMuted = () => {
    this.muted = !this.muted;
    setMuted(this.muted);
  };

  private async maybeShowTestimonialHint() {
    if (this.testimonialsOpen || this.showTestimonialHint || testimonialHintSeen()) return;
    if (this.checkingTestimonialHint) return;
    this.checkingTestimonialHint = true;
    try {
      const [{ username }, { testimonials }] = await Promise.all([getSystemUser(), getTestimonials()]);
      if (testimonialHintSeen() || this.testimonialsOpen) return;
      if (username && testimonials.some((t) => t.username === username)) {
        markTestimonialHintSeen();
        return;
      }
      this.showTestimonialHint = true;
    } catch {
      // If we can't prove the current user has no note, don't show the prompt.
    } finally {
      this.checkingTestimonialHint = false;
    }
  }

  private dismissTestimonialHint = () => {
    this.showTestimonialHint = false;
    markTestimonialHintSeen();
  };

  private openTestimonials = () => {
    if (this.showTestimonialHint) this.dismissTestimonialHint();
    this.testimonialsOpen = true;
  };

  private renderMuteToggle() {
    const label = this.muted
      ? 'Sounds off — click to chime when an agent finishes or needs input'
      : 'Sounds on — chime when an agent finishes or needs input. Click to mute.';
    return html`
      <button
        class="theme-toggle"
        @click=${this.toggleMuted}
        ${tooltip(label)}
        aria-label=${this.muted ? 'Unmute agent notification sounds' : 'Mute agent notification sounds'}
        aria-pressed=${this.muted}
      >
        ${this.muted
          ? html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8.5 9a3.5 3.5 0 0 1 7 0c0 4 1.8 5.5 1.8 5.5H6.7S8.5 13 8.5 9z"/><path d="M10 18a2 2 0 0 0 4 0"/><line x1="3" y1="3" x2="21" y2="21"/></svg>`
          : html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6.7 14.5S8.5 13 8.5 9a3.5 3.5 0 0 1 7 0c0 4 1.8 5.5 1.8 5.5H6.7z"/><path d="M10 18a2 2 0 0 0 4 0"/></svg>`}
      </button>
    `;
  }


  private renderModePicker() {
    const modes = getAllModes();
    const current = modes.find((m) => m.id === this.appMode);
    const modeIcons: Record<string, string> = {
      default: '○',
      developer: '⌘',
      professional: '◆',
      kids: '★',
    };
    return html`
      <div class="mode-picker-wrap" style="position: relative;">
        <button
          class="theme-toggle mode-btn"
          @click=${() => { this.modePickerOpen = !this.modePickerOpen; }}
          ${tooltip(`Mode: ${current?.label || 'Standard'}`)}
          aria-label="Switch app mode"
        >
          <span style="font-size: 14px; line-height: 1;">${modeIcons[this.appMode] || '○'}</span>
        </button>
        ${this.modePickerOpen ? html`
          <div class="mode-dropdown">
            ${modes.map((m) => html`
              <button
                class="mode-option ${m.id === this.appMode ? 'active' : ''}"
                @click=${() => this.selectMode(m.id as AppMode)}
              >
                <span class="mode-icon">${modeIcons[m.id]}</span>
                <span class="mode-info">
                  <span class="mode-label">${m.label}</span>
                  <span class="mode-desc">${m.description}</span>
                </span>
              </button>
            `)}
          </div>
        ` : ''}
      </div>
    `;
  }

  private selectMode(mode: AppMode) {
    setAppMode(mode);
    this.appMode = mode;
    this.modePickerOpen = false;
  }

  /** Returns the nav tabs visible for the current app mode. */
  private getVisibleTabs(): View[] {
    switch (this.appMode) {
      case 'developer':
        return ['agents', 'files', 'prompts', 'plan', 'review', 'customize', 'sessions'];
      case 'professional':
        return ['agents', 'files', 'prompts', 'sessions'];
      case 'kids':
        return ['agents', 'files', 'prompts'];
      default: // 'default'
        return ['agents', 'files', 'prompts', 'sessions'];
    }
  }

  private forwardToTerminal(e: CustomEvent) {
    window.dispatchEvent(new CustomEvent('kairos-operation', { detail: e.detail }));
  }

  // Sessions/Dashboard Resume → open the session inline in the Agents tab. The
  // Agents view replays history over ACP when the agent supports loadSession and
  // falls back to a terminal resume when it doesn't. A new object reference each
  // time guarantees the property change fires even for the same session id.
  private handleResumeInAgents(e: CustomEvent<SessionEntry>) {
    this.loadAgents();
    this.view = 'agents';
    this.resumeEntry = { ...e.detail };
  }

  // "Start session" on an agent-capable app → open the Agents tab on its
  // new-session picker, agent preselected and cwd prefilled. A new object
  // reference each time so the property change fires for repeated clicks.
  private handleStartAgentSession(e: CustomEvent<{ agent: string; cwd?: string }>) {
    this.loadAgents();
    this.view = 'agents';
    this.startRequest = { ...e.detail };
  }

  // "Search with <agent>" in History → open the Agents tab, launch a session
  // with the MRU agent, and auto-send a prompt that searches the session
  // transcripts. Fresh object each time so repeated searches always fire.
  private handleSearchWithAgent(e: CustomEvent<{ query: string; sessions: SessionEntry[]; allSessions?: SessionEntry[] }>) {
    this.loadAgents();
    this.view = 'agents';
    this.searchRequest = { ...e.detail };
  }

  private renderView() {
    switch (this.view) {
      case 'files':
        return html`
          <div class="placeholder-view">
            <h2>Files</h2>
            <p>Drop a file to detect its type and extract its contents. Text extraction runs locally. Images are described by a vision model — which may be a cloud provider if no local one is configured; the analyzing model is shown with each result.</p>
            <div class="files-upload"><kairos-file-drop></kairos-file-drop></div>
          </div>`;
      case 'prompts':
        return html`<div class="placeholder-view"><h2>Prompts</h2><p>Manage prompt templates, system instructions, and reusable agent configurations.</p></div>`;
      case 'plan':
        return html`<div class="placeholder-view"><h2>Plan</h2><p>View and edit DAG pipelines, execution plans, and orchestration graphs.</p></div>`;
      case 'review':
        return html`<div class="placeholder-view"><h2>Review</h2><p>Review code changes, document edits, spreadsheet updates, and email drafts suggested by agents.</p></div>`;
      case 'sessions':
        return html`<kairos-sessions @operation=${this.forwardToTerminal} @navigate=${(e: CustomEvent) => this.navigate(e.detail)} @resume-in-agents=${this.handleResumeInAgents} @search-with-agent=${this.handleSearchWithAgent}></kairos-sessions>`;
      case 'customize':
        return html`<kairos-settings-hub kind="customize"></kairos-settings-hub>`;
      case 'settings':
        return html`<kairos-settings-hub kind="settings" @operation=${this.forwardToTerminal} @start-agent-session=${this.handleStartAgentSession}></kairos-settings-hub>`;
      default:
        return '';
    }
  }

  render() {
    this.toggleAttribute('tauri-native-titlebar', HAS_NATIVE_TITLEBAR);
    this.toggleAttribute('tauri-macos-titlebar', IS_TAURI_MACOS);
    this.toggleAttribute('tauri-windows-titlebar', IS_TAURI_WINDOWS);
    return html`
      ${this.renderHeader()}
      ${!this.authLoggedIn ? html`
        <div class="auth-banner" role="alert">
          <span>Your kairos session has expired — agents can't run until you sign in again.</span>
          <button ?disabled=${this.reloggingIn} @click=${this.handleReLogin}>
            ${this.reloggingIn ? 'Signing in…' : 'Log in'}
          </button>
        </div>
      ` : ''}
      <main class=${this.view === 'agents' ? 'full-bleed' : ''}>
        ${this.agentsEverVisited ? html`<kairos-agents .active=${this.view === 'agents'} .resumeEntry=${this.resumeEntry} .startRequest=${this.startRequest} .searchRequest=${this.searchRequest} @open-history=${() => this.navigate('sessions')}></kairos-agents>` : ''}
        ${this.view !== 'agents'
          ? // keyed() forces Lit to recreate this wrapper when the view changes,
            // so the .view-enter entrance animation replays on every nav switch.
            // The Agents view is intentionally kept OUTSIDE this wrapper — it must
            // stay mounted or its live ACP sockets/subprocesses die.
            keyed(this.view, html`<div class="view-enter">${this.renderView()}</div>`)
          : ''}
      </main>
      <kairos-help-drawer .open=${this.helpOpen} .startDoc=${this.helpDoc} @close=${() => { this.helpOpen = false; }}></kairos-help-drawer>
      <kairos-whats-new
        .open=${this.whatsNew !== null}
        .version=${this.whatsNew?.version ?? ''}
        .notes=${this.whatsNew?.notes ?? ''}
        @dismiss=${() => this.dismissWhatsNew()}
      ></kairos-whats-new>
      <kairos-testimonials .open=${this.testimonialsOpen} @close=${() => { this.testimonialsOpen = false; }}></kairos-testimonials>
      <kairos-feedback-dialog
        .open=${this.feedbackOpen}
        .mode=${this.appMode}
        .view=${this.view}
        @close=${() => { this.feedbackOpen = false; }}
      ></kairos-feedback-dialog>
    `;
  }

  private renderWindowsWindowControls() {
    if (!IS_TAURI_WINDOWS) return '';
    const maximizeLabel = this.windowMaximized ? 'Restore window' : 'Maximize window';
    return html`
      <div
        class="windows-window-controls"
        data-tauri-drag-region="false"
        @pointerdown=${(e: Event) => e.stopPropagation()}
        @mousedown=${(e: Event) => e.stopPropagation()}
        @dblclick=${(e: Event) => e.stopPropagation()}
      >
        <button
          class="window-control minimize"
          data-tauri-drag-region="false"
          title="Minimize"
          aria-label="Minimize window"
          @click=${() => void this.controlWindow('minimize')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round"><path d="M6 12h12"/></svg>
        </button>
        <button
          class="window-control maximize"
          data-tauri-drag-region="false"
          title=${maximizeLabel}
          aria-label=${maximizeLabel}
          @click=${() => void this.controlWindow('toggle-maximize')}
        >
          ${this.windowMaximized
            ? html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linejoin="round"><path d="M8 8h10v10H8z"/><path d="M6 16H5V5h11v1"/></svg>`
            : html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linejoin="round"><path d="M7 7h10v10H7z"/></svg>`}
        </button>
        <button
          class="window-control close"
          data-tauri-drag-region="false"
          title="Close"
          aria-label="Close window"
          @click=${() => void this.controlWindow('close')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round"><path d="M7 7l10 10M17 7 7 17"/></svg>
        </button>
      </div>
    `;
  }

  private renderHeader() {
    return html`
      <header data-tauri-drag-region="deep">
        <div class="native-titlebar-drag-strip" data-tauri-drag-region="deep" aria-hidden="true"></div>
        <div class="logo">
          <svg class="logo-mark" viewBox="0 0 58 58" width="28" height="28" aria-hidden="true">
            <!-- Kalimba: 9 tines of varying length forming a symmetric fan -->
            <line class="tine" x1="29" y1="8" x2="29" y2="30"/>
            <line class="tine" x1="24" y1="10" x2="24" y2="30"/>
            <line class="tine" x1="34" y1="10" x2="34" y2="30"/>
            <line class="tine tine-short" x1="19" y1="13" x2="19" y2="30"/>
            <line class="tine tine-short" x1="39" y1="13" x2="39" y2="30"/>
            <line class="tine tine-short" x1="15" y1="16" x2="15" y2="30"/>
            <line class="tine tine-short" x1="43" y1="16" x2="43" y2="30"/>
            <line class="tine tine-short" x1="12" y1="19" x2="12" y2="30"/>
            <line class="tine tine-short" x1="46" y1="19" x2="46" y2="30"/>
            <!-- Bridge (the bar tines are attached to) -->
            <rect class="bridge" x="10" y="29" width="38" height="3" rx="1.5"/>
            <!-- Body — rounded trapezoid shape -->
            <path class="body-frame" d="M10,32 L6,50 Q6,54 10,54 L48,54 Q52,54 52,50 L48,32"/>
            <!-- Sound hole -->
            <circle class="sound-hole" cx="29" cy="44" r="5"/>
          </svg>
          <span class="new-name">Kairos</span>
        </div>
        <nav>
          ${this.getVisibleTabs().map(
            (v) => html`
              <button
                ?active=${this.view === v}
                @click=${() => this.navigate(v)}
                ${tooltip(v === 'agents' && this.appMode !== 'developer' ? 'Chat' : VIEW_LABELS[v])}
                aria-label=${v === 'agents' && this.appMode !== 'developer' ? 'Chat' : VIEW_LABELS[v]}
              >${NAV_ICONS[v]}<span class="nav-label">${v === 'agents' && this.appMode !== 'developer' ? 'Chat' : VIEW_LABELS[v]}</span></button>
            `,
          )}
        </nav>
        <div class="spacer"></div>
        <div class="header-actions">
          ${this.appMode === 'developer' ? html`
            <kairos-presence-pill @open-testimonials=${this.openTestimonials}></kairos-presence-pill>
          ` : nothing}
          ${this.renderMuteToggle()}
          ${this.renderModePicker()}
          <kairos-theme-picker></kairos-theme-picker>
          ${this.appMode === 'developer' ? html`
            <button
              class="why-button"
              @click=${() => { this.helpDoc = 'why-kairos'; this.helpOpen = true; }}
              ${tooltip('Why Kairos — why it was built, and how')}
              aria-label="Why Kairos"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
              <span>Why</span>
            </button>
          ` : nothing}
          <button
            class="theme-toggle"
            @click=${() => { this.helpDoc = null; this.helpOpen = true; }}
            ${tooltip('Help & guide')}
            aria-label="Help & guide"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>
          </button>
          ${this.appMode === 'developer' ? html`
            <div class="testimonial-wrap">
              <button
                class="theme-toggle testimonial-toggle"
                @click=${this.openTestimonials}
                ${tooltip('What people are saying — leave a note')}
                aria-label="Testimonials"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1a5.5 5.5 0 0 0-7.8 7.8l1.1 1L12 21l7.8-7.6 1.1-1a5.5 5.5 0 0 0 0-7.8Z"/></svg>
              </button>
              ${this.showTestimonialHint ? html`
                <div class="testimonial-hint" role="status">
                  <div class="th-message">What do you like most about Kairos?</div>
                  <div class="th-actions">
                    <button class="th-primary" @click=${this.openTestimonials}>Add note</button>
                    <button class="th-dismiss" @click=${this.dismissTestimonialHint} ${tooltip('Dismiss')} aria-label="Dismiss testimonial prompt">
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>
                    </button>
                  </div>
                </div>
              ` : ''}
            </div>
            <button
              class="theme-toggle"
              @click=${this.openWhatsNew}
              ${tooltip("What's new")}
              aria-label="What's new in Kairos"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.7 4.7 0 0 1 12 8"/><path d="M16.5 8a2.5 2.5 0 0 0 0-5A4.7 4.7 0 0 0 12 8"/></svg>
            </button>
          ` : nothing}
          <button
            class="feedback-link"
            @click=${() => { this.feedbackOpen = true; }}
            ${tooltip('Send feedback — builds a copyable report with diagnostics')}
            aria-label="Send feedback"
          >Feedback</button>
          <kairos-update-button></kairos-update-button>
          <kairos-user-menu></kairos-user-menu>
        </div>
        ${this.renderWindowsWindowControls()}
      </header>
    `;
  }

}
