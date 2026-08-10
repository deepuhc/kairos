import { getUiUpdateStatus, type UiUpdateStatus } from './api.js';
import {
  checkDesktopUpdate,
  isTauriIpcUnavailableError,
  type DesktopUpdateStatus,
} from './desktop-updater.js';

export const UPDATE_CHECK_INTERVAL_MS = 2 * 60 * 60 * 1000;

const DESKTOP_UPDATE_RETRY_DELAYS_MS = [500, 1000, 2000, 5000, 10000];

export interface KairosUpdateState {
  uiUpdate: UiUpdateStatus | null;
  desktopUpdate: DesktopUpdateStatus | null;
  checking: boolean;
  lastCheckedAt: number | null;
}

export interface KairosUpdateNotice {
  kind: 'desktop' | 'source';
  label: string;
  detail: string;
  ariaLabel: string;
}

type UpdateListener = (state: KairosUpdateState) => void;
type Timer = ReturnType<typeof setTimeout>;

interface UpdateMonitorDeps {
  getUiUpdateStatus: () => Promise<UiUpdateStatus>;
  checkDesktopUpdate: () => Promise<DesktopUpdateStatus>;
  now: () => number;
  setInterval: (handler: () => void, timeout: number) => Timer;
  clearInterval: (timer: Timer) => void;
  setTimeout: (handler: () => void, timeout: number) => Timer;
  clearTimeout: (timer: Timer) => void;
  addVisibilityListener: (listener: () => void) => void;
  removeVisibilityListener: (listener: () => void) => void;
  isVisible: () => boolean;
}

const defaultDeps: UpdateMonitorDeps = {
  getUiUpdateStatus,
  checkDesktopUpdate,
  now: () => Date.now(),
  setInterval: (handler, timeout) => setInterval(handler, timeout),
  clearInterval: (timer) => clearInterval(timer),
  setTimeout: (handler, timeout) => setTimeout(handler, timeout),
  clearTimeout: (timer) => clearTimeout(timer),
  addVisibilityListener: (listener) => {
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', listener);
  },
  removeVisibilityListener: (listener) => {
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', listener);
  },
  isVisible: () => typeof document === 'undefined' || document.visibilityState === 'visible',
};

export function getKairosUpdateNotice(state: KairosUpdateState): KairosUpdateNotice | null {
  if (state.desktopUpdate?.available) {
    const detail = state.desktopUpdate.version ? `v${state.desktopUpdate.version}` : 'available';
    return {
      kind: 'desktop',
      label: 'Update Kairos',
      detail,
      ariaLabel: `Kairos desktop update ${detail} available`,
    };
  }

  if (state.uiUpdate && state.uiUpdate.behind > 0) {
    const commits = `${state.uiUpdate.behind} commit${state.uiUpdate.behind === 1 ? '' : 's'}`;
    return {
      kind: 'source',
      label: 'Update Kairos',
      detail: `${commits} behind`,
      ariaLabel: `Kairos source update available, ${commits} behind`,
    };
  }

  return null;
}

export class KairosUpdateMonitor {
  private state: KairosUpdateState = {
    uiUpdate: null,
    desktopUpdate: null,
    checking: false,
    lastCheckedAt: null,
  };
  private listeners = new Set<UpdateListener>();
  private pollTimer: Timer | null = null;
  private retryTimer: Timer | null = null;
  private desktopUpdateRetryIndex = 0;
  private inFlight: Promise<void> | null = null;

  constructor(private readonly deps: UpdateMonitorDeps = defaultDeps) {}

  get current(): KairosUpdateState {
    return this.state;
  }

