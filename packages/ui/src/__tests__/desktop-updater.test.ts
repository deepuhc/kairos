import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkDesktopUpdate,
  installDesktopUpdate,
  isDesktopUpdateFeedUnavailableError,
  isTauriIpcUnavailableError,
  isWindowsInstallerBundleType,
  PENDING_UPDATE_NOTES_KEY,
} from '../services/desktop-updater.js';
import {
  getKairosUpdateNotice,
  KairosUpdateMonitor,
  UPDATE_CHECK_INTERVAL_MS,
  type KairosUpdateState,
} from '../services/update-monitor.js';

const tauriMocks = vi.hoisted(() => ({
  check: vi.fn(),
  getVersion: vi.fn(),
  getBundleType: vi.fn(),
  relaunch: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: tauriMocks.check,
}));

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: tauriMocks.getVersion,
  getBundleType: tauriMocks.getBundleType,
}));

vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: tauriMocks.relaunch,
}));

function createLocalStorageStub() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  };
}

beforeEach(() => {
  tauriMocks.check.mockReset();
  tauriMocks.getVersion.mockReset().mockResolvedValue('0.1.0');
  tauriMocks.getBundleType.mockReset().mockResolvedValue('nsis');
  tauriMocks.relaunch.mockReset();
  (globalThis as any).window = { __TAURI_INTERNALS__: {} };
  (globalThis as any).localStorage = createLocalStorageStub();
});

describe('desktop updater errors', () => {
  it('recognizes protected or non-JSON update feeds as unavailable', () => {
    expect(
      isDesktopUpdateFeedUnavailableError('Could not fetch a valid release JSON from the remote'),
    ).toBe(true);
    expect(isDesktopUpdateFeedUnavailableError('error decoding response body')).toBe(true);
    expect(isDesktopUpdateFeedUnavailableError('expected value at line 1 column 1')).toBe(true);
  });

  it('leaves unrelated updater errors visible', () => {
    expect(
      isDesktopUpdateFeedUnavailableError('Tauri IPC is not available in this window.'),
    ).toBe(false);
  });
});

describe('tauri ipc errors', () => {
  it('recognizes startup IPC readiness failures as transient', () => {
    expect(isTauriIpcUnavailableError('Tauri IPC is not available in this window.')).toBe(true);
  });

  it('does not classify updater feed failures as IPC readiness failures', () => {
    expect(isTauriIpcUnavailableError('Could not fetch a valid release JSON from the remote')).toBe(false);
  });
});

