# Plugins & Skills

A searchable, filterable catalog of everything installable through `kairos` — marketplace plugins and skills, public MATLAB/Simulink toolkits, and installs straight from a Git repo. Install, update, reinstall, pin versions, and star favorites with a click, and watch the command output stream live at the bottom of the window.

> **Why it exists.** The `kairos` CLI has a dozen install/update/uninstall incantations with inconsistent singular/plural nouns (`plugin install` but `apps status`) and version flags that are easy to forget. This tab replaces all of that guesswork with a point-and-click grid — and shows you what's installed, what's available, and what has an update, all at a glance.

- [Layout](#layout)
- [Item cards](#item-cards)
- [Installing](#installing)
- [Install options](#install-options)
- [Updates, favorites & sorting](#updates-favorites--sorting)
- [The live output panel](#the-live-output-panel)
- [How plugins and skills relate](#how-plugins-and-skills-relate)
- [Empty & error states](#empty--error-states)

---

## Layout

The catalog renders as a title row, a filter toolbar, and a grid of cards.

**Title row:**
- The page title (e.g. **Plugins & Skills**) and a live **result count** ("42 items") reflecting the current filter.
- A **Search…** box that filters live against each item's name and description.
- On the right: **Check updates** (on-demand update detection), a **Verbose** toggle (appends `--verbose` to install/update/uninstall commands — reads *"✓ Verbose"* when on), and **Refresh**.

**Filter toolbar:**
- **Status** — a segmented control: **All** / **Installed** / **Available**.
- **Source** *(when more than one source is present)* — **All sources** plus friendly labels like **Marketplace**, **MATLAB Toolkit**, **Simulink Toolkit**, **Desktop Team**.
- **Scope** — **User** / **Project**. Controls where installs land (`--scope user|project`; for skills, Project passes `--dir .` to install into the current project).
- **Sort** — **Installed first** (default), **Name (A–Z)**, or **Updates first**.

In the combined **Plugins & Skills** view, the grid is split into two sticky-headed sections: **Plugins** (*"Skill packs — install one to get all its skills"*) and **Standalone Skills** (*"Skills not bundled in any plugin"*).

---

## Item cards

Each card shows:

- **Name** and a **status badge** — exactly one of **Update** (amber), **Installed** (green), or **Available** (gray).
- A **Claude only** badge on plugins published only for Claude Code (other backends won't receive them).
- A **favorite star** (combined view only) to pin an item to the top.
- A **description** (clamped to three lines; hover for the full text).
- Category / source metadata, a **plugin: {name}** tag on skills that belong to a plugin, and a list of **child skills** on plugin cards.
- A **version line** when installed — showing `installed → latest` when a newer version is known.
- A **Repo** link to the source repository.

**Action buttons** depend on state:
- **Not installed** — a single **Install** button. (For public-toolkit skills that can only come via their parent plugin, this reads **Install plugin: {parent}** instead.)
- **Installed** — any of **Launch** (apps), **Start session** / **Terminal** (agent-capable apps), **Update** (when an update exists), **Reinstall** (passes `--force`), and **Uninstall**.

---

## Installing

The simplest path: find an item, click **Install**, and watch the [output panel](#the-live-output-panel) stream the result. When it finishes, the catalog reloads automatically so the card flips to **Installed**.

To **install from an arbitrary Git repo**, use the **Install from repo** bar at the top of the Plugins/Skills view: pick a backend (All / Claude), type a name and the repo URL, and click **Install** (or press Enter in the URL field).

---

## Install options

Two places let you refine an install:

**Global toggles** (in the toolbar) apply to every install: the **Scope** control (User/Project) and the **Verbose** toggle.

**Per-card "Install options"** (a disclosure on not-yet-installed cards) reveals, as applicable:
- **Backend selector** — **All** / **Claude** (plugins). Fixed to Claude for Claude-only items.
- **Repo URL** — install this item from an arbitrary git repo (`--repo`).
- **Version pin** *(apps)* — install a specific version, e.g. `2.1.146` (`--version`). Handy for rolling back.
- **Repo-version pin** *(plugins/skills)* — pin to a specific marketplace tag or ref (`--repo-version`).

**Reinstall** on an installed card passes `--force` to recover from a broken install without uninstalling first.

---

## Updates, favorites & sorting

- **Check updates** re-checks installed items; anything with a newer version flips to the amber **Update** badge, shows an `installed → latest` line, and surfaces an **Update** button.
- **Favorites** (the star, combined view only) pin items to the top regardless of sort. Pins are remembered locally.
- **Sort** offers **Installed first**, **Name (A–Z)**, and **Updates first**. Favorites always float above whichever sort is active.

---

## The live output panel

Install, update, uninstall, and reinstall operations stream their output into a panel docked to the bottom of the window.

- It **auto-expands** when an operation starts and streams lines as the backend emits them — **stdout in white, stderr in red** — auto-scrolling to the newest line.
- When the process ends it appends `--- Process exited with code N ---`.
- **Copy** grabs the full output to your clipboard; **Clear** empties it. Click the title bar to collapse or expand.
- After the operation completes, the catalog reloads so badges, versions, and buttons reflect the new state.

---

## How plugins and skills relate

A **plugin** is a pack of **skills**. In the combined view, skills bundled inside a plugin aren't listed separately — they roll up under their parent plugin's card (expand **"N skills included"** to see them). Only skills with no parent plugin appear under **Standalone Skills**.

Clicking a skill's **plugin: {name}** tag smooth-scrolls to that plugin's card and briefly flashes it, so you can see which pack a skill came from. And because some toolkit repos don't expose skills individually, installing such a skill actually installs its parent plugin — which is why the button reads **Install plugin: {parent}**.

---

## Empty & error states

- **Loading** — a skeleton grid on first load; cached data shows immediately and refreshes in the background.
- **Partial load failure** — a non-blocking banner: *"Couldn't load everything — showing what we could reach. Try Refresh."*
- **No matches** — *"Nothing matches"* with a **Clear filters** action.
- **Genuinely empty** — *"No {items} yet"* explaining nothing is published to your marketplaces.
