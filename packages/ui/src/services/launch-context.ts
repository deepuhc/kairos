/** The role fields a preamble is composed from — a structural subset of CustomRoleInput. */
export interface LaunchPreambleRole {
  label: string;
  instructions: string;
  outputFormat?: string;
}

// Stub: global rules and role personas are injected into the first prompt turn
// by the caller. `role` is the selected role object (not its id) — see
// agents-view.ts, which passes the resolved CustomRoleInput.
export function composeLaunchPreamble(_opts: {
  globalRules?: string;
  role?: LaunchPreambleRole;
}): string {
  return '';
}

export function formatTrailingLaunchPreamble(_preamble: string): string {
  return '';
}
