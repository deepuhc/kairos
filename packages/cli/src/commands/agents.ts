/**
 * `kairos agents` — Manage running agents.
 */

export const agentsCommand = {
  async list(): Promise<void> {
    console.log("");
    console.log("  No active agents.");
    console.log("  Run `kairos start` or `kairos run <recipe>` to spawn agents.");
    console.log("");
  },

  async kill(id: string): Promise<void> {
    console.log(`  Killing agent: ${id}`);
    // In production: connect to running orchestrator, kill the agent
    console.log("  (No active session to connect to)");
  },
};
