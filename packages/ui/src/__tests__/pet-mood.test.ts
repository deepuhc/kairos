import { describe, it, expect } from 'vitest';
import { petMoodFor, type PetSessionState } from '../services/pet-mood.js';

const NOW = 1_000_000_000;

function session(overrides: Partial<PetSessionState> = {}): PetSessionState {
  return {
    phase: 'ready',
    stalled: false,
    backgroundActive: 0,
    loading: false,
    permission: null,
    elicitation: null,
    doneAt: null,
    ...overrides,
  };
}

describe('petMoodFor', () => {
  it('sleeps when the pool is empty', () => {
    expect(petMoodFor([], 0, NOW)).toBe('sleeping');
  });

  it('works when a session is thinking', () => {
    expect(petMoodFor([session({ phase: 'thinking' })], 0, NOW)).toBe('working');
  });

  it('works when only a background task is active', () => {
    expect(petMoodFor([session({ backgroundActive: 1 })], 0, NOW)).toBe('working');
  });

  it('worries on a pending permission', () => {
    expect(petMoodFor([session({ permission: {} })], 0, NOW)).toBe('worried');
  });

  it('worries on a pending elicitation', () => {
    expect(petMoodFor([session({ elicitation: {} })], 0, NOW)).toBe('worried');
  });

  it('worries on error or stall', () => {
    expect(petMoodFor([session({ phase: 'error' })], 0, NOW)).toBe('worried');
    expect(petMoodFor([session({ stalled: true })], 0, NOW)).toBe('worried');
  });

  it('lets worried beat working', () => {
    const sessions = [session({ phase: 'thinking' }), session({ permission: {} })];
    expect(petMoodFor(sessions, 0, NOW)).toBe('worried');
  });

  it('celebrates within the window when idle', () => {
    expect(petMoodFor([session()], NOW + 1000, NOW)).toBe('celebrating');
  });

  it('lets working beat a live celebration window', () => {
    expect(petMoodFor([session({ phase: 'thinking' })], NOW + 1000, NOW)).toBe('working');
  });

  it('is idle right after a recent completion', () => {
    expect(petMoodFor([session({ doneAt: NOW - 1000 })], 0, NOW)).toBe('idle');
  });

  it('sleeps once activity is stale', () => {
    expect(petMoodFor([session({ doneAt: NOW - 10 * 60 * 1000 })], 0, NOW)).toBe('sleeping');
  });
});
