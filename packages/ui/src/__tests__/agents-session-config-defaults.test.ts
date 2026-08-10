import { describe, expect, it } from 'vitest';
import type { SessionConfigOption } from '../services/acp-types.js';
import { inferThoughtLevelDefaults, thoughtLevelDefaultValue } from '../services/agents-session.js';

function configOptions(model: string, effort: string): SessionConfigOption[] {
  return [
    {
      id: 'model',
      name: 'Model',
      category: 'model',
      type: 'select',
      currentValue: model,
      options: [
        { value: 'opus', name: 'Opus' },
        { value: 'sonnet', name: 'Sonnet' },
      ],
    },
    {
      id: 'effort',
      name: 'Effort',
      category: 'thought_level',
      type: 'select',
      currentValue: effort,
      options: [
        { value: 'low', name: 'Low' },
        { value: 'medium', name: 'Medium' },
        { value: 'high', name: 'High' },
      ],
    },
  ];
}

describe('thought level defaults', () => {
  it('records effort defaults scoped to the current model', () => {
    const opusDefaults = inferThoughtLevelDefaults(new Map(), configOptions('opus', 'high'));

    expect(thoughtLevelDefaultValue(opusDefaults, configOptions('opus', 'low'), 'effort')).toBe('high');
    expect(thoughtLevelDefaultValue(opusDefaults, configOptions('sonnet', 'medium'), 'effort')).toBeUndefined();

    const allDefaults = inferThoughtLevelDefaults(opusDefaults, configOptions('sonnet', 'medium'));

    expect(thoughtLevelDefaultValue(allDefaults, configOptions('opus', 'low'), 'effort')).toBe('high');
    expect(thoughtLevelDefaultValue(allDefaults, configOptions('sonnet', 'high'), 'effort')).toBe('medium');
  });
});
