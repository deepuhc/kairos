import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const source = readFileSync(path.join(__dirname, '..', 'components', 'agents-file-tree.ts'), 'utf8');

function cssRule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(source);
  return match?.[1] ?? '';
}

function method(name: string): string {
  const start = source.indexOf(`private ${name}`);
  if (start === -1) return '';
  const next = source.indexOf('\n  private ', start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

describe('agents file tree styles', () => {
  it('renders a draggable splitter between the tree and preview panes', () => {
    expect(source).toContain("const TREE_WIDTH_KEY = 'kairos-agents:file-tree-width';");
    expect(source).toContain('@pointerdown=${this.startTreeResize}');
    expect(source).toContain('@dblclick=${this.resetTreeWidth}');

    expect(cssRule('.tree')).toContain('flex: 0 0 auto');
    expect(source).toContain('cursor: col-resize;');
    expect(source).toContain('touch-action: none;');
  });

  it('caps file tree resizing so the preview keeps visible space', () => {
    const onTreeResizeMove = method('onTreeResizeMove');

    expect(onTreeResizeMove).toContain('body.clientWidth - TREE_PREVIEW_MIN - TREE_SPLITTER_WIDTH');
    expect(onTreeResizeMove).toContain('this.treeWidth = Math.min(max, clampTreeWidth(raw));');
  });
});
