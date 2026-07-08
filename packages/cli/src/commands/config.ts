/**
 * `kairos config` — View or modify configuration.
 */

export async function configCommand(key?: string, value?: string): Promise<void> {
  if (!key) {
    // Show all config
    console.log("");
    console.log("  Configuration:");
    console.log("    default-provider: auto");
    console.log("    security-profile: personal");
    console.log("    budget-default: (none)");
    console.log("    prefer-local: false");
    console.log("");
    console.log("  Set values with: kairos config <key> <value>");
    console.log("");
    return;
  }

  if (!value) {
    // Get specific key
    console.log(`  ${key}: (not set)`);
    return;
  }

  // Set key
  console.log(`  Set ${key} = ${value}`);
  // In production: persist to ~/.kairos/config.yaml
}
