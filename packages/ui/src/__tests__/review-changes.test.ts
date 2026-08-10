import { describe, expect, it } from 'vitest';
import { collectSessionChanges, countSessionChangedFiles } from '../services/review-changes.js';
import type { TimelineItem } from '../services/acp-types.js';

describe('review change aggregation', () => {
  it('invalidates cached empty results when a tool diff arrives in-place later', () => {
    const items: TimelineItem[] = [{
      kind: 'tool',
      id: 'tool:codex-edit',
      tool: {
        toolCallId: 'codex-edit',
        kind: 'edit',
        status: 'in_progress',
        content: [],
      },
    }];

    expect(countSessionChangedFiles(items, 1)).toBe(0);
    expect(collectSessionChanges(items, 1).filesChanged).toBe(0);

    const toolItem = items[0];
    if (!toolItem || toolItem.kind !== 'tool') throw new Error('expected a tool item');

    items[0] = {
      ...toolItem,
      tool: {
        ...toolItem.tool,
        status: 'completed',
        content: [{
          type: 'diff',
          path: 'src/app.ts',
          oldText: 'const value = 1;\n',
          newText: 'const value = 2;\n',
        }],
      },
    };

    expect(countSessionChangedFiles(items, 2)).toBe(1);
    expect(collectSessionChanges(items, 2)).toMatchObject({
      filesChanged: 1,
      totalAdded: 1,
      totalRemoved: 1,
      files: [{
        path: 'src/app.ts',
        edits: 1,
        kind: 'modified',
        added: 1,
        removed: 1,
      }],
    });
  });
});
