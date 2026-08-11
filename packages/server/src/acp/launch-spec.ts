// Resolves how a stdio ACP agent is launched. This is a config seam, NOT a
// hardcode: the shipped product must invoke Claude Code directly, while local
// testing goes through `devai launch` (which wires devai's auth/proxy env, the
// same path `claude` → `devai launch claude` uses on a dev machine).
//
// Precedence (first match wins):
//   1. KAIROS_ACP_CMD (+ optional KAIROS_ACP_ARGS, space-split) — full override.
//   2. KAIROS_ACP_USE_DEVAI=1 — testing form: `devai launch -- <adapter>`.
//   3. default — the product form: run the adapter directly via npx.
//
// The Claude Code ACP agent is the official adapter `@agentclientprotocol/
// claude-agent-acp` (it speaks ACP JSON-RPC over stdio and wraps the local
// Claude Code). Codex/Gemini/etc. would add their own entries here later.

export interface LaunchSpec {
  command: string;
  args: string[];
  /** Extra env layered onto process.env for the child. */
  env: Record<string, string>;
}

const ADAPTERS: Record<string, { command: string; args: string[] }> = {
  claude: { command: 'npx', args: ['-y', '@agentclientprotocol/claude-agent-acp'] },
};

// The ids of external ACP CLI agents Kairos knows how to launch over stdio.
// The catalog advertises these so the UI picker can offer local CLIs (e.g.
// "claude") alongside in-process providers.
export const EXTERNAL_AGENT_IDS: string[] = Object.keys(ADAPTERS);

export function resolveLaunchSpec(
  agentId: string,
  environment: NodeJS.ProcessEnv = process.env,
): LaunchSpec {
  // 1. Full explicit override.
  const cmd = environment.KAIROS_ACP_CMD?.trim();
  if (cmd) {
    const args = environment.KAIROS_ACP_ARGS?.trim() ? environment.KAIROS_ACP_ARGS.trim().split(/\s+/) : [];
    return { command: cmd, args, env: {} };
  }

  const adapter = ADAPTERS[agentId];
  if (!adapter) {
    throw new Error(`No stdio launch spec for agent "${agentId}" (set KAIROS_ACP_CMD to override)`);
  }

  // 2. Testing form: go through devai so its auth/proxy env is applied.
  if (environment.KAIROS_ACP_USE_DEVAI === '1') {
    return {
      command: 'devai',
      args: ['launch', '--', adapter.command, ...adapter.args],
      env: {},
    };
  }

  // 3. Product form: run the adapter directly.
  return { command: adapter.command, args: [...adapter.args], env: {} };
}
