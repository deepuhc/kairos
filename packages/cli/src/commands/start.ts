/**
 * `kairos start` — Interactive orchestration session.
 */

import { detectProviders } from "@kairos/providers";
import { getProfile } from "@kairos/security";

interface StartOptions {
  provider?: string;
  budget?: string;
  local?: boolean;
  profile?: string;
}

export async function startCommand(options: StartOptions): Promise<void> {
  console.log("");
  console.log("  ✦ Kairos — The Decisive Moment");
  console.log("");

  // Detect available providers
  const providers = await detectProviders();

  if (providers.length === 0) {
    console.log("  No LLM providers detected.");
    console.log("");
    console.log("  To get started, install one of:");
    console.log("    • Ollama (free, local): https://ollama.ai");
    console.log("    • Set ANTHROPIC_API_KEY for Claude");
    console.log("    • Set OPENAI_API_KEY for GPT");
    console.log("");
    process.exit(1);
  }

  // Show connected providers
  console.log("  Connected providers:");
  for (const p of providers) {
    const icon = p.isLocal ? "⬡" : "◈";
    const label = p.isLocal ? "(local, free)" : "(cloud)";
    console.log(`    ${icon} ${p.name} ${label}`);
  }
  console.log("");

  // Show security profile
  const profileName = options.profile ?? "personal";
  const profile = getProfile(profileName);
  if (profile) {
    console.log(`  Security: ${profile.name} profile`);
    console.log(
      `    Cloud: ${profile.defaults.cloudAllowed ? "allowed" : "disabled (local only)"}`
    );
    console.log(`    PII detection: ${profile.defaults.piiDetection ? "on" : "off"}`);
  }

  // Show budget
  if (options.budget) {
    console.log(`  Budget: $${options.budget}`);
  } else if (providers.every((p) => p.isLocal)) {
    console.log("  Budget: unlimited (all local)");
  }

  console.log("");
  console.log("  Ready. Describe what you'd like to do.");
  console.log("");

  // In full implementation, this would start the interactive TUI loop
  // with Ink components for real-time pipeline visualization.
  // For now, just show the welcome screen.
}