  subscribe(listener: UpdateListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    this.start();

    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stop();
    };
  }

  refreshNow(): Promise<void> {
    this.clearRetryTimer();
    this.desktopUpdateRetryIndex = 0;
    return this.runExclusive(() => this.checkAllUpdates());
  }

  refreshIfStale(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    if (
      this.state.lastCheckedAt !== null
      && this.deps.now() - this.state.lastCheckedAt < UPDATE_CHECK_INTERVAL_MS
    ) {
      return Promise.resolve();
    }
    return this.refreshNow();
  }

  private start() {
    if (this.pollTimer) return;

    this.deps.addVisibilityListener(this.onVisibility);
    this.pollTimer = this.deps.setInterval(() => {
      void this.refreshNow();
    }, UPDATE_CHECK_INTERVAL_MS);
    void this.refreshNow();
  }

  private stop() {
    if (this.pollTimer) {
      this.deps.clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.clearRetryTimer();
    this.deps.removeVisibilityListener(this.onVisibility);
  }

  private onVisibility = () => {
    if (this.deps.isVisible()) void this.refreshIfStale();
  };

  private runExclusive(task: () => Promise<void>): Promise<void> {
    if (this.inFlight) return this.inFlight;

    this.inFlight = task().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async checkAllUpdates() {
    this.setState({ checking: true });

    const [uiUpdateRes, desktopUpdateRes] = await Promise.allSettled([
      this.deps.getUiUpdateStatus(),
      this.deps.checkDesktopUpdate(),
    ]);

    const patch: Partial<KairosUpdateState> = {
      checking: false,
      lastCheckedAt: this.deps.now(),
    };

    if (uiUpdateRes.status === 'fulfilled') {
      patch.uiUpdate = uiUpdateRes.value.behind > 0 ? uiUpdateRes.value : null;
    }

    if (desktopUpdateRes.status === 'fulfilled') {
      this.applyDesktopUpdateResult(desktopUpdateRes.value, patch);
    } else {
      patch.desktopUpdate = {
        available: false,
        error: desktopUpdateRes.reason?.message ?? String(desktopUpdateRes.reason),
        unsupported: true,
      };
    }

    this.setState(patch);
  }

  private async checkDesktopUpdateOnly() {
    this.setState({ checking: true });

    let desktopUpdate: DesktopUpdateStatus;
    try {
      desktopUpdate = await this.deps.checkDesktopUpdate();
    } catch (err: any) {
      desktopUpdate = {
        available: false,
        error: err?.message ?? String(err),
        unsupported: true,
      };
    }

    const patch: Partial<KairosUpdateState> = {
      checking: false,
      lastCheckedAt: this.deps.now(),
    };
    this.applyDesktopUpdateResult(desktopUpdate, patch);
    this.setState(patch);
  }

  private applyDesktopUpdateResult(
    desktopUpdate: DesktopUpdateStatus,
    patch: Partial<KairosUpdateState>,
  ) {
    if (this.shouldRetryDesktopUpdate(desktopUpdate) && this.scheduleDesktopUpdateRetry()) {
      return;
    }

    this.desktopUpdateRetryIndex = 0;
    patch.desktopUpdate = desktopUpdate;
  }

  private shouldRetryDesktopUpdate(desktopUpdate: DesktopUpdateStatus): boolean {
    return desktopUpdate.unsupported === true
      && typeof desktopUpdate.error === 'string'
      && isTauriIpcUnavailableError(desktopUpdate.error);
  }

  private scheduleDesktopUpdateRetry(): boolean {
    if (this.desktopUpdateRetryIndex >= DESKTOP_UPDATE_RETRY_DELAYS_MS.length) return false;

    const delay = DESKTOP_UPDATE_RETRY_DELAYS_MS[this.desktopUpdateRetryIndex];
    this.desktopUpdateRetryIndex++;
    this.retryTimer = this.deps.setTimeout(() => {
      this.retryTimer = null;
      void this.runExclusive(() => this.checkDesktopUpdateOnly());
    }, delay);
    return true;
  }

  private clearRetryTimer() {
    if (!this.retryTimer) return;
    this.deps.clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private setState(patch: Partial<KairosUpdateState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener(this.state));
  }
}

export const updateMonitor = new KairosUpdateMonitor();
