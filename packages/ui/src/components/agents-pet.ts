import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { tooltip } from '../directives/tooltip.js';
import type { PetMood } from '../services/pet-mood.js';

const HIDDEN_KEY = 'kairos-agents:pet-hidden';

function isHidden(): boolean {
  try {
    return localStorage.getItem(HIDDEN_KEY) === '1';
  } catch {
    return false;
  }
}

function setHidden(hidden: boolean) {
  try {
    localStorage.setItem(HIDDEN_KEY, hidden ? '1' : '0');
  } catch { /* quota / disabled — ignore */ }
}

const MOOD_HINT: Record<PetMood, string> = {
  sleeping: 'All quiet — no agents running. Start one to begin.',
  idle: 'Standing by, ready when you are.',
  working: 'Agents are working…',
  celebrating: 'Done — a turn just finished!',
  worried: 'Action needed — an agent is waiting for input.',
};

// Waveform Companion — a music-inspired status visualizer.
// 5 bars animate like an equalizer, expressing agent mood through rhythm:
//   sleeping  → bars flat, muted gray
//   idle      → gentle low wave, accent color
//   working   → active bouncing, faster rhythm
//   celebrating → all bars high, emerald with sparkle burst
//   worried   → erratic pulse, red
// Distinct from Polygent's geometric-shape-with-eyes mascot pattern.

@customElement('kairos-agents-pet')
export class AgentsPet extends LitElement {
  @property({ type: String }) mood: PetMood = 'idle';
  @property({ type: Boolean, reflect: true }) collapsed = false;

  @state() private dismissed = isHidden();
  @state() private wiggling = false;

  static styles = css`
    :host { display: block; }
    .wrap {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 10px;
      border-top: 1px solid var(--border-subtle, var(--border));
    }
    :host([collapsed]) .wrap { justify-content: center; padding: 8px 0; }

    .stage {
      position: relative;
      width: 36px;
      height: 32px;
      flex: none;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      display: flex;
      align-items: flex-end;
      justify-content: center;
      gap: 3px;
    }

    /* Each bar is a rounded pill */
    .bar {
      width: 4px;
      border-radius: 2px;
      background: var(--accent, #D97706);
      transition: background 0.4s ease, height 0.3s ease;
      transform-origin: bottom center;
    }

    /* Base heights (idle) — a gentle wave pattern */
    .bar:nth-child(1) { height: 10px; }
    .bar:nth-child(2) { height: 16px; }
    .bar:nth-child(3) { height: 22px; }
    .bar:nth-child(4) { height: 16px; }
    .bar:nth-child(5) { height: 10px; }

    /* Sleeping — bars flatten to minimal, gray */
    .sleeping .bar {
      background: var(--neutral-gray);
      height: 4px;
    }

    /* Working — bars grow taller */
    .working .bar:nth-child(1) { height: 14px; }
    .working .bar:nth-child(2) { height: 24px; }
    .working .bar:nth-child(3) { height: 28px; }
    .working .bar:nth-child(4) { height: 20px; }
    .working .bar:nth-child(5) { height: 14px; }

    /* Celebrating — all bars max height, green */
    .celebrating .bar {
      background: var(--emerald, #10b981);
      height: 28px;
    }

    /* Worried — red, uneven */
    .worried .bar {
      background: var(--red, #ef4444);
    }
    .worried .bar:nth-child(1) { height: 20px; }
    .worried .bar:nth-child(2) { height: 8px; }
    .worried .bar:nth-child(3) { height: 24px; }
    .worried .bar:nth-child(4) { height: 6px; }
    .worried .bar:nth-child(5) { height: 18px; }

    .caption {
      font-size: var(--font-size-sm, 12px);
      color: var(--neutral-gray);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    :host([collapsed]) .caption { display: none; }

    .close {
      margin-left: auto;
      border: none;
      background: none;
      color: var(--neutral-gray);
      cursor: pointer;
      font-size: 14px;
      line-height: 1;
      padding: 2px 4px;
      border-radius: 4px;
      opacity: 0;
      transition: opacity 0.15s ease;
    }
    .wrap:hover .close { opacity: 0.7; }
    .close:hover { opacity: 1; color: var(--text); }
    :host([collapsed]) .close { display: none; }

    .show-btn {
      display: flex;
      align-items: center;
      gap: 6px;
      width: 100%;
      border: none;
      background: none;
      color: var(--neutral-gray);
      cursor: pointer;
      font-size: var(--font-size-sm, 12px);
      padding: 8px 10px;
      border-top: 1px solid var(--border-subtle, var(--border));
    }
    .show-btn:hover { color: var(--text); }

    /* Sparkles on celebrate */
    .spark {
      position: absolute;
      width: 4px;
      height: 4px;
      border-radius: 50%;
      background: var(--emerald, #10b981);
      opacity: 0;
      pointer-events: none;
    }

    @media (prefers-reduced-motion: no-preference) {
      /* Idle: gentle wave */
      .idle .bar { animation: wave 2.4s ease-in-out infinite; }
      .idle .bar:nth-child(1) { animation-delay: 0s; }
      .idle .bar:nth-child(2) { animation-delay: 0.2s; }
      .idle .bar:nth-child(3) { animation-delay: 0.4s; }
      .idle .bar:nth-child(4) { animation-delay: 0.6s; }
      .idle .bar:nth-child(5) { animation-delay: 0.8s; }

      /* Working: energetic bounce */
      .working .bar { animation: bounce 0.8s ease-in-out infinite; }
      .working .bar:nth-child(1) { animation-delay: 0s; }
      .working .bar:nth-child(2) { animation-delay: 0.1s; }
      .working .bar:nth-child(3) { animation-delay: 0.2s; }
      .working .bar:nth-child(4) { animation-delay: 0.3s; }
      .working .bar:nth-child(5) { animation-delay: 0.4s; }

      /* Sleeping: slow breathe */
      .sleeping .bar { animation: breathe 4s ease-in-out infinite; }
      .sleeping .bar:nth-child(2) { animation-delay: 0.3s; }
      .sleeping .bar:nth-child(3) { animation-delay: 0.6s; }
      .sleeping .bar:nth-child(4) { animation-delay: 0.9s; }
      .sleeping .bar:nth-child(5) { animation-delay: 1.2s; }

      /* Worried: erratic shake */
      .worried .bar { animation: erratic 0.6s ease-in-out infinite; }
      .worried .bar:nth-child(1) { animation-delay: 0s; }
      .worried .bar:nth-child(2) { animation-delay: 0.15s; }
      .worried .bar:nth-child(3) { animation-delay: 0.05s; }
      .worried .bar:nth-child(4) { animation-delay: 0.25s; }
      .worried .bar:nth-child(5) { animation-delay: 0.1s; }

      /* Celebrating: burst up then settle */
      .celebrating .bar { animation: celebrate 1s ease-out; }
      .celebrating .bar:nth-child(1) { animation-delay: 0s; }
      .celebrating .bar:nth-child(2) { animation-delay: 0.08s; }
      .celebrating .bar:nth-child(3) { animation-delay: 0.16s; }
      .celebrating .bar:nth-child(4) { animation-delay: 0.24s; }
      .celebrating .bar:nth-child(5) { animation-delay: 0.32s; }

      .celebrating .spark { animation: pop 1.2s ease-out forwards; }

      /* Wiggle on poke */
      .wiggle .bar { animation: wiggle-bar 0.4s ease-in-out; }
    }

    @keyframes wave {
      0%, 100% { transform: scaleY(1); }
      50% { transform: scaleY(0.6); }
    }
    @keyframes bounce {
      0%, 100% { transform: scaleY(1); }
      50% { transform: scaleY(0.4); }
    }
    @keyframes breathe {
      0%, 100% { transform: scaleY(1); opacity: 0.5; }
      50% { transform: scaleY(1.5); opacity: 0.8; }
    }
    @keyframes erratic {
      0%, 100% { transform: scaleY(1); }
      25% { transform: scaleY(1.5); }
      50% { transform: scaleY(0.5); }
      75% { transform: scaleY(1.3); }
    }
    @keyframes celebrate {
      0% { transform: scaleY(0.3); }
      40% { transform: scaleY(1.3); }
      70% { transform: scaleY(0.9); }
      100% { transform: scaleY(1); }
    }
    @keyframes wiggle-bar {
      0%, 100% { transform: scaleY(1) rotate(0deg); }
      25% { transform: scaleY(1.2) rotate(-3deg); }
      75% { transform: scaleY(0.8) rotate(3deg); }
    }
    @keyframes pop {
      0% { opacity: 0; transform: translate(0, 0) scale(0.4); }
      30% { opacity: 1; }
      100% { opacity: 0; transform: translate(var(--dx, 0), var(--dy, -14px)) scale(1); }
    }
  `;

