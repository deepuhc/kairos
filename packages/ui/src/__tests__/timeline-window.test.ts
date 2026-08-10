import { describe, expect, it } from 'vitest';
import { preserveTimelineWindowStart } from '../services/timeline-window.js';

describe('preserveTimelineWindowStart', () => {
  it('grows the cap to keep the rendered start index stable as new items append', () => {
    expect(preserveTimelineWindowStart(60, 100, 101)).toBe(61);
  });

  it('keeps all already-rendered items when a short timeline crosses the default cap', () => {
    expect(preserveTimelineWindowStart(60, 60, 61)).toBe(61);
  });

  it('does not change the cap when no new items were appended', () => {
    expect(preserveTimelineWindowStart(80, 100, 100)).toBe(80);
  });
});
