import { describe, it, expect } from 'vitest';
import { resolveLaunchSpec } from '../launch-spec.js';

describe('resolveLaunchSpec', () => {
  it('defaults to running the Claude adapter directly (product form)', () => {
    const spec = resolveLaunchSpec('claude', {});
    expect(spec.command).toBe('npx');
    expect(spec.args).toEqual(['-y', '@agentclientprotocol/claude-agent-acp']);
  });

  it('wraps in `devai launch --` when KAIROS_ACP_USE_DEVAI=1 (testing form)', () => {
    const spec = resolveLaunchSpec('claude', { KAIROS_ACP_USE_DEVAI: '1' });
    expect(spec.command).toBe('devai');
    expect(spec.args).toEqual(['launch', '--', 'npx', '-y', '@agentclientprotocol/claude-agent-acp']);
  });

  it('honors a full KAIROS_ACP_CMD override with space-split args', () => {
    const spec = resolveLaunchSpec('claude', { KAIROS_ACP_CMD: 'claude', KAIROS_ACP_ARGS: '--acp --verbose' });
    expect(spec).toMatchObject({ command: 'claude', args: ['--acp', '--verbose'] });
  });

  it('KAIROS_ACP_CMD takes precedence over the devai flag', () => {
    const spec = resolveLaunchSpec('claude', { KAIROS_ACP_CMD: 'claude', KAIROS_ACP_USE_DEVAI: '1' });
    expect(spec.command).toBe('claude');
  });

  it('override with no args yields an empty args list', () => {
    expect(resolveLaunchSpec('claude', { KAIROS_ACP_CMD: 'my-acp' }).args).toEqual([]);
  });

  it('throws for an unknown agent id with no override', () => {
    expect(() => resolveLaunchSpec('mystery', {})).toThrow(/mystery/);
  });
});
