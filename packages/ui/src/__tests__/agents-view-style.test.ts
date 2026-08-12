import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const source = readFileSync(path.join(__dirname, '..', 'components', 'agents-view.ts'), 'utf8');

function cssRule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(source);
  return match?.[1] ?? '';
}

function method(name: string): string {
  const starts = [
    source.indexOf(`private ${name}`),
    source.indexOf(`private async ${name}`),
  ].filter((idx) => idx !== -1);
  const start = starts.length ? Math.min(...starts) : -1;
  if (start === -1) return '';
  const next = source.indexOf('\n  private ', start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

describe('agents view styles', () => {
  it('keeps the jump-to-latest pill opaque on hover', () => {
    expect(cssRule('.jump-latest')).toContain('background: var(--surface-modal');

    const hover = cssRule('.jump-latest:hover');
    expect(hover).toContain('background: var(--bg-elevated-hover)');
    expect(hover).not.toContain('background: var(--w5)');
  });

  it('sizes the empty composer textarea to fit one line above the footer', () => {
    const textarea = cssRule('textarea');
    const minHeight = /min-height:\s*(\d+)px/.exec(textarea);
    expect(minHeight).not.toBeNull();
    // One line (14px × 1.55 ≈ 22px) + 17px vertical padding must fit, or the
    // placeholder clips onto the config chips below (issue #27).
    expect(Number(minHeight![1])).toBeGreaterThanOrEqual(39);
  });

  it('keeps composer autosize stable while typing', () => {
    expect(source).toContain('const COMPOSER_TEXTAREA_RESIZE_EPSILON = 2;');
    expect(source).toContain('class="composer-input"');
    expect(source).toContain('class="composer-sizer"');

    expect(cssRule('.composer-box')).toContain('position: relative');
    const sizer = cssRule('.composer-sizer');
    expect(sizer).toContain('position: absolute');
    expect(sizer).toContain('visibility: hidden');

    const handleInput = method('handleInput');
    expect(handleInput).toContain('const previousDraft = s.draft;');
    expect(handleInput).toContain('this.scheduleComposerResize(ta.value.length < previousDraft.length, ta);');
    expect(handleInput).not.toContain('this.autoGrow(ta);');

    const measure = method('measureComposerScrollHeight');
    expect(measure).toContain("querySelector<HTMLTextAreaElement>('.composer-sizer')");
    expect(measure).toContain('sizer.style.width = `${width}px`;');

    const autoGrow = method('autoGrow');
    expect(autoGrow).toContain('const scrollHeight = this.measureComposerScrollHeight(ta);');
    expect(autoGrow).toContain('nextHeight > currentHeight + COMPOSER_TEXTAREA_RESIZE_EPSILON');
    expect(autoGrow).toContain('allowShrink && nextHeight < currentHeight - COMPOSER_TEXTAREA_RESIZE_EPSILON');
    expect(autoGrow).not.toContain("ta.style.height = '0px'");
    expect(autoGrow).not.toContain("ta.style.height = 'auto'");
  });

  it('uses low-noise chrome for composer controls', () => {
    const composer = cssRule('.composer-box');
    expect(composer).toContain('border: 1px solid transparent');
    expect(composer).toContain('box-shadow: none');

    const composerFocus = cssRule('.composer-box:focus-within');
    expect(composerFocus).toContain('box-shadow: 0 0 0 1px var(--accent-a35), 0 0 0 4px var(--accent-a10)');

    const composerBusy = cssRule('.composer-box.busy:not(:focus-within)');
    expect(composerBusy).toContain('border-color: var(--accent-a25)');
    expect(composerBusy).toContain('background: var(--w4)');
    expect(composerBusy).not.toContain('background: var(--accent');

    const trigger = cssRule('.config-trigger');
    expect(trigger).toContain('border: 1px solid transparent');
    expect(trigger).toContain('background: transparent');

    expect(cssRule('.icon-btn.attach')).toContain('border: 1px solid transparent');
    expect(cssRule('.icon-btn.slash')).toContain('border: 1px solid transparent');
  });

  it('keeps the composer from horizontally scrolling at high zoom', () => {
    expect(cssRule('.composer-box')).toContain('min-width: 0');
    expect(cssRule('textarea')).toContain('overflow-x: hidden');
    expect(cssRule('textarea')).toContain('overflow-wrap: anywhere');

    const footer = cssRule('.composer-footer');
    expect(footer).toContain('flex-wrap: wrap');
    expect(footer).toContain('min-width: 0');

    const actions = cssRule('.composer-actions');
    expect(actions).toContain('margin-left: auto');
    expect(actions).toContain('flex-shrink: 0');

    expect(cssRule('.config-ctl')).toContain('min-width: 0');
    expect(cssRule('.config-ctl')).toContain('max-width: 100%');
    expect(cssRule('.config-trigger')).toContain('min-width: 0');
    expect(cssRule('.config-trigger')).toContain('max-width: 100%');
    expect(cssRule('.config-trigger-label')).toContain('text-overflow: ellipsis');
    expect(source).toContain('<span class="config-trigger-label">${current?.name ?? o.name}</span>');
  });

  it('resets slash menu selection when the typed menu opens or changes query', () => {
    expect(source).toContain('private lastSlashQuery: string | null = null;');

    const syncSlashMenu = method('syncSlashMenu');
    expect(syncSlashMenu).toContain('const opening = !this.slashOpen;');
    expect(syncSlashMenu).toContain('if (opening || q !== this.lastSlashQuery) this.slashIndex = 0;');
    expect(syncSlashMenu).toContain('if (opening) this.loadPrompts(true);');
    expect(syncSlashMenu).toContain('this.lastSlashQuery = q;');

    const loadPrompts = method('loadPrompts');
    expect(loadPrompts).toContain('private async loadPrompts(resetSlashIndex = false)');
    expect(loadPrompts).toContain('if (resetSlashIndex && (this.slashOpen || this.slashButtonOpen))');
    expect(loadPrompts).toContain('this.slashIndex = 0;');

    const renderSlashMenu = method('renderSlashMenu');
    expect(renderSlashMenu).toContain('@mousemove=${() => { this.slashIndex = i; }}');
    expect(renderSlashMenu).not.toContain('@mouseenter=${() => { this.slashIndex = i; }}');
  });

  it('allows the right side panel to grow wider while preserving a chat column', () => {
    expect(source).toContain('const PANEL_WIDTH_MAX = 1400;');
    expect(source).toContain('const PANEL_CHAT_MIN = 260;');
    expect(cssRule('.side-panel')).not.toContain('transition: width');

    const onPanelResizeMove = method('onPanelResizeMove');
    expect(onPanelResizeMove).toContain('split.clientWidth - PANEL_CHAT_MIN');
    expect(onPanelResizeMove).toContain('this.panelWidth = Math.min(max, clampPanelWidth(raw));');
    expect(onPanelResizeMove).toContain('this.scheduleComposerResize(true);');
  });

  it('does not force composer autosize for right-panel open/close toggles', () => {
    const start = source.indexOf('  updated(changed');
    const end = source.indexOf('  // Launch', start);
    const updated = source.slice(start, end);

    expect(updated).toContain("changed.has('panelWidth')");
    expect(updated).not.toContain("changed.has('treeOpen')");
    expect(updated).not.toContain("changed.has('sourceOpen')");
    expect(updated).not.toContain("changed.has('reviewOpen')");
    expect(updated).not.toContain("changed.has('summaryOpen')");
    expect(updated).not.toContain("changed.has('planOpen')");
    expect(updated).not.toContain("changed.has('promptsOpen')");
    expect(updated).not.toContain("changed.has('terminalOpen')");
    expect(updated).not.toContain("changed.has('framesOpen')");
  });

  it('adds a terminal panel below summary using the session workdir', () => {
    const summaryRail = source.indexOf('aria-label="Summary"');
    const terminalRail = source.indexOf('aria-label="Terminal"');

    expect(summaryRail).toBeGreaterThan(-1);
    expect(terminalRail).toBeGreaterThan(summaryRail);
    expect(source).toContain("this.togglePanel('terminal')");
    expect(source).toContain("import { keyed } from 'lit/directives/keyed.js';");
    expect(source).toContain('keyed(s.id, html`');
    expect(source).toContain('this.terminalSessionId === s.id');
    expect(source).toContain('?hidden=${!this.terminalOpen}');
    expect(source).toContain('.sessionId=${s.id}');
    expect(source).toContain('.cwd=${this.sessionWorkdir(s)}');
  });

  it('adds a source-control panel for git-backed sessions', () => {
    const filesRail = source.indexOf('aria-label="Browse files"');
    const sourceRail = source.indexOf('aria-label="Git changes"');
    const promptsRail = source.indexOf('aria-label="Prompts"');

    expect(filesRail).toBeGreaterThan(-1);
    expect(sourceRail).toBeGreaterThan(filesRail);
    expect(promptsRail).toBeGreaterThan(sourceRail);
    expect(source).toContain("import './agents-source-control.js';");
    expect(source).toContain("type PanelId = 'files' | 'source' | 'review' | 'summary' | 'plan' | 'prompts' | 'terminal';");
    expect(source).toContain('@state() private sourceOpen = false;');
    expect(source).toContain('private sourceStatusSummaries = new Map<string, SourceStatusSummary>();');
    expect(source).toContain("this.togglePanel('source')");
    expect(source).toContain('<agents-source-control');
    expect(source).toContain('@open-file=${(e: CustomEvent<{ path: string }>) => this.openSourceFile(s, e.detail.path)}');
    expect(source).toContain('<span class="rail-label">Git</span>');
  });

  it('keeps git status checks off hot render paths', () => {
    const start = source.indexOf('  updated(changed');
    const end = source.indexOf('  // Launch', start);
    const updated = source.slice(start, end);
    const refreshSourceStatus = method('refreshSourceStatus');

    expect(updated).toContain("changed.has('activeId') || changed.has('sessions')");
    expect(updated).not.toContain("changed.has('rev')");
    expect(refreshSourceStatus).toContain('if (force && this.sourceOpen && s.id === this.activeId)');
    expect(refreshSourceStatus).toContain('const status = await detectRepo(cwd);');
    expect(refreshSourceStatus).toContain('const status = await getGitStatus(cwd);');
  });

  it('keeps terminals lazy and terminates them only when active sessions close', () => {
    expect(source).toContain('private initializedTerminalIds = new Set<string>();');
    expect(source).toContain('this.initializedTerminalIds.add(sessionId);');
    expect(source).toContain('terminateRemovedSessionTerminals');
    expect(source).toContain("fetchWithAuth(`/terminal/session/${encodeURIComponent(session.id)}`, { method: 'DELETE' })");
  });

  it('stores right-panel selection and expanded state per session', () => {
    expect(source).toContain("type PanelId = 'files' | 'source' | 'review' | 'summary' | 'plan' | 'prompts' | 'terminal';");
    expect(source).toContain('type SessionPanelState = { panel: PanelId; open: boolean };');
    expect(source).toContain('private sessionPanelStates = new Map<string, SessionPanelState>();');
    expect(source).toContain('private saveActivePanelState()');
    expect(source).toContain('private restorePanelState(sessionId: string | null)');
    expect(source).toContain('private applyPanelState(sessionId: string | null, state: SessionPanelState)');
    expect(source).toContain('do not remount hidden terminals after session');
    expect(source).toContain('hidden attaches cannot fit and may resize the PTY to 80 cols');
  });

  it('restores each session panel state when switching sessions', () => {
    const switchTo = method('switchTo');

    expect(switchTo).not.toContain('this.reviewOpen = false;');
    expect(switchTo).not.toContain('this.treeOpen = false;');
    expect(switchTo).not.toContain('this.terminalOpen = false;');
    expect(switchTo).toContain('this.saveActivePanelState();');
    expect(switchTo).toContain('this.activeId = id;');
    expect(switchTo).toContain('this.restorePanelState(id);');
  });
});
