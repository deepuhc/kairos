import { describe, expect, it } from 'vitest';
import { installUsageActivityTracking, usagePingPayload } from '../services/usage-telemetry.js';

function fakeRuntime(visible = true, focused = true) {
  const listeners = new Map<string, EventListener>();
  const doc = {
    visibilityState: (visible ? 'visible' : 'hidden') as DocumentVisibilityState,
    hasFocus: () => focused,
    addEventListener: (_type: string, listener: EventListenerOrEventListenerObject) => {
      listeners.set(_type, listener as EventListener);
    },
    removeEventListener: (_type: string) => {
      listeners.delete(_type);
    },
  };
  return {
    win: { document: doc, location: { protocol: 'http:', hostname: 'localhost' } },
    dispatch: (type: string, event: Partial<Event> = {}) => {
      listeners.get(type)?.({ type, ...event } as Event);
    },
  };
}

describe('usage telemetry', () => {
  it('identifies Tauri windows as desktop usage with a Kairos version', () => {
    expect(usagePingPayload({
      __TAURI_INTERNALS__: {},
      location: { protocol: 'http:', hostname: '127.0.0.1' },
    })).toMatchObject({
      client_kind: 'desktop',
      kairos_version: expect.any(String),
      interaction: true,
    });
  });

  it('identifies ordinary browser windows as browser workflow usage', () => {
    expect(usagePingPayload({
      location: { protocol: 'http:', hostname: 'localhost' },
    })).toEqual({ client_kind: 'browser', interaction: true });
  });

  it('treats Tauri-local production origins as desktop usage', () => {
    expect(usagePingPayload({
      location: { protocol: 'http:', hostname: 'tauri.localhost' },
    }).client_kind).toBe('desktop');
  });

  it('sends usage only from real foreground interactions', () => {
    const runtime = fakeRuntime();
    let now = 10_000;
    let pings = 0;
    const cleanup = installUsageActivityTracking(() => { pings++; }, runtime.win, () => now);

    expect(pings).toBe(0);
    runtime.dispatch('click');
    expect(pings).toBe(1);

    now += 299_999;
    runtime.dispatch('keydown', { key: 'a' } as Partial<KeyboardEvent>);
    expect(pings).toBe(1);

    now += 1;
    runtime.dispatch('keydown', { key: 'Enter' } as Partial<KeyboardEvent>);
    expect(pings).toBe(2);

    cleanup();
    now += 300_000;
    runtime.dispatch('click');
    expect(pings).toBe(2);
  });

  it('ignores hidden, unfocused, shortcut, navigation, repeated-key, scroll, and touch interactions', () => {
    let pings = 0;
    const hidden = fakeRuntime(false, true);
    installUsageActivityTracking(() => { pings++; }, hidden.win, () => 1);
    hidden.dispatch('click');

    const unfocused = fakeRuntime(true, false);
    installUsageActivityTracking(() => { pings++; }, unfocused.win, () => 1);
    unfocused.dispatch('click');

    const focused = fakeRuntime(true, true);
    installUsageActivityTracking(() => { pings++; }, focused.win, () => 1);
    focused.dispatch('keydown', { key: 'a', repeat: true } as Partial<KeyboardEvent>);
    focused.dispatch('keydown', { key: 'f', metaKey: true } as Partial<KeyboardEvent>);
    focused.dispatch('keydown', { key: 'ArrowDown' } as Partial<KeyboardEvent>);
    focused.dispatch('wheel');
    focused.dispatch('touchstart');

    expect(pings).toBe(0);
  });
});
