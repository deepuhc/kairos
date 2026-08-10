import { describe, expect, it } from 'vitest';
import { nextPrompt, previousPrompt } from '../services/prompt-history.js';

describe('prompt history navigation', () => {
  it('starts at the newest non-empty prompt and preserves the draft', () => {
    const step = previousPrompt(['first', '   ', 'second'], null, 'draft in progress');

    expect(step?.text).toBe('second');
    expect(step?.navigation).toEqual({ cursor: 1, savedDraft: 'draft in progress' });
  });

  it('rotates backward through previous prompts with ArrowUp', () => {
    const history = ['first', 'second', 'third'];
    const newest = previousPrompt(history, null, '');
    const older = previousPrompt(history, newest!.navigation, '');
    const oldest = previousPrompt(history, older!.navigation, '');
    const wrapped = previousPrompt(history, oldest!.navigation, '');

    expect([newest?.text, older?.text, oldest?.text, wrapped?.text]).toEqual([
      'third',
      'second',
      'first',
      'third',
    ]);
  });

  it('steps forward with ArrowDown and restores the saved draft after the newest prompt', () => {
    const history = ['first', 'second', 'third'];
    const older = previousPrompt(history, previousPrompt(history, null, 'draft')!.navigation, 'draft');
    const newer = nextPrompt(history, older!.navigation);
    const restored = nextPrompt(history, newer!.navigation);

    expect(newer?.text).toBe('third');
    expect(restored).toEqual({ text: 'draft', navigation: null });
  });

  it('returns null when there is no text prompt history', () => {
    expect(previousPrompt(['', '  '], null, 'draft')).toBeNull();
    expect(nextPrompt(['first'], null)).toBeNull();
  });
});
