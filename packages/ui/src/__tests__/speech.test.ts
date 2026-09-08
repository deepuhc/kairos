import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { markdownToSpeech, speak, stopSpeaking, speechOutputSupported } from '../services/speech.js';

describe('markdownToSpeech', () => {
  it('drops fenced code blocks, keeping surrounding prose', () => {
    const out = markdownToSpeech('Here is the fix:\n\n```ts\nconst x = 1;\n```\n\nDone.');
    expect(out).toContain('Here is the fix');
    expect(out).toContain('Done.');
    expect(out).toContain('(code block)');
    expect(out).not.toContain('const x = 1');
    expect(out).not.toContain('```');
  });

  it('reads link and image labels, not their URLs', () => {
    expect(markdownToSpeech('See [the docs](https://example.com/guide) now'))
      .toBe('See the docs now');
    expect(markdownToSpeech('![a red cube](https://cdn/x.png) shown'))
      .toBe('a red cube shown');
  });

  it('strips inline emphasis and code markers but keeps the words', () => {
    expect(markdownToSpeech('This is **bold** and *italic* and `code`.'))
      .toBe('This is bold and italic and code.');
  });

  it('removes heading, blockquote, and list markers at line starts', () => {
    const out = markdownToSpeech('# Title\n\n> a quote\n\n- one\n- two\n\n1. first');
    expect(out).not.toMatch(/^#/m);
    expect(out).not.toMatch(/^>/m);
    expect(out).not.toMatch(/^[-*+]\s/m);
    expect(out).not.toMatch(/^\d+\.\s/m);
    expect(out).toContain('Title');
    expect(out).toContain('a quote');
    expect(out).toContain('one');
    expect(out).toContain('first');
  });

  it('replaces bare URLs with the word "link"', () => {
    expect(markdownToSpeech('Open https://example.com/x?y=1 please')).toBe('Open link please');
  });

  it('collapses whitespace and returns empty for blank input', () => {
    expect(markdownToSpeech('   ')).toBe('');
    expect(markdownToSpeech('a\n\n\n\nb')).toBe('a\nb');
  });
});

describe('speak / stopSpeaking (browser guard)', () => {
  const realWindow = (globalThis as any).window;
  const realUtterance = (globalThis as any).SpeechSynthesisUtterance;
  let spoken: any[];
  let cancelled: number;

  beforeEach(() => {
    spoken = [];
    cancelled = 0;
    (globalThis as any).SpeechSynthesisUtterance = class {
      text: string; lang = ''; onend: any = null; onerror: any = null;
      constructor(t: string) { this.text = t; }
    };
    (globalThis as any).window = {
      speechSynthesis: {
        speak: (u: any) => { spoken.push(u); },
        cancel: () => { cancelled++; },
      },
    };
  });

  afterEach(() => {
    if (realWindow === undefined) delete (globalThis as any).window;
    else (globalThis as any).window = realWindow;
    if (realUtterance === undefined) delete (globalThis as any).SpeechSynthesisUtterance;
    else (globalThis as any).SpeechSynthesisUtterance = realUtterance;
  });

  it('reports supported when the API is present', () => {
    expect(speechOutputSupported()).toBe(true);
  });

  it('cancels any prior utterance then speaks the prose form', () => {
    speak('Say **hi**');
    expect(cancelled).toBe(1); // cancel-before-speak so requests do not queue
    expect(spoken).toHaveLength(1);
    expect(spoken[0].text).toBe('Say hi');
  });

  it('does not speak empty/blank content but still settles onEnd', () => {
    const onEnd = vi.fn();
    speak('   ', { onEnd });
    expect(spoken).toHaveLength(0);
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it('stopSpeaking cancels synthesis', () => {
    stopSpeaking();
    expect(cancelled).toBe(1);
  });
});

describe('speak (unsupported env)', () => {
  it('is a no-op that still calls onEnd when speechSynthesis is absent', () => {
    const realWindow = (globalThis as any).window;
    delete (globalThis as any).window;
    try {
      const onEnd = vi.fn();
      expect(speechOutputSupported()).toBe(false);
      speak('anything', { onEnd });
      expect(onEnd).toHaveBeenCalledOnce();
    } finally {
      if (realWindow !== undefined) (globalThis as any).window = realWindow;
    }
  });
});