describe('desktop updater install platform handling', () => {
  it('treats Windows installer bundle types as installer-owned restart flows', () => {
    expect(isWindowsInstallerBundleType('nsis')).toBe(true);
    expect(isWindowsInstallerBundleType('msi')).toBe(true);
    expect(isWindowsInstallerBundleType('app')).toBe(false);
    expect(isWindowsInstallerBundleType('appimage')).toBe(false);
    expect(isWindowsInstallerBundleType(null)).toBe(false);
  });

  it('refreshes the update resource before installing instead of using a stale background check result', async () => {
    const staleUpdate = {
      currentVersion: '0.1.0',
      version: '0.1.1',
      downloadAndInstall: vi.fn(),
    };
    const freshUpdate = {
      currentVersion: '0.1.0',
      version: '0.1.2',
      downloadAndInstall: vi.fn(),
    };

    tauriMocks.check.mockResolvedValueOnce(staleUpdate);
    await checkDesktopUpdate();

    tauriMocks.check.mockResolvedValueOnce(freshUpdate);
    const result = await installDesktopUpdate();

    expect(result.restartRequired).toBe(true);
    expect(staleUpdate.downloadAndInstall).not.toHaveBeenCalled();
    expect(freshUpdate.downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(tauriMocks.check).toHaveBeenCalledTimes(2);
  });

  it('stashes the pending release notes before installing, even on the Windows non-relaunch path', async () => {
    let notesAtInstallTime: string | null = null;
    const update = {
      currentVersion: '0.1.0',
      version: '0.1.2',
      body: "## What's Changed in v0.1.2\n\n### Features\n- shiny",
      downloadAndInstall: vi.fn(async () => {
        // The notes must already be persisted by the time install runs, because
        // the Windows installer exits the process from Rust and never returns.
        notesAtInstallTime = localStorage.getItem(PENDING_UPDATE_NOTES_KEY);
      }),
    };
    tauriMocks.getBundleType.mockResolvedValue('nsis');
    tauriMocks.check.mockResolvedValueOnce(update);

    const result = await installDesktopUpdate();

    expect(result.restartRequired).toBe(true);
    expect(tauriMocks.relaunch).not.toHaveBeenCalled();
    expect(notesAtInstallTime).not.toBeNull();
    expect(JSON.parse(notesAtInstallTime!)).toEqual({
      version: '0.1.2',
      notes: "## What's Changed in v0.1.2\n\n### Features\n- shiny",
    });
  });
});

describe('kairos update monitor', () => {
  const baseState: KairosUpdateState = {
    uiUpdate: null,
    desktopUpdate: null,
    checking: false,
    lastCheckedAt: null,
  };

  it('checks for updates every two hours', () => {
    expect(UPDATE_CHECK_INTERVAL_MS).toBe(2 * 60 * 60 * 1000);
  });

  it('starts a two-hour polling interval when subscribed', () => {
    let intervalMs: number | null = null;
    let cleared = false;
    const monitor = new KairosUpdateMonitor({
      getUiUpdateStatus: async () => ({ behind: 0 }),
      checkDesktopUpdate: async () => ({ available: false }),
      now: () => 0,
      setInterval: (_handler, timeout) => {
        intervalMs = timeout;
        return 1 as any;
      },
      clearInterval: () => { cleared = true; },
      setTimeout: () => 2 as any,
      clearTimeout: () => {},
      addVisibilityListener: () => {},
      removeVisibilityListener: () => {},
      isVisible: () => true,
    });

    const unsubscribe = monitor.subscribe(() => {});

    expect(intervalMs).toBe(UPDATE_CHECK_INTERVAL_MS);
    unsubscribe();
    expect(cleared).toBe(true);
  });

  it('keeps stale refreshes throttled inside the polling window', async () => {
    let checks = 0;
    let now = 1000;
    const monitor = new KairosUpdateMonitor({
      getUiUpdateStatus: async () => {
        checks++;
        return { behind: 0 };
      },
      checkDesktopUpdate: async () => ({ available: false }),
      now: () => now,
      setInterval: () => 1 as any,
      clearInterval: () => {},
      setTimeout: () => 2 as any,
      clearTimeout: () => {},
      addVisibilityListener: () => {},
      removeVisibilityListener: () => {},
      isVisible: () => true,
    });

    await monitor.refreshNow();
    now += UPDATE_CHECK_INTERVAL_MS - 1;
    await monitor.refreshIfStale();

    expect(checks).toBe(1);
  });

  it('forces a refresh even inside the polling window', async () => {
    let checks = 0;
    let now = 1000;
    const monitor = new KairosUpdateMonitor({
      getUiUpdateStatus: async () => {
        checks++;
        return { behind: 0 };
      },
      checkDesktopUpdate: async () => ({ available: false }),
      now: () => now,
      setInterval: () => 1 as any,
      clearInterval: () => {},
      setTimeout: () => 2 as any,
      clearTimeout: () => {},
      addVisibilityListener: () => {},
      removeVisibilityListener: () => {},
      isVisible: () => true,
    });

    await monitor.refreshNow();
    now += UPDATE_CHECK_INTERVAL_MS - 1;
    await monitor.refreshNow();

    expect(checks).toBe(2);
  });

  it('prefers desktop update notices over source checkout notices', () => {
    const notice = getKairosUpdateNotice({
      ...baseState,
      uiUpdate: { behind: 4, current: 'abc', latest: 'def' },
      desktopUpdate: { available: true, version: '1.2.3' },
    });

    expect(notice).toMatchObject({
      kind: 'desktop',
      label: 'Update Kairos',
      detail: 'v1.2.3',
    });
  });

  it('shows source checkout update notices when no desktop update is available', () => {
    const notice = getKairosUpdateNotice({
      ...baseState,
      uiUpdate: { behind: 1, current: 'abc', latest: 'def' },
      desktopUpdate: { available: false },
    });

    expect(notice).toMatchObject({
      kind: 'source',
      detail: '1 commit behind',
    });
  });
});
