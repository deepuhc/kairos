import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const source = readFileSync(path.join(__dirname, '..', 'components', 'agents-terminal.ts'), 'utf8');

function cssRule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(source);
  return match?.[1] ?? '';
}

function method(name: string): string {
  const syncStart = source.indexOf(`private ${name}(`);
  const asyncStart = source.indexOf(`private async ${name}(`);
  const start = syncStart === -1 ? asyncStart : syncStart;
  if (start === -1) return '';
  const next = source.indexOf('\n  private ', start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

describe('agents terminal theme integration', () => {
  it('uses Kairos theme tokens for panel chrome', () => {
    expect(cssRule(':host')).toContain('background: var(--bg-base)');
    expect(cssRule('.terminal-frame')).toContain('var(--accent-a10)');
    expect(cssRule('.terminal-frame')).toContain('var(--bg-subtle)');
    expect(cssRule('.terminal-host')).toContain('background: var(--bg-base)');
    expect(cssRule('.terminal-host')).toContain('border: 1px solid var(--glass-border)');
  });

  it('updates the Xterm palette from active theme tokens', () => {
    expect(source).toContain("window.addEventListener('theme-changed', this.applyTheme)");
    expect(source).toContain("attributeFilter: ['data-theme', 'data-theme-kind']");

    const xtermTheme = method('xtermTheme');
    expect(xtermTheme).toContain("token('--bg-base'");
    expect(xtermTheme).toContain("token('--white'");
    expect(xtermTheme).toContain("token('--accent'");
    expect(xtermTheme).toContain("token('--accent-a35'");
  });

  it('keeps the xterm scrollbar inside the padded terminal area', () => {
    expect(cssRule('.terminal-host')).toContain('--terminal-inset: 9px');
    expect(cssRule('.xterm')).toContain('padding: var(--terminal-inset)');

    const viewport = cssRule('.xterm .xterm-viewport');
    expect(viewport).toContain('top: var(--terminal-inset)');
    expect(viewport).toContain('right: var(--terminal-inset)');
    expect(viewport).toContain('bottom: var(--terminal-inset)');
    expect(viewport).toContain('left: var(--terminal-inset)');
    expect(viewport).toContain('scrollbar-color: var(--w25) transparent');

    expect(cssRule('.xterm .xterm-viewport::-webkit-scrollbar-button')).toContain('display: none');
    expect(cssRule('.xterm .xterm-viewport::-webkit-scrollbar-thumb')).toContain('background-clip: content-box');
  });

  it('binds terminal clipboard shortcuts without stealing Ctrl+C interrupt', () => {
    expect(source).toContain('this.term.attachCustomKeyEventHandler((event) => this.handleKeyEvent(event))');

    const handleKeyEvent = method('handleKeyEvent');
    expect(handleKeyEvent).toContain("event.type !== 'keydown' || event.altKey");
    expect(handleKeyEvent).toContain("const copy = key === 'c' && primary && (event.shiftKey || event.metaKey)");
    expect(handleKeyEvent).toContain("const paste = key === 'v' && primary");
    expect(handleKeyEvent).toContain('void this.copySelectionToClipboard()');
    expect(handleKeyEvent).toContain('void this.pasteFromClipboard()');

    const copySelectionToClipboard = method('copySelectionToClipboard');
    expect(copySelectionToClipboard).toContain('this.term?.getSelection()');
    expect(copySelectionToClipboard).toContain('navigator.clipboard.writeText(text)');

    const pasteFromClipboard = method('pasteFromClipboard');
    expect(pasteFromClipboard).toContain('navigator.clipboard.readText()');
    expect(pasteFromClipboard).toContain('this.term?.paste(text)');
  });

  it('does not send terminal resize while hidden or collapsed', () => {
    expect(source).toContain('@property({ type: Boolean, reflect: true }) override hidden = false;');
    expect(source).toContain(':host([hidden]) { display: none; }');

    const updated = source.slice(source.indexOf('updated(changed'), source.indexOf('\n  connectedCallback'));
    expect(updated).toContain("changed.has('hidden')");
    expect(updated).toContain('this.scheduleFit(180)');
    expect(source).toContain('new ResizeObserver(() => this.scheduleFit(90))');
    expect(source).toContain('this.fit();\n    this.connect();');

    const fit = method('fit');
    expect(fit).toContain('rect.width < 40 || rect.height < 40');
    expect(fit).toContain('return false;');

    const scheduleFit = method('scheduleFit');
    expect(scheduleFit).toContain('if (delayMs > 0)');
    expect(scheduleFit).toContain('window.clearTimeout(this.fitTimer)');
    expect(scheduleFit).toContain('if (this.fit()) this.sendResize();');
  });

  it('does not clear backend output from the websocket open race', () => {
    const connect = method('connect');
    const onMessage = method('onMessage');

    expect(connect).toContain('this.receivedOutput = false;');
    expect(connect).toContain('this.fit();');
    expect(connect).toContain('this.term.reset();');
    expect(connect).not.toContain("this.status = 'open';\n      this.term?.clear();");

    expect(onMessage).toContain('if (!this.receivedOutput)');
    expect(onMessage).toContain('this.term?.reset();');
    expect(onMessage).toContain('this.receivedOutput = true;');
    expect(onMessage).toContain('this.term?.write(message.data);');
  });
});
