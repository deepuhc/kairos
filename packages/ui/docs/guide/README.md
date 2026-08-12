# Kairos Guides & Docs

The in-depth, end-user reference for **using** Kairos — every tab, every feature, what it is, why it exists, and how to use it. If you've just launched the app and want the fast path, start with **[Getting Started](../getting-started.md)** instead.

## The tabs

| Guide | What's inside |
|---|---|
| **[Agents](agents.md)** | The agentic coding cockpit: starting sessions, the composer, session controls, the review/summary/plan panels, the tiered permission model, worktrees, prompt Edit/Fork rewind, sub-agents, stall recovery, and running many agents at once. |
| **[Agents: types, setup & security](agents-and-setup.md)** | What the different agents are (built-in vs. custom, cloud vs. local), how to connect your own agent, a walkthrough for a local/offline agent, and what the working-directory sandbox does and doesn't protect. |
| **[Plugins & Skills](plugins-and-skills.md)** | The installable catalog: searching and filtering, per-item cards, install options (scope, backend, version pinning, install-from-repo), updates, favorites, and the live output panel. |
| **[Customize](customize.md)** | Standing context for every agent: Rules, Prompts, Roles, MCP Servers, and Hooks. |
| **[History](history.md)** | Browse, filter, search, resume, and export every past coding session. |
| **[VSCode](vscode.md)** | Workspace discovery, configuration, and launching VSCode. |
| **[kairos settings](kairos-settings.md)** | Config keys, feature flags, updates, security/vault, and the Doctor diagnostics. |
| **[Account & Notifications](account-and-notifications.md)** | The avatar menu, login/session state, Kairos desktop/source update cues, and the chime/tab-badge notification system. |
| **[Team Orchestrator & Activity View](team-orchestrator.md)** | The autonomous delivery orchestrator, the seven built-in team-role personas, artifact contracts, the liveness watchdog, and the developer-mode Activity tab. |

## Conventions used across these guides

A few patterns show up everywhere in Kairos — learn them once:

- **Save feedback.** Editors flash a green **✓ Saved** for a moment after saving, and show an **"Unsaved changes"** hint while your draft differs from what's stored. The **Save** / **Create** button is disabled until the required fields are filled.
- **Arm-then-confirm delete.** Destructive buttons (Delete, Remove, Uninstall) usually take two clicks: the first arms the button, the second confirms. Genuinely irreversible or high-impact actions, such as deleting a transcript or editing/forking from an earlier prompt, use a full confirmation dialog instead.
- **Scope.** Some settings are **global** (apply everywhere) and some are **project** (scoped to one workspace). Where it matters, a scope toggle makes the distinction explicit.
- **Bring your own key.** Configure your provider API key or an auth proxy once, and all agents authenticate automatically.
- **Press `?` anywhere** to open the in-app help drawer.
