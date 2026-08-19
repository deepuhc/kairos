import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const source = readFileSync(path.join(__dirname, '..', 'components', 'file-drop.ts'), 'utf8');

function cssRule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(source);
  return match?.[1] ?? '';
}

// The file-drop component is a drag-drop / click-to-browse upload that runs the
// server extraction pipeline and previews the result. These tests pin the
// interaction surface and the accessibility affordances.
describe('kairos-file-drop', () => {
  it('registers as a kairos-prefixed custom element', () => {
    expect(source).toContain("@customElement('kairos-file-drop')");
  });

  it('handles the full drag lifecycle', () => {
    expect(source).toContain('@dragover=');
    expect(source).toContain('@dragleave=');
    expect(source).toContain('@drop=');
    // Every drag handler must preventDefault so the browser doesn't open the file.
    expect(source).toContain('e.preventDefault()');
  });

  it('gives the drop zone a highlighted dragging state', () => {
    expect(cssRule('.zone.dragging')).toContain('border-color: var(--accent)');
  });

  it('offers a keyboard-accessible browse affordance', () => {
    expect(source).toContain('role="button"');
    expect(source).toContain('tabindex="0"');
    // Enter/Space opens the picker.
    expect(source).toContain("e.key === 'Enter'");
    expect(source).toMatch(/aria-label=/);
  });

  it('has a hidden native file input triggered programmatically', () => {
    expect(source).toContain('type="file"');
    expect(cssRule('.hidden-input')).toContain('display: none');
    expect(source).toContain('input?.click()');
  });

  it('emits a file-extracted event with the result', () => {
    expect(source).toContain("new CustomEvent('file-extracted'");
    expect(source).toContain('bubbles: true');
    expect(source).toContain('composed: true');
  });

  it('renders both a table (structured) and a snippet (text) preview path', () => {
    expect(source).toContain('renderTable');
    expect(source).toContain('snippet');
    expect(source).toContain("content.type === 'structured'");
  });

  it('caps the rendered table rows so huge sheets do not blow out the DOM', () => {
    expect(source).toContain('MAX_TABLE_ROWS');
    expect(source).toContain('more row');
  });
});
