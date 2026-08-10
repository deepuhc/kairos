import { describe, expect, it } from 'vitest';
import { moveId, reorderByIds } from '../services/session-order.js';

describe('session ordering helpers', () => {
  it('moves an id before a target id', () => {
    expect(moveId(['a', 'b', 'c'], 'c', 'a', 'before')).toEqual(['c', 'a', 'b']);
  });

  it('moves an id after a target id', () => {
    expect(moveId(['a', 'b', 'c'], 'a', 'c', 'after')).toEqual(['b', 'c', 'a']);
  });

  it('keeps the original order when either id is missing', () => {
    const ids = ['a', 'b', 'c'];
    expect(moveId(ids, 'x', 'b', 'before')).toBe(ids);
    expect(moveId(ids, 'a', 'x', 'before')).toBe(ids);
  });

  it('orders known items first and preserves unknown relative order', () => {
    const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
    expect(reorderByIds(items, ['c', 'a'], (item) => item.id).map((item) => item.id))
      .toEqual(['c', 'a', 'b', 'd']);
  });
});
