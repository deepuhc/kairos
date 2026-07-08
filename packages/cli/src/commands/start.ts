/**
 * `kairos start` — Launch the interactive dashboard.
 *
 * This is the main entry point for all users (developers and non-developers).
 * Just run `kairos start` and type what you want.
 */

interface StartOptions {
  provider?: string;
  budget?: string;
  local?: boolean;
  profile?: string;
}

export async function startCommand(options: StartOptions): Promise<void> {
  // Dynamic import to avoid loading Ink/React until needed
  const { launchDashboard } = await import("../tui/App.js");
  await launchDashboard(process.cwd());
}
