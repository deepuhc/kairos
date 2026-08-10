import type { DownloadEvent, Update } from '@tauri-apps/plugin-updater';
import { KAIROS_VERSION } from './app-version.js';

export interface DesktopUpdateStatus {
  available: boolean;
  currentVersion?: string;
  version?: string;
  date?: string;
  body?: string;
  error?: string;
  unsupported?: boolean;
}

export interface DesktopUpdateInstallResult {
  restartRequired: boolean;
  message?: string;
}

let pendingUpdate: Update | null = null;

export const PENDING_UPDATE_NOTES_KEY = 'kairos.pendingUpdateNotes';

export interface PendingUpdateNotes {
  version: string;
  notes: string;
}

// Persist the release notes for the update we're about to install so the next
// launch (now running the new version) can show a "What's new" panel. Written
// BEFORE downloadAndInstall because the Windows installer path exits the
// process from Rust and never returns to JS.
export function stashPendingUpdateNotes(version: string | undefined, notes: string | null | undefined): void {
  if (!version || !notes) return;
  try {
    const payload: PendingUpdateNotes = { version, notes };
    localStorage.setItem(PENDING_UPDATE_NOTES_KEY, JSON.stringify(payload));
  } catch {
    /* localStorage unavailable — skip; the panel just won't show. */
  }
}

export async function checkDesktopUpdate(): Promise<DesktopUpdateStatus> {
  let currentVersion = KAIROS_VERSION;
  try {
    await waitForTauriInternals();
    currentVersion = await getRuntimeKairosVersion();
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check({ timeout: 5000 });
    pendingUpdate = update;
    if (!update) return { available: false, currentVersion };
    return {
      available: true,
      currentVersion: update.currentVersion ?? currentVersion,
      version: update.version,
      date: update.date,
      body: update.body,
    };
  } catch (err: any) {
    pendingUpdate = null;
    const error = err?.message ?? String(err);
    return {
      available: false,
      currentVersion,
      unsupported: true,
      error: isDesktopUpdateFeedUnavailableError(error) ? undefined : error,
    };
  }
}

export async function installDesktopUpdate(onEvent?: (event: DownloadEvent) => void): Promise<DesktopUpdateInstallResult> {
  await waitForTauriInternals();
  // Re-check at click time so a background check cannot leave us with a stale,
  // versioned artifact URL after the release page has been redeployed.
  const update = await getFreshUpdate();
  if (!update) throw new Error('No Kairos desktop update is available.');
  const relaunchFromJs = await shouldRelaunchFromJs();
  stashPendingUpdateNotes(update.version, update.body);
  await update.downloadAndInstall(onEvent);

  // The Tauri updater's Windows installer path launches NSIS/MSI with restart
  // flags and exits the current process from Rust. If this call ever returns on
  // Windows, do not immediately relaunch the old executable from JS.
  if (!relaunchFromJs) {
    return {
      restartRequired: true,
      message: 'Update installed. Close and reopen Kairos to finish.',
    };
  }

  const { relaunch } = await import('@tauri-apps/plugin-process');
  await relaunch();
  return { restartRequired: false };
}

async function getFreshUpdate(): Promise<Update | null> {
  await waitForTauriInternals();
  const { check } = await import('@tauri-apps/plugin-updater');
  pendingUpdate = await check({ timeout: 5000 });
  return pendingUpdate;
}

async function waitForTauriInternals(): Promise<void> {
  if ((window as any).__TAURI_INTERNALS__) return;

  const deadline = Date.now() + 2000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    if ((window as any).__TAURI_INTERNALS__) return;
  }

  throw new Error('Tauri IPC is not available in this window.');
}

export function isDesktopUpdateFeedUnavailableError(message: string): boolean {
  const normalized = message.toLowerCase();
  return normalized.includes('could not fetch a valid release json from the remote')
    || normalized.includes('expected value at line 1 column 1')
    || normalized.includes('error decoding response body');
}

export function isTauriIpcUnavailableError(message: string): boolean {
  return message.toLowerCase().includes('tauri ipc is not available');
}

export function isWindowsInstallerBundleType(bundleType: string | null | undefined): boolean {
  return bundleType === 'nsis' || bundleType === 'msi';
}

export async function getRuntimeKairosVersion(): Promise<string> {
  try {
    const { getVersion } = await import('@tauri-apps/api/app');
    const version = await getVersion();
    return version || KAIROS_VERSION;
  } catch {
    return KAIROS_VERSION;
  }
}

async function shouldRelaunchFromJs(): Promise<boolean> {
  try {
    const { getBundleType } = await import('@tauri-apps/api/app');
    return !isWindowsInstallerBundleType(await getBundleType());
  } catch {
    return true;
  }
}
