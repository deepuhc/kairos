# Getting Started with Kairos

> **You've launched the Kairos desktop app. Now what?**
>
> This guide gets you from a blank screen to your first working agent in about five minutes, then gives you a one-paragraph tour of every tab so you know where to go next. It assumes Kairos is already installed and running — if it isn't, see the [README](../README.md) for setup.

---

## What Kairos is (in one breath)

Kairos is a desktop home for **agentic coding**. Its headline is the **Agents** tab: a live cockpit where you talk to Claude, Gemini, Codex, and other coding agents, watch them think, edit files, and run commands in real time — and keep every change on a leash. Wrapped around that is a point-and-click layer over everything else the `kairos` CLI can do: installing tools, browsing past sessions, launching VSCode, editing config, and running diagnostics.

Configure your API key or auth proxy once, and agents launch with credentials injected automatically.

---

## Your first agent session in 5 minutes

### 1. Open the Agents tab

It's the default landing view, so you're probably already there. If not, click **Agents** in the top navigation bar.

### 2. Start a session

Click **New session** in the left sidebar. A picker appears. You only need to make two choices:

- **Agent** — for normal work, pick **Claude**, **Codex**, or **Gemini**. The picker also lists GitHub Copilot, Goose, OpenCode, Mistral Vibe, Kiro, and any custom agents you've added; local/offline agents are intended for ACP compatibility testing, not general use. If a managed-app chip says *"not installed,"* that agent's app needs `kairos apps install <id>` first.
- **Working directory** — pick a discovered VS Code workspace from the dropdown, or type an absolute path like `/Users/you/projects/my-app`. This is the folder the agent can read, edit, and run commands in — nothing outside it.

Everything else on the picker is optional (a session name, a persona/role, running in an isolated git branch). Leave them alone for now.

Click **Start session**.

> **First launch may take a minute.** The very first time you use Claude or Codex, Kairos downloads a small adapter through `npm`/`npx`, so Node.js/npm must be on your `PATH`. You'll see *"Connecting…"* with a hint. It's fast on every launch after that.

### 3. Type what you want done

The composer sits at the bottom. Type a request — *"Explain what this project does and how it's structured"* is a great first prompt — and press **Enter**.

Watch the agent stream its reasoning, plans, tool calls, and file edits inline as it works. Everything is collapsible.

### 4. Approve actions as they come up

When the agent wants to do something consequential (edit a file, run a command), a **"Approve this action?"** strip appears on the tool card. The **Allow** button is auto-focused, so:

- Press **Enter** to allow.
- Press **Esc** to reject.

If you're comfortable letting the agent run unattended for a task, flip the green **Auto-accept** shield in the session header and prompts resolve themselves.

That's it — you're running an agent. Everything below is about going deeper.

---

## A few things worth knowing on day one

| Want to… | Do this |
|---|---|
| **Keep your working tree safe** | On the new-session picker, check **Run in an isolated git worktree**. The agent works on its own branch + checkout and can't touch your files. |
| **Redo from an earlier prompt** | Hover a past prompt and use **Edit** or **Fork**. Every turn in a git repo is snapshotted, so the conversation and files rewind together when a checkpoint exists. |
| **Review everything that changed** | Click **Review** on the far-right rail for a per-file diff view, then **Generate summary** for a plain-English recap. |
| **Run several agents at once** | Just start another session. Each shows in the left sidebar with a live status dot and keeps streaming in the background while you work in another. |
| **Attach context quickly** | Drag-and-drop files, or paste a screenshot straight into the composer. |
| **Get help without leaving the app** | Press **?** anywhere for the in-app help drawer. |
| **Hear when an agent needs you** | A chime and a colored dot in the app fire when a session finishes or needs input while you're looking elsewhere. Mute the chime with the speaker icon in the top header. |

---

## A one-paragraph tour of the tabs

Kairos's top navigation has a handful of tabs. Here's what each is for — follow the links for the full walkthrough.

- **[Agents](guide/agents.md)** — The headline. A full agentic coding cockpit: streaming chat with Claude/Gemini/Codex and others, live file edits and terminals, permission prompts, isolated git worktrees, prompt-level Edit/Fork rewind, diff review, and multi-session juggling from one sidebar.

- **[Plugins & Skills](guide/plugins-and-skills.md)** — A searchable catalog of everything installable — marketplace plugins and skills, public MATLAB/Simulink toolkits, and installs straight from a Git repo. Install, update, reinstall, pin versions, and star favorites with a click; watch install output stream live at the bottom of the screen.

- **[Customize](guide/customize.md)** — An agent-agnostic hub for the standing context every agent should carry: **Rules** (instructions), **Prompts** (reusable snippets in the `/` menu), **Roles** (personas), **MCP Servers** (extra tools), and **Hooks** (commands that fire on agent events). Set once, applied to every session.

- **[History](guide/history.md)** — Browse, search, and resume every AI coding session across all your projects. Filter by tool, age, or free text; resume inline in the Agents tab; export to HTML/Markdown; or hand a fuzzy query to an agent that reads the transcripts to find the session you mean.

- **[VSCode](guide/vscode.md)** — Discover `.code-workspace` files and project directories across your machine, pin/rename/hide them, and launch VSCode with kairos tools on your `PATH`.

- **[kairos settings](guide/kairos-settings.md)** — The point-and-click layer over the `kairos` environment: browse and edit **Config** keys, toggle **Feature flags**, run **Updates**, manage vault & proxy **Security**, and run the **Doctor** diagnostics with one-click fixes.

- **Account/update controls** (top-right header) — Login status and session expiry, the installed Kairos version, direct Kairos desktop update installs, and source-checkout update guidance. See [Account & Notifications](guide/account-and-notifications.md).

---

## Where to go next

- **New to agentic coding?** Read the [Agents guide](guide/agents.md) end to end — it's the heart of the app.
- **Want to tailor how agents behave?** Set up [Rules and Roles in Customize](guide/customize.md).
- **Looking for the full feature index?** The [Guides & Docs index](guide/README.md) links every section.
- **Something not working?** Run the [Doctor diagnostics](guide/kairos-settings.md#doctor--diagnostics), or open an issue from the **Feedback** link in the header.
