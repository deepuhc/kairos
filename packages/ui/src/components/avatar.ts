import { html, css, nothing } from 'lit';

// Shared avatar rendering: a deterministic gradient tile with the user's initials.
// Components set the size via --avatar-size / --avatar-font custom properties.

const AVATAR_PALETTE = [
  ['#7c3aed', '#a855f7'],
  ['#6366f1', '#818cf8'],
  ['#06b6d4', '#22d3ee'],
  ['#10b981', '#34d399'],
  ['#f59e0b', '#fbbf24'],
  ['#ec4899', '#f472b6'],
  ['#f97316', '#fb923c'],
  ['#8b5cf6', '#c084fc'],
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function avatarStyle(name: string): string {
  const [a, b] = AVATAR_PALETTE[hash(name) % AVATAR_PALETTE.length];
  return `background: linear-gradient(135deg, ${a}, ${b});`;
}

export function initials(name: string): string {
  const parts = name.replace(/[._-]/g, ' ').split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

// Avatar image slot — returns nothing by default (initials+gradient are the primary avatar).
// Components can override this to provide a custom image source.
export function avatarImg(_username: string) {
  return nothing;
}

// Base styles for a round avatar tile. Components set the size via the
// `--avatar-size` / `--avatar-font` custom properties.
export const avatarStyles = css`
  .avatar {
    position: relative;
    width: var(--avatar-size, 36px);
    height: var(--avatar-size, 36px);
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: var(--avatar-font, var(--font-size-base));
    font-weight: 600;
    color: white;
    flex-shrink: 0;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.3);
    overflow: hidden;
  }
  .avatar img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 50%;
  }
  .avatar img.broken { display: none; }
`;
