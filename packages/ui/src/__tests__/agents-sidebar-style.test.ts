import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const source = readFileSync(path.join(__dirname, '..', 'components', 'agents-sidebar.ts'), 'utf8');

function cssRule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(source);
  return match?.[1] ?? '';
}

describe('agents sidebar styles', () => {
  it('keeps narrow layout toolbar controls inside the sidebar', () => {
    expect(cssRule('.layout-toolbar')).toContain('overflow: hidden');

    const btsButton = cssRule('.bts-btn');
    expect(btsButton).toContain('flex: 0 1 auto');
    expect(btsButton).toContain('min-width: 0');
    expect(btsButton).toContain('overflow: hidden');

    const btsLabel = cssRule('.bts-label');
    expect(btsLabel).toContain('min-width: 0');
    expect(btsLabel).toContain('text-overflow: ellipsis');
  });

  it('uses pointer-driven session reordering instead of native drag and drop', () => {
    expect(source).toContain('const REORDER_DRAG_THRESHOLD = 5;');
    expect(source).toContain('@pointerdown=${(e: PointerEvent) => this.startReorderPointer(\'active\'');
    expect(source).toContain('window.addEventListener(\'pointermove\', this.onReorderPointerMove');
    expect(source).toContain('this.shadowRoot?.elementFromPoint(clientX, clientY)');
    expect(source).not.toContain('@dragstart=');
    expect(source).not.toContain('@drop=');

    const reorderable = cssRule('.item.reorderable');
    expect(reorderable).toContain('cursor: grab');
    expect(reorderable).toContain('-webkit-user-select: none');
  });
});
