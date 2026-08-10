// Hand-authored inline SVG illustrations for the help overlay. The repo ships
// no raster/vector assets — every icon is inlined — so these are Lit `svg`
// template literals too. They stay abstract and geometric (rounded rects,
// nodes/edges, cursors, gears) and draw only from theme.css tokens via inline
// `style` CSS vars, so they adapt to light/dark and match the blue-accent,
// near-monochrome design language. `currentColor` carries the accent from the
// element's `color`; secondary tones reference --w* / --accent-a* directly.

import { svg } from 'lit';

// Wide banner for the top of the modal: an agent "cockpit" — a chat surface
// with streaming lines, a plan checklist, and a couple of live nodes.
export const heroArt = svg`
  <svg viewBox="0 0 260 120" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect x="8" y="12" width="150" height="96" rx="8" style="fill: var(--w4); stroke: var(--glass-border);" stroke-width="1"/>
    <rect x="20" y="26" width="80" height="7" rx="3.5" style="fill: var(--w15);"/>
    <rect x="20" y="40" width="118" height="6" rx="3" style="fill: var(--w8);"/>
    <rect x="20" y="52" width="104" height="6" rx="3" style="fill: var(--w8);"/>
    <rect x="20" y="70" width="86" height="26" rx="6" style="fill: var(--accent-a10); stroke: var(--accent-a25);" stroke-width="1"/>
    <rect x="30" y="78" width="9" height="9" rx="2" fill="currentColor"/>
    <rect x="46" y="79" width="52" height="4" rx="2" style="fill: var(--accent-a50);"/>
    <rect x="46" y="87" width="38" height="4" rx="2" style="fill: var(--accent-a35);"/>
    <rect x="172" y="20" width="80" height="40" rx="8" style="fill: var(--w4); stroke: var(--glass-border);" stroke-width="1"/>
    <circle cx="186" cy="34" r="4" fill="currentColor"/>
    <rect x="196" y="31" width="46" height="5" rx="2.5" style="fill: var(--w15);"/>
    <rect x="196" y="42" width="34" height="4" rx="2" style="fill: var(--w8);"/>
    <rect x="172" y="70" width="80" height="38" rx="8" style="fill: var(--w4); stroke: var(--glass-border);" stroke-width="1"/>
    <path d="M182 82l4 4 7-8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="198" y="80" width="44" height="5" rx="2.5" style="fill: var(--w12);"/>
    <path d="M182 96l4 4 7-8" style="stroke: var(--w25);" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="198" y="94" width="34" height="5" rx="2.5" style="fill: var(--w8);"/>
    <path d="M158 60h14" style="stroke: var(--accent-a35);" stroke-width="1.5" stroke-dasharray="2 3" stroke-linecap="round"/>
  </svg>`;

// Per-tab card art. viewBox 0 0 72 52 for a consistent footprint.
const frame = (inner: unknown) => svg`
  <svg viewBox="0 0 72 52" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${inner}</svg>`;

// Agents: three chat/agent nodes wired to a running turn.
export const agentsArt = frame(svg`
  <rect x="6" y="8" width="36" height="36" rx="7" style="fill: var(--w4); stroke: var(--glass-border);" stroke-width="1"/>
  <rect x="12" y="16" width="20" height="5" rx="2.5" style="fill: var(--w15);"/>
  <rect x="12" y="25" width="24" height="4" rx="2" style="fill: var(--w8);"/>
  <rect x="12" y="33" width="16" height="4" rx="2" style="fill: var(--accent-a50);"/>
  <circle cx="56" cy="16" r="5" fill="currentColor"/>
  <circle cx="56" cy="34" r="5" style="fill: var(--accent-a35);"/>
  <path d="M42 20l9 -3M42 32l9 3" style="stroke: var(--accent-a35);" stroke-width="1.5" stroke-linecap="round"/>`);

// Plugins & Skills: a grid of installable tiles, one accented.
export const pluginsArt = frame(svg`
  <rect x="8" y="8" width="24" height="16" rx="4" style="fill: var(--accent-a10); stroke: var(--accent-a25);" stroke-width="1"/>
  <rect x="40" y="8" width="24" height="16" rx="4" style="fill: var(--w5); stroke: var(--glass-border);" stroke-width="1"/>
  <rect x="8" y="28" width="24" height="16" rx="4" style="fill: var(--w5); stroke: var(--glass-border);" stroke-width="1"/>
  <rect x="40" y="28" width="24" height="16" rx="4" style="fill: var(--w5); stroke: var(--glass-border);" stroke-width="1"/>
  <path d="M14 16h12M20 10v12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`);

// Customize: a slider control over stacked config rows.
export const customizeArt = frame(svg`
  <rect x="8" y="10" width="56" height="6" rx="3" style="fill: var(--w8);"/>
  <circle cx="26" cy="13" r="6" fill="currentColor"/>
  <rect x="8" y="24" width="56" height="5" rx="2.5" style="fill: var(--w6);"/>
  <circle cx="48" cy="26.5" r="5.5" style="fill: var(--accent-a50);"/>
  <rect x="8" y="36" width="40" height="5" rx="2.5" style="fill: var(--w6);"/>
  <circle cx="18" cy="38.5" r="5.5" style="fill: var(--w25);"/>`);

