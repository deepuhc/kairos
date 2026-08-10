# History

Browse, search, and resume every AI coding session across all your projects — Claude, Codex, and Gemini alike. (This is the tab labeled **History** in the navigation.)

> **Why it exists.** Your agent sessions are a valuable record — of decisions made, bugs fixed, and code written — but they're normally scattered across per-tool transcript files you'd never find again. History gathers them all in one filterable, searchable, resumable list.

- [The session list](#the-session-list)
- [Filters](#filters)
- [Actions per session](#actions-per-session)
- [Deep search with an agent](#deep-search-with-an-agent)
- [Empty & error states](#empty--error-states)

---

## The session list

Each session is a row showing:

- **Title** — your saved/renamed title, or the first message, or a short session id. A hover **pencil** renames it inline (Enter commits, Esc cancels); the rename sticks and survives reloads.
- **Preview** — the session's first message (when it differs from the title).
- **Meta** — the short session id and the message count (e.g. `3f9a2b1c · 12 messages`).
- **Tool pill** — a color-coded badge for the agent (`claude`, `codex`, `gemini`), with its logo. A glowing green dot inside means the session has a running process.
- **Directory** — the working directory (home-shortened to `~/…`), and **clickable**: it jumps you to the [VSCode](vscode.md) tab and highlights that workspace.
- **Timestamp** — relative "last active" time ("3m ago", "2d ago"), or an absolute date past 30 days.

---

## Filters

- **Search box** — placeholder *"Filter by title, message, dir, or id…"*. Filters instantly, client-side; every whitespace-separated word must appear somewhere (order-independent).
- **Tool** — pills: **all**, **claude**, **codex**, **gemini**.
- **Age window** — **1d**, **7d** (default), **30d**, **90d**.
- **Active** — only sessions with a running process.
- **Here** — only sessions in the server's current directory.
- **Refresh** — re-runs the fetch with the current filters.

---

## Actions per session

Each row's action cluster:

- **Preview** — opens a read-only in-app modal of the transcript (with its own resume affordance) — no download.
- **Resume** — hands the session to the [Agents tab](agents.md#reopening--renaming-sessions), which replays its history inline when the agent supports it and otherwise falls back to a terminal resume.
- **HTML** / **MD** — export the session as an HTML or Markdown document (opens as a download).
- **Folder icon** — reveals the transcript file in your OS file manager (when it exists on disk).
- **Delete** — a two-step confirm; permanently unlinks the transcript from disk.
- **Rename** (pencil, on hover) — inline rename of the title.
- **Jump to workspace** — click the directory text to hop to the workspace in the [VSCode](vscode.md) tab.

Use the row checkboxes for bulk cleanup. **Select all visible** selects the current filtered list, **Clear selection** resets it, and **Delete selected** permanently deletes the selected transcripts after one confirmation dialog.

> **Where's the dashboard?** The kairos-generated interactive sessions dashboard opens from elsewhere in the app, not from this list — the History toolbar's only non-filter control is **Refresh**.

---

## Deep search with an agent

Next to the search box is a **Search with {Agent}** button (naming your most-recently-used agent, e.g. *"Search with Claude"*). It's disabled until you type a query.

When plain text search comes up empty — because you remember *what a session was about* but not its exact words — click this. It hands your query and the current session list to the agent, which **reads the actual transcripts** to find semantically matching sessions the text filter missed, then surfaces them as resumable results in the Agents tab.

> **Why it exists.** Text search only matches literal words. This is the escalation path: let an agent read the transcripts and reason about which session you actually mean.

---

## Empty & error states

- **Loading** — shimmer skeleton rows.
- **Unsupported backend** — a centered message when the backend reports sessions aren't supported.
- **Error** — a red banner above the toolbar; the list still renders what it can.
- **No matches** — *"No matching sessions"* with a **Clear filter** action.
- **Nothing at all** — *"No sessions yet — sessions you start in the Agents tab show up here, ready to resume any time."*
