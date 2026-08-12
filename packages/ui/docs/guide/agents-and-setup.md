# Agents: types, setup & security

The [Agents tab](agents.md) can drive many different coding agents. This guide explains **what those agents are**, how they differ (who runs them, where they run, how they authenticate), **how to connect your own** — including a local, offline agent — and **what stops an agent from touching code outside the folder you point it at**.

- [The mental model](#the-mental-model)
- [The built-in agents](#the-built-in-agents)
- [Auth methods: API key, proxy, or local](#auth-methods)
- [Connecting your own agent (custom agents)](#connecting-your-own-agent-custom-agents)
- [Walkthrough: set up a local, offline agent](#walkthrough-set-up-a-local-offline-agent)
- [Where to get local agents](#where-to-get-local-agents)
- [Security: what an agent can and can't reach](#security-what-an-agent-can-and-cant-reach)

---

## The mental model

Kairos is an **[ACP](https://agentclientprotocol.com) client**. Every agent — no matter who made it — is just a **local process on your machine** that Kairos spawns and talks to over the Agent Client Protocol (JSON-RPC on the process's stdin/stdout). Kairos never reaches out to a cloud "agent service"; it launches a program on *your* computer.

What varies between agents is three independent things:

1. **Who launches it** — a `kairos`-wrapped built-in, or a command you supply (custom agent).
2. **How it authenticates** — your API key, an auth proxy, the agent's own local login, or *nothing at all* (a fully local model).
3. **Where the model inference happens** — a cloud provider (Anthropic, OpenAI, Google…), or entirely on your machine (a local LLM).

These are orthogonal. "Built-in vs. custom" is about *launching*; "key vs. proxy vs. local" is about *auth*; "cloud vs. local" is about *where inference runs*. A custom agent can point at a cloud model or a local one; a built-in always points at its vendor's cloud model.

> **There is no "hosted kairos agent" that runs in the cloud.** The built-ins aren't hosted anywhere — `kairos` is a launcher that spawns the agent CLI locally and injects your configured credentials. You supply the provider credentials (API key or proxy), and kairos handles the rest.

---

## The built-in agents

Eight agents ship in the picker. All of them run **locally**; they differ in how they're installed and authenticated. **All are visible to every user** — none are gated. For normal work, use the agents you have official access to through `kairos` (typically Claude, Codex, or Gemini). Local/offline agents are surfaced for Copilot-team ACP compatibility testing, not general use.

| Agent | How it's launched | Auth | Notes |
|---|---|---|---|
| **Claude** | `npx -y @agentclientprotocol/claude-agent-acp` (fetched on first launch) | `ANTHROPIC_API_KEY` or auth proxy | Published ACP adapter. |
| **Codex** | `npx -y @agentclientprotocol/codex-acp` | `OPENAI_API_KEY` or auth proxy | Published ACP adapter. |
| **Gemini** | `gemini --acp` | `GEMINI_API_KEY` or auth proxy | **Managed app** — install with `kairos apps install gemini` first. Speaks ACP natively. |
| **GitHub Copilot** | `npx -y @github/copilot --acp` | GitHub login (interactive) | Ships its own ACP-native CLI; no provider key. |
| **Goose** | `goose acp` | Its own local config | Standalone binary you install yourself. |
| **OpenCode** | `opencode acp` | Its own local config | Standalone binary you install yourself. |
| **Mistral Vibe** | `vibe-acp` | Its own local config | Standalone binary you install yourself. |
| **Kiro** | `kiro-cli acp` | Its own local config | Standalone binary you install yourself. |

Three shapes to notice:

- **npx adapters** (Claude, Codex, Copilot) — require Node.js/npm on `PATH`; the first launch fetches the adapter on demand. Kairos caches Claude's adapter under `~/.kairos/adapters` so later launches are instant.
- **Managed app** (Gemini) — must be installed through `kairos apps install gemini`. Until it is, its chip shows **"not installed"** with the exact command in the tooltip.
- **Bring-your-own binary** (Goose, OpenCode, Mistral, Kiro) — `kairos` can't install these; you install the tool yourself (brew, cargo, an install script, PyPI…). They're always listed, and a launch fails cleanly if the binary isn't on your `PATH`.

---

## Auth methods

For **Claude, Codex, and Gemini**, the picker shows an **Auth** toggle:

- **Auth proxy** *(optional)* — configure a proxy URL in settings; the agent launches under `kairos launch --`, which injects the proxy's base URL and bearer token into the process environment. Useful for organizations that manage credentials centrally.
- **API key** — the agent launches *bare* (no `kairos launch` wrapper) with your own key exported into its environment (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY`). The key is stored server-side in `~/.kairos/config.json` (`agentAuth`), masked, and never echoed back to the browser.

**Copilot** uses an interactive GitHub login (a terminal-auth step). **Goose, OpenCode, Mistral, and Kiro** carry no key toggle — they authenticate through whatever local config the tool itself uses (including, for some, a fully local model with no auth at all). **Custom agents** have no toggle either; whatever they need goes in their own `env` block (see below).

---

## Connecting your own agent (custom agents)

Any program that speaks ACP over stdio can be a Kairos agent. You register it once and it appears in the picker like any built-in.

**Where:** in the Agents tab, click **New session → + Custom** (the dashed chip at the end of the agent row). This opens the *Add a custom agent* form:

| Field | What it is |
|---|---|
| **ID** | A slug (lowercase letters, digits, hyphens), e.g. `my-agent`. Must not collide with a built-in. |
| **Display name** | What shows on the chip, e.g. `My Agent`. |
| **Command** *(optional, defaults to `kairos`)* | The executable to spawn. Leave blank to run under `kairos` (with credential injection); set it to run your own program directly. |
| **Arguments** *(space-separated)* | The arguments to that command, e.g. `launch -- npx -y @scope/my-agent-acp`, or for a bare local binary, `acp`. |
| **Environment** *(KEY=VALUE per line, optional)* | Extra environment variables — API keys, model paths, endpoints. |
| **Requires `kairos apps install` first** | Check only if your agent is a managed kairos app that must be installed before launch. Usually left unchecked. |

Custom agents run **verbatim** — the command + args + env you supply are exactly what's spawned. That's the flexibility: Kairos doesn't wrap or second-guess them.

> Stored in `~/.kairos/config.json` under `customAgents`. You can edit or remove a custom agent later via the pencil/× that appear on its chip.

---

## Walkthrough: set up a local, offline agent

> **Warning:** this walkthrough is not intended for general use. It exists only for the Copilot team to test ACP compatibility with local/offline agents. Do not use these agents for normal work; use the agents you have official access to through `kairos`, such as Claude, Codex, or Gemini.

Here's the end-to-end path for a fully local agent — one whose model runs on your machine with no cloud call and no API key. **Goose** is the easiest because it ships a built-in chip and speaks ACP natively; you just need to point it at a local model. (The same pattern works for any local ACP agent via **+ Custom**.)

### Option A — Goose with a local model (built-in chip)

1. **Install Goose** (it's the bring-your-own-binary kind — `kairos` can't install it):
   ```bash
   # macOS/Linux, per Goose's install docs
   curl -fsSL https://github.com/block/goose/releases/download/stable/download_cli.sh | bash
   ```
   Confirm it's on your `PATH`: `goose --version`.

2. **Install a local model runner** and pull a model — e.g. [Ollama](https://ollama.com):
   ```bash
   ollama pull qwen2.5-coder      # a capable local coding model
   ```
   With Ollama running, inference happens entirely on your machine.

3. **Point Goose at the local model.** Run `goose configure` once and choose your local provider (e.g. Ollama) and model. This writes Goose's own config — Kairos doesn't manage it, which is exactly why Goose has no key toggle.

4. **Launch it in Kairos:** Agents tab → **New session** → pick the **Goose** chip → choose a working directory → **Start session**. Goose spawns locally (`goose acp`), talks to your local model, and never makes a cloud call.

### Option B — any local ACP agent (custom chip)

If your agent is a standalone ACP binary (not one of the built-ins), register it as a custom agent:

1. Install the agent so its command is on your `PATH`.
2. Agents tab → **New session → + Custom**.
3. Fill in:
   - **ID:** `local-llm` (or whatever)
   - **Display name:** `Local LLM`
   - **Command:** the agent's executable, e.g. `my-acp-agent`
   - **Arguments:** whatever puts it in ACP/stdio mode, e.g. `acp`
   - **Environment:** any local settings, e.g. `OLLAMA_HOST=http://localhost:11434` and a model name — **no cloud API key needed**.
   - Leave **Command** *not* set to `kairos` (you want it bare, not wrapped) and leave the managed-app box unchecked.
4. **Add agent**, then start a session with its new chip.

> **Why this is genuinely offline:** the command is your local binary, the model runner is on `localhost`, and there's no `kairos launch` wrapper and no provider key — so nothing leaves your machine except what the model does locally. (If you want to be certain, the **Behind the Scenes** pane, toggled from the sidebar toolbar, shows curated protocol frames alongside the UI they produce, so you can confirm no outbound calls are made.)

---

## Where to get local agents

These are third-party tools — install them from their own sources, then either use their built-in chip (Goose, OpenCode, Kiro, Mistral) or register them via **+ Custom**:

- **Goose** — Block's open-source agent. github.com/block/goose. Supports local model providers (Ollama, llama.cpp) out of the box.
- **OpenCode** — open-source terminal agent. Supports local/OpenAI-compatible endpoints. Install per its docs, then `opencode acp`.
- **Ollama / llama.cpp / LM Studio** — not agents themselves, but the *local model runners* an offline agent points at. Install one, pull a coding model, and configure your agent to use its localhost endpoint.
- **Any ACP-compliant CLI** — the protocol is open ([agentclientprotocol.com](https://agentclientprotocol.com)); anything that speaks it over stdio works through **+ Custom**.

> Kairos doesn't distribute these binaries and can't install the bring-your-own ones for you — that's deliberate. You choose and vet the tool; Kairos just launches it.

---

## Security: what an agent can and can't reach

This is the part to understand before pointing *any* agent at code you care about.

### The working-directory sandbox (the real boundary)

When an agent asks Kairos to read a file, write a file, or run a terminal command, **Kairos answers those requests itself, scoped to the session's working directory.** The guard (`FsScope`) resolves every requested path against the cwd and **rejects anything that escapes it**:

- `fs/read_text_file` / `fs/write_text_file` — the path is resolved relative to the cwd; if it resolves outside (via `..`, an absolute path, etc.) the request is refused with *"Path escapes the session working directory."*
- `terminal/*` — embedded commands run **with their working directory inside the cwd** (the cwd itself, or a subdirectory; a cwd outside the scope is rejected).

So the directory you pick on the new-session picker **is** the blast radius for the agent's file and terminal tools. Point a session at one repo and its filesystem tools can't read a sibling repo.

### What the sandbox does *not* do — read this before using a local/BYO agent

The FsScope guard constrains the **ACP file/terminal tools**. It is **not** a full process sandbox. Be clear-eyed about the limits:

- **A terminal command can still reach the network and the wider machine.** The sandbox pins the command's *working directory*, not its capabilities — a shell step the agent runs can open a socket, hit an internal service, or read your home directory if the OS permits it. The protection is "the agent's file tools stay in the cwd," not "the agent's shell is jailed." Keep the permission tier at **Ask** (the default) or **Auto** (guarded) for agents you don't fully trust, so you review commands before they run; avoid **Full auto** for unfamiliar agents.
- **What the model sees leaves with the model.** A cloud-connected agent sends the file contents it reads to a **cloud provider**. If your concern is sensitive code reaching an outside service, that's the exposure to weigh — and it's exactly the argument for a **local, offline agent** (Option A/B above), where the model runs on your machine and nothing is sent out.
- **Custom agents run verbatim, with your environment.** A `+ Custom` agent is whatever command you typed — Kairos doesn't inspect it. Only register agents you trust, from sources you trust, the same way you'd treat any CLI you install.
- **MCP servers and hooks are their own trust surface.** [MCP servers](customize.md#mcp-servers) you configure are launched for every session and can expose arbitrary tools; [hooks](customize.md#hooks) run shell commands on agent events. Both run with your privileges.

### Practical guidance

- **To keep internal code off any cloud:** use a **local, offline agent** — the only configuration where file contents never leave your machine.
- **For untrusted or unfamiliar agents:** keep permission prompts on, and point the session at the **narrowest working directory** that still lets the task succeed — ideally an [isolated git worktree](agents.md#safety-worktrees--prompt-rewind) so even accepted writes land on a throwaway branch.
- **Everything is on your machine:** there's no Kairos cloud tenancy to leak into. The trust decisions are local — which agent binary you run, which directory you expose, and which tool calls you approve.
