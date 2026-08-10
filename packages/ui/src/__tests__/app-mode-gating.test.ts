import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const appSource = readFileSync(path.join(__dirname, '..', 'app.ts'), 'utf8');
const sidebarSource = readFileSync(path.join(__dirname, '..', 'components', 'agents-sidebar.ts'), 'utf8');

describe('app mode — nav tab gating', () => {
  it('defines getVisibleTabs method', () => {
    expect(appSource).toContain('private getVisibleTabs(): View[]');
  });

  it('developer mode shows all 7 tabs', () => {
    const devMatch = appSource.match(/case 'developer':\s*return \[([^\]]+)\]/);
    expect(devMatch).not.toBeNull();
    const tabs = devMatch![1].split(',').map(s => s.trim().replace(/'/g, ''));
    expect(tabs).toEqual(['agents', 'files', 'prompts', 'plan', 'review', 'customize', 'sessions']);
  });

  it('professional mode shows 4 tabs (no plan, review, customize)', () => {
    const proMatch = appSource.match(/case 'professional':\s*return \[([^\]]+)\]/);
    expect(proMatch).not.toBeNull();
    const tabs = proMatch![1].split(',').map(s => s.trim().replace(/'/g, ''));
    expect(tabs).toEqual(['agents', 'files', 'prompts', 'sessions']);
    expect(tabs).not.toContain('plan');
    expect(tabs).not.toContain('review');
    expect(tabs).not.toContain('customize');
  });

  it('kids mode shows only 3 tabs (no history)', () => {
    const kidsMatch = appSource.match(/case 'kids':\s*return \[([^\]]+)\]/);
    expect(kidsMatch).not.toBeNull();
    const tabs = kidsMatch![1].split(',').map(s => s.trim().replace(/'/g, ''));
    expect(tabs).toEqual(['agents', 'files', 'prompts']);
    expect(tabs).not.toContain('sessions');
  });

  it('default mode shows 4 tabs', () => {
    // Match the default case which uses a comment: // 'default'
    const defMatch = appSource.match(/default:\s*\/\/\s*'default'\s*\n\s*return \[([^\]]+)\]/);
    expect(defMatch).not.toBeNull();
    const tabs = defMatch![1].split(',').map(s => s.trim().replace(/'/g, ''));
    expect(tabs).toEqual(['agents', 'files', 'prompts', 'sessions']);
  });

  it('renders "Chat" label for non-developer modes', () => {
    expect(appSource).toContain("v === 'agents' && this.appMode !== 'developer' ? 'Chat' : VIEW_LABELS[v]");
  });
});

describe('app mode — header action gating', () => {
  it('gates "Why" button behind developer mode', () => {
    // The Why button should only render in developer mode
    expect(appSource).toContain("this.appMode === 'developer' ? html`");
    expect(appSource).toContain('why-button');
  });

  it('gates testimonials behind developer mode', () => {
    expect(appSource).toContain('testimonial-wrap');
    // testimonial-wrap is inside the developer-only block
    const devBlock = appSource.indexOf("this.appMode === 'developer' ? html`");
    const testimonialWrap = appSource.indexOf('testimonial-wrap', devBlock);
    expect(testimonialWrap).toBeGreaterThan(devBlock);
  });

  it('gates feedback link behind developer mode', () => {
    const devBlock = appSource.indexOf("this.appMode === 'developer' ? html`");
    const feedbackLink = appSource.indexOf('feedback-link', devBlock);
    expect(feedbackLink).toBeGreaterThan(devBlock);
  });

  it('always shows help button regardless of mode', () => {
    // Help button should be outside any mode-gated block
    expect(appSource).toContain("aria-label=\"Help & guide\"");
  });

  it('always shows theme picker regardless of mode', () => {
    expect(appSource).toContain('<kairos-theme-picker>');
  });

  it('always shows mode picker regardless of mode', () => {
    expect(appSource).toContain('${this.renderModePicker()}');
  });
});

describe('app mode — click-outside-to-close', () => {
  it('adds document click listener in connectedCallback', () => {
    expect(appSource).toContain("document.addEventListener('click', this.onDocClick)");
  });

  it('removes document click listener in disconnectedCallback', () => {
    expect(appSource).toContain("document.removeEventListener('click', this.onDocClick)");
  });

  it('onDocClick closes mode picker when clicking outside', () => {
    expect(appSource).toContain('private onDocClick = (e: MouseEvent)');
    expect(appSource).toContain("if (!this.modePickerOpen) return");
    expect(appSource).toContain("this.modePickerOpen = false");
  });

  it('onDocClick checks composedPath for mode-picker-wrap', () => {
    expect(appSource).toContain('.mode-picker-wrap');
    expect(appSource).toContain('path.includes(wrap)');
  });
});

describe('app mode — mode picker UI', () => {
  it('defines mode icons for all 4 modes', () => {
    expect(appSource).toContain("default: '○'");
    expect(appSource).toContain("developer: '⌘'");
    expect(appSource).toContain("professional: '◆'");
    expect(appSource).toContain("kids: '★'");
  });

  it('renders mode dropdown with all modes', () => {
    expect(appSource).toContain('class="mode-dropdown"');
    expect(appSource).toContain('class="mode-option');
    expect(appSource).toContain('class="mode-label"');
    expect(appSource).toContain('class="mode-desc"');
  });

  it('selectMode calls setAppMode and closes dropdown', () => {
    expect(appSource).toContain('private selectMode(mode: AppMode)');
    expect(appSource).toContain('setAppMode(mode)');
    expect(appSource).toContain('this.appMode = mode');
    expect(appSource).toContain('this.modePickerOpen = false');
  });
});

describe('sidebar — connection error handling', () => {
  it('silently ignores "Not Found" errors', () => {
    expect(sidebarSource).toContain("msg === 'Not Found'");
  });

  it('silently ignores "Failed to fetch" errors', () => {
    expect(sidebarSource).toContain("msg === 'Failed to fetch'");
  });

  it('silently ignores ECONNREFUSED errors', () => {
    expect(sidebarSource).toContain("msg.includes('ECONNREFUSED')");
  });

  it('only shows non-connection errors to users', () => {
    expect(sidebarSource).toContain('if (!isConnectionError)');
    expect(sidebarSource).toContain("this.recentError = msg || 'Failed to load sessions'");
  });

  it('has a boolean flag for connection error detection', () => {
    expect(sidebarSource).toContain('const isConnectionError =');
  });
});

describe('imports — nothing from lit', () => {
  it('app.ts imports nothing from lit', () => {
    expect(appSource).toMatch(/import\s*\{[^}]*nothing[^}]*\}\s*from\s*'lit'/);
  });
});

describe('app — logo differentiation', () => {
  const petSource = readFileSync(path.join(__dirname, '..', 'components', 'agents-pet.ts'), 'utf8');

  it('header uses Kalimba SVG logo-mark', () => {
    expect(appSource).toContain('class="logo-mark"');
    expect(appSource).toContain('class="tine"');
    expect(appSource).toContain('class="bridge"');
  });

  it('logo-mark has interactive tine-ripple on hover', () => {
    expect(appSource).toContain('.logo-mark:hover .tine');
    expect(appSource).toContain('@keyframes tine-ripple');
  });

  it('logo-mark has breathing glow when agent active', () => {
    expect(appSource).toContain(':host([agent-active]) .logo-mark');
    expect(appSource).toContain('@keyframes logo-breathe');
  });

  it('bottom-left pet uses an orb shape, NOT the Kalimba', () => {
    expect(petSource).toContain('class="orb-body"');
    expect(petSource).toContain('class="orb-ring"');
    expect(petSource).toContain('class="orb-dot"');
    expect(petSource).not.toContain('class="tine"');
    expect(petSource).not.toContain('class="bridge"');
  });

  it('pet orb changes color with mood state', () => {
    expect(petSource).toContain('.sleeping .orb-ring');
    expect(petSource).toContain('.celebrating .orb-ring');
    expect(petSource).toContain('.worried .orb-ring');
  });
});

describe('agents-view — auto-default CWD for non-developer modes', () => {
  const viewSource = readFileSync(path.join(__dirname, '..', 'components', 'agents-view.ts'), 'utf8');

  it('defines getDefaultCwd method', () => {
    expect(viewSource).toContain('private getDefaultCwd(): string');
  });

  it('auto-defaults CWD in non-developer modes', () => {
    expect(viewSource).toContain("if (!cwd && !this.isDeveloperMode())");
    expect(viewSource).toContain("cwd = this.getDefaultCwd()");
  });

  it('getDefaultCwd tries loadLastCwd first', () => {
    expect(viewSource).toContain('const last = loadLastCwd()');
    expect(viewSource).toContain('if (last) return last');
  });

  it('falls back to ~ when no last CWD exists', () => {
    // The tilde is a universal fallback the backend can resolve
    expect(viewSource).toContain("return '~'");
  });

  it('still requires CWD in developer mode', () => {
    // The error message is only hit when isDeveloperMode is true and cwd is empty
    expect(viewSource).toContain("'Choose a working directory first.'");
  });
});