// Sessions: a stacked history of past runs with a timeline spine.
export const sessionsArt = frame(svg`
  <path d="M14 10v32" style="stroke: var(--w15);" stroke-width="1.5" stroke-linecap="round"/>
  <circle cx="14" cy="14" r="3.5" fill="currentColor"/>
  <circle cx="14" cy="26" r="3.5" style="fill: var(--w25);"/>
  <circle cx="14" cy="38" r="3.5" style="fill: var(--w25);"/>
  <rect x="24" y="11" width="40" height="6" rx="3" style="fill: var(--w12);"/>
  <rect x="24" y="23" width="34" height="6" rx="3" style="fill: var(--w8);"/>
  <rect x="24" y="35" width="38" height="6" rx="3" style="fill: var(--w8);"/>`);

// VSCode: an editor window with a launch cursor.
export const vscodeArt = frame(svg`
  <rect x="8" y="9" width="48" height="34" rx="6" style="fill: var(--w4); stroke: var(--glass-border);" stroke-width="1"/>
  <path d="M8 17h48" style="stroke: var(--glass-border);" stroke-width="1"/>
  <circle cx="14" cy="13" r="1.5" style="fill: var(--w25);"/>
  <rect x="14" y="23" width="14" height="4" rx="2" style="fill: var(--accent-a50);"/>
  <rect x="14" y="31" width="26" height="4" rx="2" style="fill: var(--w10);"/>
  <path d="M44 30l16 8-6 2 4 7-4 2-4-7-4 4z" fill="currentColor" style="stroke: var(--surface-modal);" stroke-width="1.5" stroke-linejoin="round"/>`);

// kairos settings: a gear over config rows (settings + diagnostics).
export const settingsArt = frame(svg`
  <rect x="8" y="30" width="30" height="5" rx="2.5" style="fill: var(--w8);"/>
  <rect x="8" y="40" width="22" height="5" rx="2.5" style="fill: var(--w6);"/>
  <circle cx="48" cy="22" r="13" style="fill: var(--accent-a10); stroke: var(--accent-a25);" stroke-width="1"/>
  <path d="M48 13v-4M48 35v-4M57 22h4M35 22h4M54.4 15.6l2.8-2.8M38.8 31.2l2.8-2.8M54.4 28.4l2.8 2.8M38.8 12.8l2.8 2.8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <circle cx="48" cy="22" r="5" fill="currentColor"/>`);

// --- Power-user tip card art (same footprint/style as the tab art). ---

// Isolated git worktrees: a trunk branching to an isolated accented node.
export const worktreeArt = frame(svg`
  <path d="M20 40V16" style="stroke: var(--w15);" stroke-width="2" stroke-linecap="round"/>
  <path d="M20 22c0 8 8 6 8 14" style="stroke: var(--accent-a35);" stroke-width="2" stroke-linecap="round" fill="none"/>
  <circle cx="20" cy="14" r="4" style="fill: var(--w25);"/>
  <circle cx="20" cy="40" r="4" style="fill: var(--w25);"/>
  <circle cx="28" cy="40" r="5" fill="currentColor"/>
  <rect x="42" y="14" width="22" height="26" rx="5" style="fill: var(--accent-a10); stroke: var(--accent-a25);" stroke-width="1" stroke-dasharray="3 3"/>
  <path d="M33 27h9" style="stroke: var(--accent-a35);" stroke-width="1.5" stroke-dasharray="2 3" stroke-linecap="round"/>`);

// Prompt checkpoints: a restore arrow circling a snapshot dot.
export const checkpointArt = frame(svg`
  <circle cx="36" cy="26" r="16" style="fill: none; stroke: var(--w15);" stroke-width="2" stroke-dasharray="4 4"/>
  <path d="M22 20a16 16 0 0 1 28 2" style="stroke: currentColor; fill: none;" stroke-width="2" stroke-linecap="round"/>
  <path d="M18 14l4 6-7 1z" fill="currentColor"/>
  <circle cx="36" cy="26" r="5" style="fill: var(--accent-a50);"/>
  <circle cx="36" cy="26" r="2" fill="currentColor"/>`);

// Review panel: two side-by-side diff panes, one line accented.
export const reviewArt = frame(svg`
  <rect x="8" y="10" width="26" height="32" rx="5" style="fill: var(--w4); stroke: var(--glass-border);" stroke-width="1"/>
  <rect x="38" y="10" width="26" height="32" rx="5" style="fill: var(--w4); stroke: var(--glass-border);" stroke-width="1"/>
  <rect x="13" y="17" width="16" height="3.5" rx="1.75" style="fill: var(--w10);"/>
  <rect x="13" y="24" width="16" height="3.5" rx="1.75" style="fill: var(--accent-a35);"/>
  <rect x="13" y="31" width="12" height="3.5" rx="1.75" style="fill: var(--w10);"/>
  <rect x="43" y="17" width="16" height="3.5" rx="1.75" style="fill: var(--w10);"/>
  <rect x="43" y="24" width="16" height="3.5" rx="1.75" fill="currentColor"/>
  <rect x="43" y="31" width="12" height="3.5" rx="1.75" style="fill: var(--w10);"/>`);

