import { describe, it, expect, beforeEach } from 'vitest';
import { formatFeedbackReport, collectFeedbackContext, type FeedbackContext } from '../services/feedback-report.js';
import { recordError, recentErrors, clearErrors } from '../services/feedback-log.js';

const baseCtx: FeedbackContext = {
  version: '0.1.0',
  mode: 'developer',
  view: 'files',
  userAgent: 'TestAgent/1.0',
  url: 'http://localhost:3333/',
  diagnostics: {
    configPath: '/home/u/.kairos/providers.json',
    configLoaded: true,
    ollamaHostEnv: 'http://100.80.191.11:11434',
    providers: [
      { name: 'ollama', isLocal: true, endpoint: 'http://100.80.191.11:11434', reachable: true, modelCount: 3, visionModels: ['llava'] },
      { name: 'gemini', isLocal: false, endpoint: undefined, reachable: false, modelCount: 0, visionModels: [] },
    ],
  },
  errors: [],
};

describe('formatFeedbackReport', () => {
  it('includes the user message verbatim', () => {
    const out = formatFeedbackReport('Image upload spins forever', baseCtx);
    expect(out).toContain('Image upload spins forever');
    expect(out).toContain('--- Message ---');
  });

  it('falls back to a placeholder when the message is blank', () => {
    expect(formatFeedbackReport('   ', baseCtx)).toContain('(no message provided)');
  });

  it('renders version, mode, and view', () => {
    const out = formatFeedbackReport('x', baseCtx);
    expect(out).toContain('Version: 0.1.0');
    expect(out).toContain('Mode: developer');
    expect(out).toContain('View: files');
  });

  it('renders each provider with local/cloud, reachability, and vision models', () => {
    const out = formatFeedbackReport('x', baseCtx);
    expect(out).toContain('ollama [local]');
    expect(out).toContain('reachable=true');
    expect(out).toContain('vision: llava');
    expect(out).toContain('gemini [cloud]');
    expect(out).toContain('OLLAMA_HOST: http://100.80.191.11:11434');
  });

  it('notes when diagnostics are unavailable', () => {
    const out = formatFeedbackReport('x', { ...baseCtx, diagnostics: { error: 'network down' } });
    expect(out).toContain('diagnostics unavailable: network down');
  });

  it('renders recent errors, or a none marker', () => {
    expect(formatFeedbackReport('x', baseCtx)).toContain('(none captured)');
    const withErr: FeedbackContext = {
      ...baseCtx,
      errors: [{ at: 0, kind: 'error', message: 'Boom', detail: 'at foo.js:1' }],
    };
    const out = formatFeedbackReport('x', withErr);
    expect(out).toContain('error: Boom');
    expect(out).toContain('at foo.js:1');
  });
});

describe('collectFeedbackContext', () => {
  it('captures diagnostics from a stubbed fetch', async () => {
    const fetchImpl = (async () => ({
      ok: true,
      json: async () => ({ configLoaded: true, providers: [] }),
    })) as unknown as typeof fetch;
    const ctx = await collectFeedbackContext({
      mode: 'default',
      view: 'agents',
      fetchImpl,
      win: { navigator: { userAgent: 'UA' }, location: { href: 'http://x/' } },
    });
    expect(ctx.mode).toBe('default');
    expect(ctx.userAgent).toBe('UA');
    expect(ctx.diagnostics).toMatchObject({ configLoaded: true });
  });

  it('degrades gracefully when diagnostics fetch fails', async () => {
    const fetchImpl = (async () => { throw new Error('boom'); }) as unknown as typeof fetch;
    const ctx = await collectFeedbackContext({ mode: 'default', view: 'agents', fetchImpl, win: {} });
    expect(ctx.diagnostics).toMatchObject({ error: 'boom' });
  });
});

describe('feedback-log ring buffer', () => {
  beforeEach(() => clearErrors());

  it('records errors and returns them oldest-first', () => {
    recordError('error', 'first');
    recordError('console', 'second', 'detail');
    const errs = recentErrors();
    expect(errs.map((e) => e.message)).toEqual(['first', 'second']);
    expect(errs[1].detail).toBe('detail');
  });

  it('ignores blank messages', () => {
    recordError('error', '   ');
    expect(recentErrors()).toHaveLength(0);
  });

  it('caps the buffer so it cannot grow unbounded', () => {
    for (let i = 0; i < 100; i++) recordError('error', `e${i}`);
    const errs = recentErrors();
    expect(errs.length).toBeLessThanOrEqual(25);
    // The most recent survive; the oldest are evicted.
    expect(errs[errs.length - 1].message).toBe('e99');
  });
});
