import type { UsageEntry } from './api.js';

export interface UsageSlice {
  key: string;
  label: string;
  count: number;
  percent: number;
}

export interface UsageBreakdown {
  total: number;
  slices: UsageSlice[];
}

export interface UsageInsights {
  activity: UsageBreakdown;
  clients: UsageBreakdown;
  platforms: UsageBreakdown;
  architectures: UsageBreakdown;
  versions: UsageBreakdown;
  tenure: UsageBreakdown;
}

// One person, collapsing every machine they've used. The Usage tab keys on
// username so a user active on several machines is counted once, not once per
// (hostname, username) row.
export interface UserSummary {
  username: string;
  machines: UsageEntry[];
  machineCount: number;
  latest: UsageEntry;
  firstSeen: string;
  lastSeen: string;
}

export function groupByUser(users: UsageEntry[]): UserSummary[] {
  const byUser = new Map<string, UsageEntry[]>();
  for (const u of users) {
    const list = byUser.get(u.username);
    if (list) list.push(u);
    else byUser.set(u.username, [u]);
  }

  return [...byUser.entries()].map(([username, machines]) => {
    const latest = machines.reduce((a, b) =>
      new Date(b.last_seen).getTime() > new Date(a.last_seen).getTime() ? b : a,
    );
    const firstSeen = machines.reduce((min, m) =>
      new Date(m.first_seen).getTime() < new Date(min).getTime() ? m.first_seen : min,
      machines[0].first_seen,
    );
    return {
      username,
      machines,
      machineCount: machines.length,
      latest,
      firstSeen,
      lastSeen: latest.last_seen,
    };
  });
}

const DAY_MS = 24 * 3600_000;
const SLICE_ORDER: Record<string, number> = {
  desktop: 10,
  browser: 20,
  macos: 30,
  windows: 40,
  linux: 50,
  arm64: 60,
  x64: 70,
  x86: 80,
  today: 90,
  week: 100,
  month: 110,
  inactive: 120,
  'new-week': 130,
  'new-month': 140,
  'new-quarter': 150,
  established: 160,
  unknown: 10_000,
};

export function clientKindKey(value: string | null | undefined): string {
  const normalized = value?.trim().toLowerCase();
  return normalized === 'desktop' || normalized === 'browser' ? normalized : 'unknown';
}

export function clientKindLabel(key: string): string {
  return {
    desktop: 'Desktop app',
    browser: 'Browser workflow',
    unknown: 'Unknown',
  }[key] ?? key;
}

export function platformKey(value: string | null | undefined): string {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'macos' || normalized === 'darwin') return 'macos';
  if (normalized === 'windows' || normalized === 'win32') return 'windows';
  if (normalized === 'linux') return 'linux';
  return normalized || 'unknown';
}

export function platformLabel(key: string | null | undefined): string {
  return {
    macos: 'macOS',
    darwin: 'macOS',
    windows: 'Windows',
    win32: 'Windows',
    linux: 'Linux',
    unknown: 'Unknown',
  }[key?.toLowerCase() ?? ''] ?? (key || 'Unknown');
}

export function architectureKey(value: string | null | undefined): string {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'aarch64' || normalized === 'arm64') return 'arm64';
  if (normalized === 'x86_64' || normalized === 'amd64') return 'x64';
  if (normalized === 'x86' || normalized === 'i386' || normalized === 'i686') return 'x86';
  return normalized || 'unknown';
}

export function architectureLabel(key: string | null | undefined): string {
  return {
    aarch64: 'arm64',
    arm64: 'arm64',
    x86_64: 'x64',
    amd64: 'x64',
    x64: 'x64',
    x86: 'x86',
    i386: 'x86',
    i686: 'x86',
    unknown: 'Unknown',
  }[key?.toLowerCase() ?? ''] ?? (key || 'Unknown');
}

export function buildUsageInsights(users: UsageEntry[], now = Date.now()): UsageInsights {
  const desktopUsers = users.filter((u) => clientKindKey(u.client_kind) === 'desktop');

  return {
    activity: breakdownFromKeys(users.map((u) => activityKey(u.last_seen, now)), activityLabel),
    clients: breakdownFromKeys(users.map((u) => clientKindKey(u.client_kind)), clientKindLabel),
    platforms: breakdownFromKeys(users.map((u) => platformKey(u.client_os)), platformLabel),
    architectures: breakdownFromKeys(users.map((u) => architectureKey(u.client_arch)), architectureLabel),
    versions: breakdownFromKeys(
      desktopUsers.map((u) => normalizeVersion(u.kairos_version)),
      (key) => key === 'unknown' ? 'Unknown version' : `v${key}`,
      5,
    ),
    tenure: breakdownFromKeys(users.map((u) => tenureKey(u.first_seen, now)), tenureLabel),
  };
}

function breakdownFromKeys(
  keys: string[],
  labelFor: (key: string) => string,
  maxSlices = Number.POSITIVE_INFINITY,
): UsageBreakdown {
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);

  const total = keys.length;
  const sorted = [...counts.entries()].sort((a, b) => {
    const orderDelta = (SLICE_ORDER[a[0]] ?? 5_000) - (SLICE_ORDER[b[0]] ?? 5_000);
    if (orderDelta !== 0) return orderDelta;
    return b[1] - a[1] || labelFor(a[0]).localeCompare(labelFor(b[0]));
  });
  const visible = sorted.slice(0, maxSlices);
  const hidden = sorted.slice(maxSlices);
  if (hidden.length) {
    visible.push(['other', hidden.reduce((sum, [, count]) => sum + count, 0)]);
  }

  return {
    total,
    slices: visible.map(([key, count]) => ({
      key,
      label: key === 'other' ? 'Other' : labelFor(key),
      count,
      percent: total > 0 ? Math.round((count / total) * 100) : 0,
    })),
  };
}

function normalizeVersion(value: string | null | undefined): string {
  return value?.trim() || 'unknown';
}

function activityKey(lastSeen: string, now: number): string {
  const age = Math.max(now - new Date(lastSeen).getTime(), 0);
  if (age < DAY_MS) return 'today';
  if (age < 7 * DAY_MS) return 'week';
  if (age < 30 * DAY_MS) return 'month';
  return 'inactive';
}

function activityLabel(key: string): string {
  return {
    today: 'Active today',
    week: '1-7 days',
    month: '8-30 days',
    inactive: '30+ days',
  }[key] ?? key;
}

function tenureKey(firstSeen: string, now: number): string {
  const age = Math.max(now - new Date(firstSeen).getTime(), 0);
  if (age < 7 * DAY_MS) return 'new-week';
  if (age < 30 * DAY_MS) return 'new-month';
  if (age < 90 * DAY_MS) return 'new-quarter';
  return 'established';
}

function tenureLabel(key: string): string {
  return {
    'new-week': 'New this week',
    'new-month': 'New this month',
    'new-quarter': 'New this quarter',
    established: 'Established',
  }[key] ?? key;
}