// Behind the Scenes: paired protocol nodes wired to a rendered frame.
export const inspectorArt = frame(svg`
  <rect x="8" y="12" width="24" height="28" rx="4" style="fill: var(--w4); stroke: var(--glass-border);" stroke-width="1"/>
  <path d="M12 18h4M12 24h4M12 30h4" style="stroke: var(--accent-a50);" stroke-width="2" stroke-linecap="round"/>
  <path d="M20 18h8M20 24h6M20 30h9" style="stroke: var(--w15);" stroke-width="2" stroke-linecap="round"/>
  <path d="M32 26h8" style="stroke: var(--accent-a35);" stroke-width="1.5" stroke-dasharray="2 3" stroke-linecap="round"/>
  <rect x="42" y="16" width="22" height="20" rx="5" style="fill: var(--accent-a10); stroke: var(--accent-a25);" stroke-width="1"/>
  <path d="M47 26l3 3 6-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`);

// Modes, models & effort: compact dropdown chips.
export const modesArt = frame(svg`
  <rect x="10" y="12" width="34" height="9" rx="4.5" style="fill: var(--accent-a10); stroke: var(--accent-a25);" stroke-width="1"/>
  <circle cx="38" cy="16.5" r="5" fill="currentColor"/>
  <rect x="10" y="28" width="34" height="9" rx="4.5" style="fill: var(--w6);"/>
  <circle cx="16" cy="32.5" r="5" style="fill: var(--w25);"/>
  <path d="M56 14v24" style="stroke: var(--w15);" stroke-width="2" stroke-linecap="round"/>
  <circle cx="56" cy="22" r="4" style="fill: var(--accent-a50);"/>`);

// MCP quick-add presets: a plug clicking into an accented socket tile.
export const mcpArt = frame(svg`
  <rect x="34" y="12" width="30" height="28" rx="6" style="fill: var(--accent-a10); stroke: var(--accent-a25);" stroke-width="1"/>
  <path d="M45 22v-6M53 22v-6" style="stroke: var(--w25);" stroke-width="2" stroke-linecap="round"/>
  <rect x="43" y="22" width="12" height="9" rx="2" fill="currentColor"/>
  <path d="M49 31v4" style="stroke: currentColor;" stroke-width="2" stroke-linecap="round"/>
  <path d="M8 26h18" style="stroke: var(--accent-a35);" stroke-width="1.5" stroke-linecap="round"/>
  <path d="M22 21l6 5-6 5" style="stroke: var(--accent-a35); fill: none;" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`);

// Per-agent auth mode: a key toggling against a shielded credential store.
export const authArt = frame(svg`
  <path d="M18 22a6 6 0 1 1 4 10l-8 0" style="stroke: currentColor; fill: none;" stroke-width="2" stroke-linecap="round"/>
  <circle cx="18" cy="28" r="2.5" fill="currentColor"/>
  <path d="M14 32v4M20 32v3" style="stroke: currentColor;" stroke-width="2" stroke-linecap="round"/>
  <path d="M48 11l14 5v9c0 8-6 13-14 16-8-3-14-8-14-16v-9z" style="fill: var(--accent-a10); stroke: var(--accent-a25);" stroke-width="1"/>
  <path d="M43 26l3 3 7-8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`);

// Resume anywhere: a session history spine with a replay arrow.
export const resumeArt = frame(svg`
  <path d="M14 12v28" style="stroke: var(--w15);" stroke-width="1.5" stroke-linecap="round"/>
  <circle cx="14" cy="15" r="3.5" style="fill: var(--w25);"/>
  <circle cx="14" cy="26" r="3.5" style="fill: var(--w25);"/>
  <circle cx="14" cy="37" r="4" fill="currentColor"/>
  <rect x="24" y="12" width="30" height="6" rx="3" style="fill: var(--w10);"/>
  <rect x="24" y="23" width="24" height="6" rx="3" style="fill: var(--w8);"/>
  <path d="M24 37h22a6 6 0 0 0 0-12h-4" style="stroke: currentColor; fill: none;" stroke-width="2" stroke-linecap="round"/>
  <path d="M46 30l-5 5 5 5" style="stroke: currentColor; fill: none;" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`);

// Wide callout art for the "Getting help" block — a speech bubble with a spark.
export const helpArt = svg`
  <svg viewBox="0 0 96 72" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect x="12" y="14" width="60" height="40" rx="10" style="fill: var(--w4); stroke: var(--glass-border);" stroke-width="1"/>
    <path d="M28 54l-2 10 14-10z" style="fill: var(--w4); stroke: var(--glass-border);" stroke-width="1"/>
    <rect x="24" y="26" width="36" height="5" rx="2.5" style="fill: var(--w12);"/>
    <rect x="24" y="37" width="26" height="5" rx="2.5" style="fill: var(--w8);"/>
    <path d="M76 20l2.5 6 6 2.5-6 2.5-2.5 6-2.5-6-6-2.5 6-2.5z" fill="currentColor"/>
  </svg>`;
