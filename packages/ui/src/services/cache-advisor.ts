import type { CacheUsage } from './acp-types.js';

export type CacheGrade = 'good' | 'fair' | 'poor';

export interface CacheTip {
  key: string;
  cause: string;
  action: string;
}

export interface CacheAdvice {
  hitRate: number;
  grade: CacheGrade;
  cachedRead: number;
  cachedWrite: number;
  input: number;
  output: number;
  summary: string;
  tips: CacheTip[];
}

export interface CacheSignals {
  turns?: number;
  medianTurnGapSec?: number;
  compacted?: boolean;
  modelSwitched?: boolean;
}

const GOOD = 0.8;
const FAIR = 0.5;
const MIN_BILLABLE_INPUT = 20_000;
const WIDE_GAP_SEC = 5 * 60;

function grade(hitRate: number): CacheGrade {
  if (hitRate >= GOOD) return 'good';
  if (hitRate >= FAIR) return 'fair';
  return 'poor';
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

export function adviseCache(
  cache: CacheUsage | null | undefined,
  signals: CacheSignals = {},
): CacheAdvice | null {
  if (!cache) return null;
  const { cachedRead, cachedWrite, input, output } = cache;
  const billableInput = cachedRead + input;
  if (billableInput < MIN_BILLABLE_INPUT) return null;

  const hitRate = cache.hitRate ?? cachedRead / billableInput;
  const g = grade(hitRate);
  const tips: CacheTip[] = [];

  if (g !== 'good' && signals.medianTurnGapSec != null && signals.medianTurnGapSec >= WIDE_GAP_SEC) {
    tips.push({
      key: 'ttl-expiry',
      cause: `Turns average ${Math.round(signals.medianTurnGapSec / 60)} min apart - longer than the ~5 min cache lifetime, so the cache expires between prompts.`,
      action: 'Send follow-up prompts sooner, or batch related asks into one turn, to keep the cache warm.',
    });
  }

  if (signals.compacted) {
    tips.push({
      key: 'compaction',
      cause: 'The context was compacted this session, which resets the cached prefix and forces a re-warm.',
      action: 'Expected right after a compaction; the rate should recover over the next few turns.',
    });
  }

  if (signals.modelSwitched) {
    tips.push({
      key: 'model-switch',
      cause: 'The model was switched mid-session - prompt caches are per-model, so the prior cache no longer applies.',
      action: 'Pick a model at the start of a session and stay on it to preserve the cache.',
    });
  }

  if (g !== 'good' && cachedWrite > cachedRead && cachedRead > 0) {
    tips.push({
      key: 'churn',
      cause: 'More tokens are being written to the cache than read back, so the context prefix keeps changing before it can be reused.',
      action: 'Avoid edits that alter early context; append new work rather than revising the top of the conversation.',
    });
  }

  if (g === 'poor' && tips.length === 0) {
    tips.push({
      key: 'generic-low',
      cause: 'Most input is being sent fresh rather than served from cache.',
      action: 'Keep turns close together and avoid changing early context or switching models to build a stable cached prefix.',
    });
  }

  const summary =
    g === 'good'
      ? `Caching is healthy - ${pct(hitRate)} of input is served from cache.`
      : g === 'fair'
        ? `Caching is moderate - ${pct(hitRate)} of input from cache; there is room to cut cost.`
        : `Low cache reuse - only ${pct(hitRate)} of input from cache, so most of it is billed at the full rate.`;

  return {
    hitRate,
    grade: g,
    cachedRead,
    cachedWrite,
    input,
    output,
    summary,
    tips,
  };
}
