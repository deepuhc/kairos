import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const composer = readFileSync(path.join(__dirname, '..', 'components', 'agents-view.ts'), 'utf8');
const timeline = readFileSync(path.join(__dirname, '..', 'components', 'agents-timeline-render.ts'), 'utf8');

describe('voice input (dictation) is wired into the composer', () => {
  it('renders a mic button gated on speech support that toggles dictation', () => {
    // The dictation engine already existed; this guards that the button that
    // drives it is actually present in the composer (it was previously dropped).
    expect(composer).toContain('class="icon-btn mic ${this.listening ? \'listening\' : \'\'}"');
    expect(composer).toContain('@click=${() => this.toggleDictation()}');
    expect(composer).toMatch(/\$\{this\.speechSupported \? html`/);
  });

  it('labels dictation honestly about where audio is processed per browser', () => {
    expect(composer).toContain('private dictationTooltip()');
    expect(composer).toContain('Chrome sends audio to Google');
    expect(composer).toContain('on-device speech recognition');
  });

  it('stops dictation on disconnect and when navigating away', () => {
    expect(composer).toContain('if (this.listening) this.stopDictation();');
  });
});

describe('voice output (read aloud) is wired into the timeline', () => {
  it('exposes onSpeak/speakingItemId on the render ctx', () => {
    expect(timeline).toContain('onSpeak?:');
    expect(timeline).toContain('speakingItemId?: string | null;');
  });

  it('renders a speaker button only for assistant messages when onSpeak is set', () => {
    expect(timeline).toContain("role === 'assistant' && ctx.onSpeak");
    expect(timeline).toContain('class="msg-speak ${speaking ? \'speaking\' : \'\'}"');
    expect(timeline).toContain('@click=${() => ctx.onSpeak?.(item)}');
  });

  it('agents-view passes a speak handler only when TTS is supported', () => {
    expect(composer).toContain('onSpeak: this.speechOutputSupported ? (msg) => this.toggleSpeak(msg) : undefined');
    expect(composer).toContain('speakingItemId: this.speakingItemId');
    expect(composer).toContain('private toggleSpeak(');
  });

  it('stops speaking on disconnect and when navigating away', () => {
    expect(composer).toContain('if (this.speakingItemId) this.stopSpeaking();');
    expect(composer).toContain('!this.active && this.speakingItemId) this.stopSpeaking();');
  });
});
