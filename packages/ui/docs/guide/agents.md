# Agents

**The headline feature.** The Agents tab is a full agentic coding cockpit inside the Kairos desktop app — a live [Agent Client Protocol](https://agentclientprotocol.com) client, not a terminal wrapper. You talk to Claude, Gemini, Codex, and other coding agents; watch them stream reasoning, task plans, tool calls, file edits, and embedded terminals inline; and keep every change on a leash with a tiered permission model, isolated git worktrees, prompt-level Edit/Fork rewind, and inline diff review.

> **Why it exists.** Coding agents normally live in a terminal, where their work scrolls past and disappears, changes land straight in your working tree, and running two at once means two windows. The Agents tab turns that into a durable, reviewable, multi-session workspace — with credentials injected automatically so you can focus on the work.

- [Layout](#layout)
- [Starting a session](#starting-a-session)
- [The composer](#the-composer)
- [Session controls](#session-controls)
- [The side panels (right rail)](#the-side-panels-right-rail)
- [Permissions](#permissions)
- [Safety: worktrees & prompt rewind](#safety-worktrees--prompt-rewind)
- [Edit or fork from any past prompt](#edit-or-fork-from-any-past-prompt)
- [Running many agents at once](#running-many-agents-at-once)
- [When an agent gets stuck](#when-an-agent-gets-stuck)
- [Reopening & renaming sessions](#reopening--renaming-sessions)
- [Notifications](#notifications)

---

## Layout

The tab is an edge-to-edge, three-region workspace (think Cursor, Zed, or Claude.ai):

- **Left sidebar** — your session list. From top to bottom: a layout toolbar, the **New session** button, your **Active** sessions (live in this tab), your **Pinned** sessions (past sessions you deliberately keep on hand), your **Recent** sessions (past ones on disk), and a mascot in the footer. Drag its right edge to resize; drag it narrow and it snaps to a slim icon rail.
- **Main column** — shows one of three things: the **new-session picker** (when nothing is focused), a **live session** (header + streaming timeline + composer), or the **Behind the Scenes** reference pane.
- **Right rail** — inside a live session, a vertical strip of icon buttons (Plan, Review, Summary) that open a resizable side panel. Opening a panel reflows the chat narrower rather than covering it.

The layout toolbar at the top of the sidebar lets you toggle **Behind the Scenes**, hide the top navigation header to reclaim vertical space, collapse the sidebar to a rail, and reopen the side panel.

> **The tab stays mounted when you navigate away.** Its live connections keep streaming in the background, so switching to another tab and back never kills a running agent.

---

## Starting a session

Click **New session** in the sidebar. If you've started a session before, that button is a **split button**: clicking its body does a **quick start** (reuses your last agent and directory, skipping the picker), while the small caret on the right opens the full picker to choose something different.

The picker has these fields — only the first two matter to get going:

### Agent
A row of chips, one per available agent: **Claude**, **Codex**, **Gemini**, **GitHub Copilot**, **Goose**, **OpenCode**, **Mistral Vibe**, **Kiro**, plus any custom agents you've added. All built-ins are visible to every user. For normal work, use the agents you have official access to through `kairos`, such as Claude, Codex, or Gemini; local/offline agents are intended for ACP compatibility testing.

- A chip tagged **"not installed"** needs its app installed first — the tooltip shows the exact command (`kairos apps install <id>`).
- The dashed **+ Custom** chip lets you connect your own ACP agent by giving it an ID, display name, command, arguments, and environment variables.

> **What are these agents, and how do I add my own (including a local, offline one)?** See the dedicated guide: **[Agents: types, setup & security](agents-and-setup.md)** — it covers built-in vs. custom, API key vs. proxy vs. local auth, cloud vs. offline inference, and what the working-directory sandbox does and doesn't protect.

### Auth *(Claude / Codex / Gemini only)*
A toggle for how the agent authenticates:

- **API key** *(default)* — provide your provider API key in settings; injected at launch.
- **API key** — runs the agent bare with your own key (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY`). You paste the key into a masked field; it's stored server-side, masked, and never echoed back to the browser. A green **stored** tag appears once saved, with **Edit** and **Clear** actions.

Copilot uses your GitHub sign-in; Goose, OpenCode, Mistral, and Kiro use their own local config — so no toggle appears for those.

### Role
Apply a reusable **persona** (from [Customize › Roles](customize.md#roles)) — a bundle of standing instructions and an output format that get prepended to the session's first message. Pick **None** for normal behavior. Starter roles such as **Code Reviewer**, **Test Engineer**, and **Debugger** are available out of the box, and roles are engine-agnostic.

### Working directory
Either pick a discovered **VS Code Workspace** from the dropdown, or type an absolute path under **Or enter a path**. This directory is the agent's sandbox: its filesystem and terminal access are confined to it, and path traversal is blocked at the protocol layer.

### Name *(optional)*
Defaults to your first message. You can rename any time later.

### Run in an isolated git worktree *(only when the directory is a git repo)*
See [Safety: worktrees & prompt rewind](#safety-worktrees--prompt-rewind). Check it, name a branch (e.g. `agent/my-task`), and the agent works on a separate checkout + branch off your base branch — it can't touch your working tree.

Click **Start session** (or press **Enter** in the path/name field). If an agent needs an interactive login, an auth panel appears with a button that opens a terminal window to complete sign-in, then a **Done — start session** button.

---

## The composer

The message box at the bottom of a live session. Placeholder text is *"Message {Agent}…"* when idle, or *"Steer or queue a follow-up…"* while the agent is working.

| Action | How |
|---|---|
| **Send** | Press **Enter**, or click the round send button. **Shift+Enter** inserts a newline. |
| **Queue / steer mid-turn** | Keep typing while the agent runs. Sending normal prose queues the message and interrupts the live turn to steer (it politely waits if a file write is mid-flight, but interrupts immediately if the turn is blocked on a permission or question). Slash commands such as `/usage` queue behind the active turn instead of cancelling it. Queued messages appear as dashed chips above the box. |
| **`@file` mentions** | Type `@` then a path for a fuzzy file picker; the file is attached as a reference. Arrows navigate, **Enter/Tab** commits, **Esc** hides. |
| **Slash commands & saved prompts** | Type `/` (or click the `/` button) for a menu blending the agent's own commands with your [saved prompts](customize.md#prompts). Picking a command fills `/name ` for arguments; picking a prompt drops in its full text. |
| **Find in conversation** | Press **Ctrl/⌘ + F** to open a find bar over the timeline. It searches the whole conversation (including history not yet scrolled into view), shows a `current/total` match count, and highlights every hit. **Enter** / **Shift+Enter** step forward and back; **Esc** closes. |
| **Attachments** | Click the paperclip, **drag-drop**, or **paste** (e.g. a screenshot). Images and audio go as blocks; text-like files (up to 10 MB) are sent inline. Attach options are gated on what each agent accepts. |
| **Stop** | While the agent works, a red stop button cancels the turn and drops the queue. |

---

## Session Controls

The bar at the top of a session shows the agent, the working directory, and — if you're in a worktree — a **⎇ {branch}** chip. On the right:

- **Context & cost meter** — a fill bar with `{used}/{size}` tokens and, when known, a dollar cost. Hover for a breakdown. It turns amber past 70% of the context window and red past 90%.
- **Compact** — sends `/compact` to summarize the conversation and reclaim context. Available when the agent is idle.
- **Model / Effort** — these show as chips in the composer's left footer. You can switch **model** and reasoning **effort** on the fly. Your choices are remembered per agent for next time.
- **Permission tier picker** — a shield button in the session header that lets you choose how autonomously the agent acts. See [Permissions](#permissions).
- **Copy all** — copies the whole conversation as Markdown.
- **End** — ends the session.

---

## The side panels (right rail)

The far-right rail opens one panel at a time (they're mutually exclusive):

- **Plan** — the agent's task plan and progress (✓ done / ▸ in-progress / ○ pending). The badge shows `done/total`. Not every session produces a plan.
- **Review** — the change-review panel. Header shows totals (`N files +X −Y`); a per-file list with **A/M/D** badges (Added / Modified / Removed) sits beside the selected file's full diff. Toggle **Unified** / **Split**; unchanged context collapses into expandable gaps. The badge counts changed files.
- **Summary** — an agent-authored markdown recap of what changed and why, generated on first open and kept **out of the chat timeline** so it never clutters the conversation. Use **Generate summary** / **Regenerate**.

**Files and Prompts are top-nav global views** (see the navigation bar at the top of the app), not right-rail panels. They stay bound to the active session as you use them. A separate in-session Files side panel can open when you click a linked file in the conversation, showing that file in context.

> **Behind the Scenes** (the toggle in the sidebar toolbar) is a static reference pane: a pipeline diagram, auth status, and curated protocol frames paired with the UI they produce.

---

## Permissions

When an agent wants to run a tool and the session's permission tier requires approval, an **"Approve this action?"** strip appears on that tool card, glowing with an accent border. The agent's options render as buttons — allow options filled, reject options outlined.

Focus jumps to the Allow button, so you can decide with the keyboard: **Enter** allows, **Esc** rejects. The sidebar and timeline show *"Waiting for your answer…"* until you do.

### Permission tiers

The **permission tier picker** is a shield button in the session header. Click it to open a menu with four tiers (ordered from least to most autonomous):

| Tier | Label | Behavior |
|---|---|---|
| **Plan** | Plan only | Read-only. The agent can look but not edit or run commands. Reads are auto-allowed; everything else is auto-rejected. |
| **Ask** | Ask every time | **(Default.)** Every action prompts for your approval. Nothing runs without your explicit OK. |
| **Auto** | Auto (guarded) | Auto-allows reads, in-workspace edits, and a known-safe set of commands (build tools, test runners, linters). Prompts for anything risky — deletions, network fetches, unknown commands. |
| **Full auto** | Full auto | Auto-approves everything except the always-on danger floor (see below). Gated behind a one-time confirmation. |

Your tier choice persists across reloads for that session.

### The always-on danger floor

Regardless of tier — even in Full auto — a hard set of patterns **always prompts** and can never be silently approved:

- `rm -rf` and other recursive/force deletes
- `sudo`
- `curl … | bash` and `wget … | sh` (pipe-to-shell)
- `git push --force`, `git reset --hard`, `git clean -f`
- Writes, deletes, or moves to paths outside the session workspace
- Interpreter inline-code flags (`node -e`, `python3 -c`, `deno -e`, etc.)
- `mkfs`, `dd` to a device, fork bombs, `netcat -e`, and similar system-destructive patterns

The danger floor is enforced client-side by Kairos for every agent regardless of which native mode the underlying agent runs in.

> **Agent questions.** Separately, an agent may ask a structured question (an "elicitation"), shown as an inline **Agent question** card with fields and **Cancel** / **Skip** / **Submit** buttons.

---

## Safety: worktrees & prompt rewind

Two independent safety nets keep the agent from surprising you:

### Isolated git worktrees
Check **Run in an isolated git worktree** on the picker (only offered when the directory is a git repo). The agent runs on its own branch and checkout off your base branch, so it **can never touch your working tree**. A **⎇ {branch}** chip marks the session, and ending it offers to clean up — prompting you when there's dirty or unmerged work.

### Prompt checkpoints
Every turn in a git repo is automatically snapshotted *before* the prompt runs — as dangling git commits that never touch your index, HEAD, or branch. Those checkpoints are used by **Edit prompt** and **Fork from this prompt**: when you restart from an earlier prompt, Kairos can restore files to the snapshot from before that prompt ran. There is no standalone Rewind button; file rewind happens through the past-prompt Edit/Fork flow, and the confirmation dialog tells you whether a checkpoint exists before it changes anything.

---

## Edit or fork from any past prompt

Hover a message you sent earlier in the session and two small icon buttons appear on it: a **pencil** (*Edit prompt and start again from here*) and a **fork** (*Fork from this prompt*). Either opens a confirmation modal that names the prompt, shows its text, and — separately — tells you whether a checkpoint exists so you know if files will be restored too:

- **Edit & rewind** trims later conversation from *this* session, reloads the trimmed history, and drops the prompt back into the composer for editing.
- **Fork session** creates a *new* session from the point before this prompt, keeps the original conversation intact, and opens the prompt in the new composer for you to adjust.

If a checkpoint exists for the target prompt, files are restored to that point along with the conversation; if not, the conversation rewinds and files are left as they are — the modal calls this out before you commit.

---

## Running many agents at once

Start as many sessions as you like — each appears in the **Active** sidebar list with a live **status dot**:

| Dot | Meaning |
|---|---|
| Purple (with timer) | **Working** — the agent is running; the row shows an elapsed `m:ss` timer. |
| Purple + "Needs you" badge | A permission or question is pending. |
| Red + "Stuck" badge | Error or stall. |
| Emerald with a ring + "Done" | Finished since you last looked (unread). |
| Plain emerald | Done and seen. |
| Gray | Not started. |

An amber **+N** badge means N queued messages. Click any row to switch to that session — the others keep streaming in the background. Hover the **?** by the "Active" label for a legend.

Tool activity in the timeline renders as cards: lightweight one-line rows for reads and searches, and bordered cards for anything with a **diff** (with `+N −M` stats and a unified/split toggle) or **terminal output** (a scrollable dark block). When an agent delegates to a **sub-agent** (a Task), you get a distinct card naming the sub-agent type, its task, its nested steps, and the report it hands back. *(Richly-rendered sub-agent cards are primarily a Claude feature.)*

---

## When an agent gets stuck

If a turn goes silent past the stall threshold (~2 minutes), an amber banner appears: **"No response for a while — the agent may be stuck."** with two recovery options:

- **Interrupt & continue** — cancels the wedged turn and nudges the same session with "Continue." No process kill, no session loss.
- **Force restart** — kills the agent subprocess and reloads the session from on-disk history. The conversation survives.

You can also hit **Stop** in the composer at any time to cancel the current turn.

---

## Reopening & renaming sessions

- **Active list** — live sessions in this tab. Hover a row for a **pencil** (rename inline; commit on Enter/blur) and a **×** (end the session).
- **Pinned list** — past sessions you've deliberately kept on hand. Any Recent row has a **pin icon** on hover; clicking it moves the session to a **Pinned** section above Recent, where it stays regardless of age and is never subject to the recency cap. Drag a pinned row up or down to reorder — the order persists across reloads. Unpin from the same icon to send it back to Recent.
- **Recent list** — past sessions from disk across all agents (last 30 days), capped at 7 with a **View all sessions →** link into [History](history.md). Clicking a row **resumes** it: the session replays its history inline over the protocol (falling back to a terminal resume if the agent can't replay). Recent rows also have **pin**, **rename**, and **delete** (a full confirmation dialog, since deleting a transcript is permanent) on hover.

Resuming and searching also flow in from the [History](history.md) tab. A **Search with {agent}** flow launches a session that reads your transcripts and surfaces matching past sessions as **→ Resume:** chips above the composer.

---

## Notifications

When an agent **finishes a turn or needs input while you're looking elsewhere** (a hidden app window, a different view, or another session focused), Kairos raises two cues:

- A **colored dot in the app** — emerald for done, amber for needs-you (needs-you wins). Always shown, silent, cleared the moment you look at the session.
- A short **chime** — a rising two-note for *done*, a quick double-ping for *needs input*, so you can tell them apart without looking.

Mute the chime with the **speaker icon in the top app header** (not in the Agents tab itself). The visual badge is always shown regardless of mute. See [Account & Notifications](account-and-notifications.md) for more.

> **Empty-session extras.** A fresh session greets you by time of day, offers starter suggestion chips (*Explain this codebase*, *Find and fix a bug*, *Write tests for a file*, *Refactor a function*), and rotates a **"Did you know?"** tip carousel covering worktrees, prompt Edit/Fork rewind, Compact, Roles, and more.
