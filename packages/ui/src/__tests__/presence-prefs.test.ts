import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getShowOnlineUsers,
  ONLINE_USERS_PREF_CHANGED,
  setShowOnlineUsers,
  SHOW_ONLINE_USERS_KEY,
} from '../services/presence-prefs.js';

function createLocalStorageStub() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  };
}

describe('presence preferences', () => {
  beforeEach(() => {
    (globalThis as any).localStorage = createLocalStorageStub();
    if (typeof CustomEvent === 'undefined') {
      (globalThis as any).CustomEvent = class TestCustomEvent<T = unknown> extends Event {
        detail: T;
        constructor(type: string, init?: CustomEventInit<T>) {
          super(type);
          this.detail = init?.detail as T;
        }
      };
    }
    (globalThis as any).window = { dispatchEvent: vi.fn() };
  });

  it('shows online users by default', () => {
    expect(getShowOnlineUsers()).toBe(true);
  });

  it('treats stored 0 as hidden', () => {
    localStorage.setItem(SHOW_ONLINE_USERS_KEY, '0');

    expect(getShowOnlineUsers()).toBe(false);
  });

  it('persists and broadcasts changes', () => {
    setShowOnlineUsers(false);

    expect(localStorage.getItem(SHOW_ONLINE_USERS_KEY)).toBe('0');
    expect(window.dispatchEvent).toHaveBeenCalledTimes(1);
    const event = vi.mocked(window.dispatchEvent).mock.calls[0][0] as CustomEvent<{ show: boolean }>;
    expect(event.type).toBe(ONLINE_USERS_PREF_CHANGED);
    expect(event.detail).toEqual({ show: false });
  });
});