  private toggleHidden(hidden: boolean) {
    this.dismissed = hidden;
    setHidden(hidden);
  }

  private poke() {
    this.dispatchEvent(new CustomEvent('pet-poke', { bubbles: true, composed: true }));
    if (this.wiggling) return;
    this.wiggling = true;
    setTimeout(() => { this.wiggling = false; }, 420);
  }

  render() {
    if (this.dismissed) {
      return html`<button class="show-btn" @click=${() => this.toggleHidden(false)}
        ${tooltip('Show status')}>♪ Show status</button>`;
    }
    const cls = `${this.mood}${this.wiggling ? ' wiggle' : ''}`;
    const sparks = this.mood === 'celebrating'
      ? [
          { dx: '-10px', dy: '-14px', left: '2px', top: '0px', delay: '0s' },
          { dx: '10px', dy: '-12px', left: '28px', top: '2px', delay: '0.15s' },
          { dx: '0px', dy: '-18px', left: '14px', top: '-2px', delay: '0.3s' },
        ]
      : [];
    return html`
      <div class="wrap ${cls}">
        <div class="stage" @click=${this.poke} ${tooltip(MOOD_HINT[this.mood])}
          role="img" aria-label=${MOOD_HINT[this.mood]}>
          <span class="bar"></span>
          <span class="bar"></span>
          <span class="bar"></span>
          <span class="bar"></span>
          <span class="bar"></span>
          ${sparks.map((s) => html`<span class="spark"
            style="left:${s.left};top:${s.top};--dx:${s.dx};--dy:${s.dy};animation-delay:${s.delay}"></span>`)}
        </div>
        <span class="caption">${MOOD_HINT[this.mood]}</span>
        <button class="close" @click=${() => this.toggleHidden(true)}
          ${tooltip('Hide status')} aria-label="Hide status">×</button>
      </div>
    `;
  }
}
