# Why Kairos

Kairos started with a simple bet: the way we build software is going agentic, and the team building MATLAB Desktop should be living in that future, not reading about it. So it exists for two reasons at once — as a working tool we use every day, and as a proving ground for the technologies we're bringing to the product itself.

## Why it exists

**A real home for agent-driven development.** As our software workflows shift toward coding agents, the team — and I — needed somewhere to do that work for real, not in a scratch terminal. Kairos is that home: one desktop workspace where Claude, Gemini, Codex, and other agents run side by side, their reasoning, edits, and commands stay visible, and every change stays reviewable. Using it daily is how we learn what agentic development actually needs.

It also doubles as a rehearsal for the product. What ships here as a convenience is, quietly, a way to exercise new technology end to end on a smaller, faster-moving codebase — hit the sharp edges early, and carry the lessons back to MATLAB Desktop.

## How it's built

Fast and safe enough to trust daily, modern enough to teach us something — several of these double as early trials of technology headed for MATLAB Desktop:

- **Rust backend.** Memory-safe and fast — it spawns agents, streams their output, and sandboxes their file and terminal access.
- **Tauri + native webview.** Uses the operating system's own webview instead of bundling a browser, so downloads stay small and the app feels native — and doubles as our proving ground for a browserless, desktop-class UI shell.
- **TypeScript + Lit.** A typed, web-component frontend that stays fast and refactor-friendly as it grows.
- **Agent Client Protocol (ACP).** One wire format for every agent — reasoning, tool calls, edits, permissions — so the cockpit is agent-agnostic, not wired to one vendor's CLI.
- **Integrated header.** Custom window chrome, not a stock title bar — one consistent surface for navigation, identity, and status across every OS.
- **Signed delivery + Evergreen updates.** One GitLab CI/CD pipeline builds signed artifacts for macOS, Windows, and Linux and deploys the download-and-update site, so a tagged release turns into installable apps that silently auto-update — no reinstall. (Code signing was, to put it kindly, the part that fought back hardest.)
- **Agentic Desktop layouts.** Early experiments with agent-driven MATLAB Desktop layouts.
- **IDP-like workflows.** Staying close to IDP-like development workflows.

Around all of that sits a point-and-click layer over the `kairos` CLI — the catalog, sessions, standing context, config, and diagnostics — so the tooling you need is a click away rather than a command to remember.
