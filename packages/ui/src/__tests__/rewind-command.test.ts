import { describe, expect, it } from 'vitest';
import { buildSlashMenuItems, isRewindCommand, isSlashCommandMessage } from '../services/prompt-util.js';

function itemLabel(item: ReturnType<typeof buildSlashMenuItems>[number]): string {
  if (item.kind === 'prompt') return `prompt:${item.prompt.name}`;
  if (item.kind === 'command') return `command:${item.command.name}`;
  return 'rewind';
}

describe('isRewindCommand', () => {
  it('matches a bare /rewind, ignoring case and surrounding whitespace', () => {
    expect(isRewindCommand('/rewind')).toBe(true);
    expect(isRewindCommand('/rewind ')).toBe(true);
    expect(isRewindCommand('  /rewind  ')).toBe(true);
    expect(isRewindCommand('/REWIND')).toBe(true);
    expect(isRewindCommand('/Rewind')).toBe(true);
  });

  it('leaves longer names and arguments for the agent', () => {
    expect(isRewindCommand('/rewinder')).toBe(false);
    expect(isRewindCommand('/rewind foo')).toBe(false);
    expect(isRewindCommand('/rewind 3')).toBe(false);
    expect(isRewindCommand('rewind')).toBe(false);
    expect(isRewindCommand('please /rewind')).toBe(false);
    expect(isRewindCommand('')).toBe(false);
  });
});

describe('isSlashCommandMessage', () => {
  it('matches agent slash-command turns with optional arguments', () => {
    expect(isSlashCommandMessage('/usage')).toBe(true);
    expect(isSlashCommandMessage('/compact now')).toBe(true);
    expect(isSlashCommandMessage('  /model opus  ')).toBe(true);
  });

  it('does not match ordinary prose or comments containing slashes', () => {
    expect(isSlashCommandMessage('please run /usage later')).toBe(false);
    expect(isSlashCommandMessage('// TODO: check this')).toBe(false);
    expect(isSlashCommandMessage('/')).toBe(false);
    expect(isSlashCommandMessage('')).toBe(false);
  });
});

describe('buildSlashMenuItems', () => {
  const commands = [
    { name: 'compact', description: 'Compact the conversation' },
    { name: 'review', description: 'Run agent review' },
  ];
  const prompts = [
    { id: 'review', name: 'review', body: 'Review the diff.' },
    { id: 'plan', name: 'plan', body: 'Make a plan.' },
  ];

  it('shows user-defined prompts above rewind and agent commands', () => {
    const items = buildSlashMenuItems({
      commands,
      prompts,
      query: '',
      listing: true,
      hasRewindPrompts: true,
    });

    expect(items.map(itemLabel)).toEqual([
      'prompt:review',
      'prompt:plan',
      'rewind',
      'command:compact',
      'command:review',
    ]);
  });

  it('keeps matching prompts first when filtering by slash query', () => {
    const items = buildSlashMenuItems({
      commands,
      prompts,
      query: 're',
      listing: false,
      hasRewindPrompts: true,
    });

    expect(items.map(itemLabel)).toEqual([
      'prompt:review',
      'rewind',
      'command:review',
    ]);
  });
});
