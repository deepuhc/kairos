/**
 * `kairos status` — Show orchestrator status.
 */

import { detectProviders } from "@kairos/providers";

export async function statusCommand(): Promise<void> {
  console.log("");
  console.log("  ✦ Kairos v0.1.0");
  console.log("");

  const providers = await detectProviders();

  console.log("  Providers:");
  if (providers.length === 0) {
    console.log("    (none detected)");
  } else {
    for (const p of providers) {
      const icon = p.isLocal ? "⬡" : "◈";
      console.log(`    ${icon} ${p.name} — available`);
    }
  }

  console.log("");
  console.log("  Active sessions: 0");
  console.log("  Running agents: 0");
  console.log("");
}
