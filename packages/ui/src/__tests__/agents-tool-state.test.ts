import { describe, expect, it } from 'vitest';
import { defaultDiffBodyExpanded, toolBodyOpen } from '../components/agents-tool-state.js';

const base = {
  hasBody: true,
  expanded: false,
  startExpanded: false,
  defaultExpanded: false,
  awaiting: false,
  userToggled: false,
  isSubAgent: false,
};

describe('toolBodyOpen', () => {
  it('does not auto-expand delegated Task cards by default', () => {
    expect(toolBodyOpen({ ...base, defaultExpanded: true, isSubAgent: true })).toBe(false);
  });

  it('auto-expands explicit default-open non-Task cards', () => {
    expect(toolBodyOpen({ ...base, defaultExpanded: true })).toBe(true);
  });

  it('does not auto-expand recent or running non-edit tools without default-open content', () => {
    expect(toolBodyOpen({ ...base, defaultExpanded: false })).toBe(false);
  });

  it('keeps explicit expansion and permission prompts open for Task cards', () => {
    expect(toolBodyOpen({ ...base, startExpanded: true, isSubAgent: true })).toBe(true);
    expect(toolBodyOpen({ ...base, awaiting: true, isSubAgent: true })).toBe(true);
  });
});

describe('defaultDiffBodyExpanded', () => {
  it('keeps inline diffs collapsed by default for all statuses', () => {
    expect(defaultDiffBodyExpanded(true, 'in_progress')).toBe(false);
    expect(defaultDiffBodyExpanded(true, 'completed')).toBe(false);
    expect(defaultDiffBodyExpanded(true, 'failed')).toBe(false);
    expect(defaultDiffBodyExpanded(false, 'in_progress')).toBe(false);
  });

  it('keeps replayed diffs collapsed as the same default policy', () => {
    expect(defaultDiffBodyExpanded(true, 'in_progress', true)).toBe(false);
    expect(defaultDiffBodyExpanded(true, 'completed', true)).toBe(false);
    expect(defaultDiffBodyExpanded(true, 'failed', true)).toBe(false);
  });
});
