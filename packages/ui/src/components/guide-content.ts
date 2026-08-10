// The in-app "Full guide" reader is backed by the very same Markdown files that
// ship in docs/ — imported verbatim via Vite's `?raw` loader so there is exactly
// one source of truth for the end-user documentation (on disk / on GitHub and in
// the Help & guide drawer). Add a doc here and it appears in the reader's table
// of contents automatically.

import whyKairos from '../../docs/why-kairos.md?raw';
import gettingStarted from '../../docs/getting-started.md?raw';
import agents from '../../docs/guide/agents.md?raw';
import agentsAndSetup from '../../docs/guide/agents-and-setup.md?raw';
import pluginsAndSkills from '../../docs/guide/plugins-and-skills.md?raw';
import customize from '../../docs/guide/customize.md?raw';
import history from '../../docs/guide/history.md?raw';
import vscode from '../../docs/guide/vscode.md?raw';
import kairosSettings from '../../docs/guide/kairos-settings.md?raw';
import accountAndNotifications from '../../docs/guide/account-and-notifications.md?raw';

export interface GuideDoc {
  /** Stable id — matches the source filename (sans extension). */
  id: string;
  /** Section label shown in the reader's table of contents. */
  title: string;
  /** One-line hint under the title in the TOC. */
  blurb: string;
  /** Raw Markdown source. */
  markdown: string;
  /** TOC grouping. */
  group: 'Start here' | 'The tabs' | 'Beyond the tabs';
}

export const GUIDE_DOCS: GuideDoc[] = [
  {
    id: 'why-kairos',
    title: 'Why Kairos',
    blurb: 'Why it was built — and how.',
    markdown: whyKairos,
    group: 'Start here',
  },
  {
    id: 'getting-started',
    title: 'Getting Started',
    blurb: 'From a blank screen to your first agent in 5 minutes.',
    markdown: gettingStarted,
    group: 'Start here',
  },
  {
    id: 'agents',
    title: 'Agents',
    blurb: 'The agentic coding cockpit — the headline feature.',
    markdown: agents,
    group: 'The tabs',
  },
  {
    id: 'agents-and-setup',
    title: 'Agents: types, setup & security',
    blurb: 'Agent types, connecting your own, local/offline setup, and the sandbox.',
    markdown: agentsAndSetup,
    group: 'The tabs',
  },
  {
    id: 'plugins-and-skills',
    title: 'Plugins & Skills',
    blurb: 'The installable catalog.',
    markdown: pluginsAndSkills,
    group: 'The tabs',
  },
  {
    id: 'customize',
    title: 'Customize',
    blurb: 'Rules, prompts, roles, MCP servers, and hooks.',
    markdown: customize,
    group: 'The tabs',
  },
  {
    id: 'history',
    title: 'History',
    blurb: 'Browse, search, and resume past sessions.',
    markdown: history,
    group: 'The tabs',
  },
  {
    id: 'vscode',
    title: 'VSCode',
    blurb: 'Discover and launch workspaces.',
    markdown: vscode,
    group: 'The tabs',
  },
  {
    id: 'kairos-settings',
    title: 'kairos settings',
    blurb: 'Config, feature flags, updates, security, Doctor.',
    markdown: kairosSettings,
    group: 'The tabs',
  },
  {
    id: 'account-and-notifications',
    title: 'Account & Notifications',
    blurb: 'The avatar menu and the notification cues.',
    markdown: accountAndNotifications,
    group: 'Beyond the tabs',
  },
];

const DOC_BY_ID = new Map(GUIDE_DOCS.map((d) => [d.id, d]));

export function getGuideDoc(id: string): GuideDoc | undefined {
  return DOC_BY_ID.get(id);
}

/** The reader's TOC groups, in display order, each with its docs. */
export const GUIDE_GROUPS: Array<{ label: GuideDoc['group']; docs: GuideDoc[] }> = (() => {
  const order: GuideDoc['group'][] = ['Start here', 'The tabs', 'Beyond the tabs'];
  return order.map((label) => ({ label, docs: GUIDE_DOCS.filter((d) => d.group === label) }));
})();

// GitHub-flavored heading slug: lowercase, drop anything that isn't a word
// char / space / hyphen, then spaces → hyphens (runs of spaces become runs of
// hyphens, matching GitHub — so "Doctor / Diagnostics" → "doctor--diagnostics").
// The docs' own in-page TOC links rely on exactly this slug.
export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s/g, '-');
}

/**
 * Resolve a Markdown link `href` to either an in-reader doc jump or an external
 * URL. Returns:
 *  - `{ kind: 'doc', id, hash }`  — a link to another guide doc (navigate in-app)
 *  - `{ kind: 'anchor', hash }`   — a same-page section link (scroll)
 *  - `{ kind: 'external', href }` — anything else (open in a new tab)
 *  - `null`                        — a `.md` link we don't have a doc for (dead)
 */
export function resolveGuideHref(
  href: string,
): { kind: 'doc'; id: string; hash: string | null } | { kind: 'anchor'; hash: string } | { kind: 'external'; href: string } | null {
  if (!href) return { kind: 'external', href };
  // Pure in-page anchor.
  if (href.startsWith('#')) return { kind: 'anchor', hash: href.slice(1) };
  // A Markdown doc link, possibly with a directory prefix and/or a #hash.
  const mdMatch = href.match(/([^/\\]+)\.md(#(.+))?$/i);
  if (mdMatch) {
    const id = mdMatch[1].toLowerCase();
    const hash = mdMatch[3] ?? null;
    if (DOC_BY_ID.has(id)) return { kind: 'doc', id, hash };
    return null; // e.g. the project README or the guide index — no in-app doc
  }
  return { kind: 'external', href };
}
