# Customize

An **agent-agnostic** hub for the standing context every agent should carry. Whatever you set here rides along with any engine — Claude, Codex, Gemini, or a custom agent — because it's layered onto the session rather than baked into one tool's config. The left rail has five sections: **Rules**, **Prompts**, **Roles**, **MCP Servers**, and **Hooks**.

> **Why it exists.** Each coding agent has its own way of carrying instructions, personas, and tool config, and none of it transfers between them. Customize is a single point-and-click surface that works across all of them — configure once, apply everywhere — with no hand-editing of config files.

- [Rules](#rules)
- [Prompts](#prompts)
- [Roles](#roles)
- [MCP Servers](#mcp-servers)
- [Hooks](#hooks)

Common conventions: editors flash **✓ Saved** after saving and show **"Unsaved changes"** while a draft differs from what's stored; **Save**/**Create** stays disabled until the required fields are filled; deletes use an arm-then-confirm button.

---

## Rules

The instructions your agents always follow. Rules have a **scope toggle** at the top:

- **Global** — standing instructions injected at the start of *every* session, on any engine. This is the cross-agent equivalent of a tool's "user rules." One large Markdown textarea; **Save** commits it. *(Applies to sessions started from Kairos; standalone terminal runs are unaffected.)*
- **Project** — edits the repo's cross-agent **`AGENTS.md`** file on disk, scoped to a workspace you pick from a dropdown. Any agent that supports `AGENTS.md` picks these up automatically. A mini-rail lists the rule files with a status dot (green = has content, dim = not yet created). Saving an empty file deletes it.

> **Why the split.** Global rules are personal and travel with you across every project; project rules live in the repo and travel with the code (and with teammates). The toggle keeps the two from bleeding into each other.

---

## Prompts

Reusable prompt snippets that appear in the Agents composer's `/` menu. Type `/` in the composer, pick one, and its text drops into your message. They're engine-agnostic and work with any agent.

Each prompt has a **Trigger name** (what you type after `/`), an optional **Description**, and a **Prompt body** (the text that gets inserted). Create them in the left rail with **+ New prompt**.

> **Why it exists.** The prompts you reach for constantly — "review this diff, correctness first," "write a conventional-commit message" — shouldn't be retyped every session. Save them once and they're a `/` away in every agent.

---

## Roles

Reusable **personas** you apply to an agent when you start a session. A role bundles standing instructions — how to behave, what to focus on, what format to answer in — that get prepended to the session's first message.

Each role has a **Display name**, an auto-generated **ID**, an **Instructions** body, and an optional **Output format**. Because roles ride on the prompt, they're engine-agnostic: shipped roles like **Code Reviewer** work with Claude, Gemini, Codex, or a custom agent. You can edit or delete those starter roles, or add your own. Pick a role on the [new-session picker](agents.md#role) in the Agents tab.

> **Note.** A role primes only the *first* turn of a session; later turns aren't re-primed. Changes apply to sessions started after you save.

---

## MCP Servers

Connect external tools to your agents via the **Model Context Protocol**. Each server is a local command that exposes extra tools — filesystem access, web search, a database client, a live MATLAB session. Configured servers are **global**: they're injected into every new session automatically.

- **Quick add** offers one-click presets. The shipped preset is **MATLAB** — clicking **+ MATLAB** downloads and installs the server for your platform and auto-saves the config; the chip then turns green (**✓ MATLAB**). It gives agents a live MATLAB session (run code, read the workspace, generate plots); a note walks you through the one-time `matlab-mcp-server --setup-matlab` step and `shareMATLABSession()`.
- **Add your own** with **+ New server**: a **Display name**, **Command** (e.g. `npx`), space-separated **Arguments**, and optional **Environment** `KEY=VALUE` lines.

Claude-native MCP servers from Claude Code or Claude Desktop config are detected and shown as separate external servers when possible. Click **Import Claude MCP into Kairos** to copy supported stdio server definitions (command, arguments, and environment) into Kairos's global config. After import, those servers become agent-agnostic: new Claude, Codex, Gemini, and custom-agent sessions all receive them without separate per-agent setup.

> **Why it exists.** MCP is how agents reach beyond code — into your tools and data. Configuring a server by hand means editing JSON in the right place with the right shape; here it's a form with presets, applied to every session at once.

---

## Hooks

Run a shell command when a Kairos agent **lifecycle event** fires — post a desktop notification when a turn ends, log permission prompts to a file, play a sound when the agent stalls. Hooks are fire-and-forget: exit codes and output are ignored. The event payload arrives on `stdin` as JSON and as `DEVAI_HOOK_*` environment variables.

Kairos hooks are cross-agent hooks stored in Kairos's config. Agent-native hooks, such as Claude Code hooks in `.claude/settings.json`, are detected and shown as separate external hooks when possible.

Use **Import compatible hooks** to copy compatible Claude lifecycle hooks into Kairos. Imported hooks become agent-agnostic: the same automation runs for Claude, Codex, Gemini, and custom agents launched from Kairos, without configuring each agent separately. The import is one-way and does not modify Claude's settings. Claude-only tool-interception hooks, matchers, blocking behavior, and notification-specific hooks stay Claude-only because Kairos cannot faithfully represent those semantics as generic lifecycle hooks.

Each hook has a **Label**, an **Event**, and a **Shell command**. The events:

| Event | Fires when… |
|---|---|
| **sessionStart** | A new agent session was created. |
| **sessionLoaded** | A past session was resumed and finished replaying history. |
| **preRun** | You sent a message; the agent is about to run. |
| **postRun** *(default)* | The agent finished its turn, was cancelled, or refused. |
| **permissionRequest** | The agent paused to ask you to allow or deny a tool. |
| **stalled** | A turn has gone quiet for ~2 minutes (likely wedged). |
| **agentExit** | The agent subprocess exited. |

The command runs through your shell, so pipes, redirects, and `&&` all work.

> **Why it exists.** Hooks let you wire Kairos into the rest of your environment — notifications, logging, automation — without touching the app's code.
