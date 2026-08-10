import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Mock localStorage and document before importing the module
const mockStorage: Record<string, string> = {};
const mockLocalStorage = {
  getItem: vi.fn((key: string) => mockStorage[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { mockStorage[key] = value; }),
  removeItem: vi.fn((key: string) => { delete mockStorage[key]; }),
  clear: vi.fn(() => { Object.keys(mockStorage).forEach(k => delete mockStorage[k]); }),
  length: 0,
  key: vi.fn(() => null),
};

const mockSetAttribute = vi.fn();
const mockDispatchEvent = vi.fn();

vi.stubGlobal('localStorage', mockLocalStorage);
vi.stubGlobal('document', {
  documentElement: { setAttribute: mockSetAttribute },
});
vi.stubGlobal('window', {
  dispatchEvent: mockDispatchEvent,
});

// Import after mocks are set up
const { getAppMode, setAppMode, applyMode, getAllModes } = await import('../services/app-mode.js');

describe('app-mode service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(mockStorage).forEach(k => delete mockStorage[k]);
  });

  describe('getAllModes()', () => {
    it('returns all 4 modes with id, label, and description', () => {
      const modes = getAllModes();
      expect(modes).toHaveLength(4);
      expect(modes.map(m => m.id)).toEqual(['default', 'developer', 'professional', 'kids']);
    });

    it('each mode has a non-empty label and description', () => {
      for (const m of getAllModes()) {
        expect(m.label.length).toBeGreaterThan(0);
        expect(m.description.length).toBeGreaterThan(0);
      }
    });

    it('returns correct labels', () => {
      const modes = getAllModes();
      expect(modes[0].label).toBe('Standard');
      expect(modes[1].label).toBe('Developer');
      expect(modes[2].label).toBe('Professional');
      expect(modes[3].label).toBe('Kids & Students');
    });

    it('returns correct descriptions', () => {
      const modes = getAllModes();
      expect(modes[0].description).toBe('Balanced experience for everyday use');
      expect(modes[1].description).toContain('terminal');
      expect(modes[2].description).toContain('Document-focused');
      expect(modes[3].description).toContain('Simplified and safe');
    });
  });

  describe('getAppMode()', () => {
    it('returns "default" when localStorage is empty', () => {
      expect(getAppMode()).toBe('default');
    });

    it('returns stored mode when valid', () => {
      mockStorage['kairos-app-mode'] = 'developer';
      expect(getAppMode()).toBe('developer');
    });

    it('returns stored "professional" mode', () => {
      mockStorage['kairos-app-mode'] = 'professional';
      expect(getAppMode()).toBe('professional');
    });

    it('returns stored "kids" mode', () => {
      mockStorage['kairos-app-mode'] = 'kids';
      expect(getAppMode()).toBe('kids');
    });

    it('returns "default" for invalid stored value', () => {
      mockStorage['kairos-app-mode'] = 'invalid-mode';
      expect(getAppMode()).toBe('default');
    });

    it('returns "default" for empty string', () => {
      mockStorage['kairos-app-mode'] = '';
      expect(getAppMode()).toBe('default');
    });
  });

  describe('setAppMode()', () => {
    it('persists mode to localStorage', () => {
      setAppMode('developer');
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith('kairos-app-mode', 'developer');
    });

    it('applies mode to document element', () => {
      setAppMode('professional');
      expect(mockSetAttribute).toHaveBeenCalledWith('data-app-mode', 'professional');
    });

    it('dispatches app-mode-changed event', () => {
      setAppMode('kids');
      expect(mockDispatchEvent).toHaveBeenCalledTimes(1);
      const event = mockDispatchEvent.mock.calls[0][0];
      expect(event).toBeInstanceOf(CustomEvent);
      expect(event.type).toBe('app-mode-changed');
      expect(event.detail).toBe('kids');
    });

    it('sets all 4 modes correctly', () => {
      for (const mode of ['default', 'developer', 'professional', 'kids'] as const) {
        setAppMode(mode);
        expect(mockLocalStorage.setItem).toHaveBeenCalledWith('kairos-app-mode', mode);
        expect(mockSetAttribute).toHaveBeenCalledWith('data-app-mode', mode);
      }
    });
  });

  describe('applyMode()', () => {
    it('applies provided mode to document element', () => {
      applyMode('developer');
      expect(mockSetAttribute).toHaveBeenCalledWith('data-app-mode', 'developer');
    });

    it('falls back to getAppMode() when no argument provided', () => {
      mockStorage['kairos-app-mode'] = 'kids';
      applyMode();
      expect(mockSetAttribute).toHaveBeenCalledWith('data-app-mode', 'kids');
    });

    it('uses "default" when no argument and nothing stored', () => {
      applyMode();
      expect(mockSetAttribute).toHaveBeenCalledWith('data-app-mode', 'default');
    });
  });
});
