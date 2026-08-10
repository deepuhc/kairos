import { describe, expect, it } from 'vitest';
import { adviseCache } from '../services/cache-advisor.js';
import type { CacheUsage } from '../services/acp-types.js';

function cache(partial: Partial<CacheUsage>): CacheUsage {
  const c: CacheUsage = {
    cachedRead: 0,
    cachedWrite: 0,
    input: 0,
    output: 0,
    ...partial,
  };
  const billable = c.cachedRead + c.input;
  if (billable > 0) c.hitRate = c.cachedRead / billable;
  return c;
}

describe('adviseCache', () => {
  it('returns null with no cache data', () => {
    expect(adviseCache(null)).toBeNull();
    expect(adviseCache(undefined)).toBeNull();
  });

  it('returns null before there is enough billable input', () => {
    expect(adviseCache(cache({ cachedRead: 1000, input: 4000, cachedWrite: 20000 }))).toBeNull();
  });

  it('grades a healthy hit rate as good with no tips', () => {
    const advice = adviseCache(cache({ cachedRead: 90000, input: 10000 }));
    expect(advice).not.toBeNull();
    expect(advice!.grade).toBe('good');
    expect(advice!.hitRate).toBeCloseTo(0.9, 5);
    expect(advice!.tips).toHaveLength(0);
    expect(advice!.summary).toMatch(/healthy/i);
  });

  it('grades a low hit rate as poor and always offers a tip', () => {
    const advice = adviseCache(cache({ cachedRead: 10000, input: 90000 }));
    expect(advice!.grade).toBe('poor');
    expect(advice!.tips.length).toBeGreaterThan(0);
  });

  it('flags cache TTL expiry when turns are spaced far apart', () => {
    const advice = adviseCache(cache({ cachedRead: 20000, input: 80000 }), { medianTurnGapSec: 600 });
    expect(advice!.tips.some((t) => t.key === 'ttl-expiry')).toBe(true);
  });

  it('does not flag TTL expiry when caching is already healthy', () => {
    const advice = adviseCache(cache({ cachedRead: 95000, input: 5000 }), { medianTurnGapSec: 600 });
    expect(advice!.tips.some((t) => t.key === 'ttl-expiry')).toBe(false);
  });

  it('flags compaction and model-switch regardless of grade', () => {
    const advice = adviseCache(cache({ cachedRead: 40000, input: 60000 }), {
      compacted: true,
      modelSwitched: true,
    });
    const keys = advice!.tips.map((t) => t.key);
    expect(keys).toContain('compaction');
    expect(keys).toContain('model-switch');
  });

  it('flags prefix churn when writes exceed reads', () => {
    const advice = adviseCache(cache({ cachedRead: 20000, input: 80000, cachedWrite: 50000 }));
    expect(advice!.tips.some((t) => t.key === 'churn')).toBe(true);
  });
});
