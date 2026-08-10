import { describe, expect, it } from 'vitest';
import type { UsageEntry } from '../services/api.js';
import {
  architectureKey,
  buildUsageInsights,
  clientKindKey,
  groupByUser,
  platformKey,
} from '../services/usage-insights.js';

const NOW = Date.UTC(2026, 6, 28, 12, 0, 0);

function entry(partial: Partial<UsageEntry>): UsageEntry {
  return {
    hostname: 'host',
    username: 'user',
    client_kind: 'desktop',
    kairos_version: '0.1.0',
    client_os: 'macos',
    client_arch: 'aarch64',
    first_seen: new Date(NOW - 90 * 24 * 3600_000).toISOString(),
    last_seen: new Date(NOW - 60_000).toISOString(),
    ...partial,
  };
}

describe('usage insights', () => {
  it('normalizes common client, platform, and architecture values', () => {
    expect(clientKindKey(' Desktop ')).toBe('desktop');
    expect(clientKindKey('native')).toBe('unknown');
    expect(platformKey('darwin')).toBe('macos');
    expect(platformKey('win32')).toBe('windows');
    expect(architectureKey('x86_64')).toBe('x64');
    expect(architectureKey('amd64')).toBe('x64');
    expect(architectureKey('i686')).toBe('x86');
  });

  it('builds dashboard breakdowns from the current usage payload', () => {
    const users = [
      entry({
        username: 'mac-user',
        hostname: 'mac',
        client_os: 'darwin',
        client_arch: 'arm64',
        kairos_version: '0.2.0',
        first_seen: new Date(NOW - 2 * 24 * 3600_000).toISOString(),
      }),
      entry({
        username: 'win-user',
        hostname: 'win',
        client_os: 'windows',
        client_arch: 'amd64',
        kairos_version: '0.2.0',
        last_seen: new Date(NOW - 3 * 24 * 3600_000).toISOString(),
        first_seen: new Date(NOW - 20 * 24 * 3600_000).toISOString(),
      }),
      entry({
        username: 'browser-user',
        hostname: 'browser',
        client_kind: 'browser',
        kairos_version: null,
        client_os: 'linux',
        client_arch: 'x86_64',
        last_seen: new Date(NOW - 40 * 24 * 3600_000).toISOString(),
      }),
    ];

    const insights = buildUsageInsights(users, NOW);

    expect(insights.platforms.slices.map((s) => [s.key, s.count])).toEqual([
      ['macos', 1],
      ['windows', 1],
      ['linux', 1],
    ]);
    expect(insights.clients.slices.map((s) => [s.key, s.count])).toEqual([
      ['desktop', 2],
      ['browser', 1],
    ]);
    expect(insights.versions).toMatchObject({
      total: 2,
      slices: [{ key: '0.2.0', label: 'v0.2.0', count: 2, percent: 100 }],
    });
    expect(insights.activity.slices.map((s) => [s.key, s.count])).toEqual([
      ['today', 1],
      ['week', 1],
      ['inactive', 1],
    ]);
    expect(insights.tenure.slices.map((s) => [s.key, s.count])).toEqual([
      ['new-week', 1],
      ['new-month', 1],
      ['established', 1],
    ]);
  });
});

describe('groupByUser', () => {
  it('collapses multiple machines for the same user into one summary', () => {
    const users = [
      entry({
        username: 'alice',
        hostname: 'laptop',
        first_seen: new Date(NOW - 90 * 24 * 3600_000).toISOString(),
        last_seen: new Date(NOW - 5 * 24 * 3600_000).toISOString(),
      }),
      entry({
        username: 'alice',
        hostname: 'desktop',
        client_os: 'windows',
        first_seen: new Date(NOW - 30 * 24 * 3600_000).toISOString(),
        last_seen: new Date(NOW - 60_000).toISOString(),
      }),
    ];

    const summaries = groupByUser(users);
    expect(summaries).toHaveLength(1);
    const [alice] = summaries;
    expect(alice.username).toBe('alice');
    expect(alice.machineCount).toBe(2);
    // latest = most recent last_seen (the desktop), lastSeen mirrors it
    expect(alice.latest.hostname).toBe('desktop');
    expect(alice.lastSeen).toBe(alice.latest.last_seen);
    // firstSeen = earliest across machines (the laptop)
    expect(alice.firstSeen).toBe(new Date(NOW - 90 * 24 * 3600_000).toISOString());
  });

  it('counts distinct users, not rows', () => {
    const users = [
      entry({ username: 'alice', hostname: 'a1' }),
      entry({ username: 'alice', hostname: 'a2' }),
      entry({ username: 'bob', hostname: 'b1' }),
    ];
    expect(groupByUser(users)).toHaveLength(2);
  });

  it('keeps single-machine users with a machine count of one', () => {
    const summaries = groupByUser([entry({ username: 'solo', hostname: 'only' })]);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].machineCount).toBe(1);
    expect(summaries[0].latest.hostname).toBe('only');
  });
});
