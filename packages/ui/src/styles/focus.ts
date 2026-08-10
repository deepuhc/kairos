import { css } from 'lit';

/**
 * Shared keyboard focus ring. Lit shadow roots don't inherit a global
 * `:focus-visible` rule, so each component spreads this fragment into its
 * `static styles` array and the selectors below match its own interactive
 * elements. `:focus-visible` keeps the ring for keyboard users only — mouse
 * clicks don't trigger it.
 *
 * Usage:
 *   static styles = [focusRing, css`...component styles...`];
 *
 * A single crisp accent outline with a small offset — `outline` follows
 * border-radius in modern browsers and doesn't reflow. Kept deliberately thin
 * so it reads as a highlight, not a doubled halo.
 *
 * Text fields (input/textarea/select) are deliberately EXCLUDED: they already
 * carry their own focus treatment (border-color shift + a soft accent glow), so
 * an added hard outline just double-rings them. This ring is only for controls
 * that previously had no keyboard-focus indicator at all — buttons, links, and
 * role-based interactive elements.
 */
export const focusRing = css`
  button:focus-visible,
  a:focus-visible,
  [tabindex]:focus-visible,
  [role='button']:focus-visible,
  [role='tab']:focus-visible,
  [role='radio']:focus-visible,
  [role='option']:focus-visible {
    outline: var(--focus-ring);
    outline-offset: var(--focus-ring-offset);
  }
`;
