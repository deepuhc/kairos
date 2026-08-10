# VSCode

Discover VS Code workspaces and project directories across your machine, keep them organized, and launch VSCode with `kairos` tools on your `PATH`.

> **Why it exists.** Your projects are scattered across disk, and launching VSCode with the kairos toolchain available means remembering to set up your `PATH` first. This tab finds your workspaces for you, lets you pin and organize the ones you use, and launches them correctly configured — one click.

- [The workspace list](#the-workspace-list)
- [Launching VSCode](#launching-vscode)
- [Discovery & configuration](#discovery--configuration)
- [Per-workspace actions](#per-workspace-actions)
- [Empty & error states](#empty--error-states)

---

## The workspace list

A vertical list, pinned items first. Each row shows:

- A **pin star** (★) if pinned.
- The **name** (bold; inline-editable when renaming).
- The **path** (dim, truncated to keep the tail visible).
- A **missing** label (and a dimmed row) when the path no longer exists on disk.
- A **source badge** — **discovered** (found by a scan) or **manual** (added by you).
- An **Open** button (when the path exists) and a **kebab (⋮)** menu.

A **filter box** appears once you have more than five workspaces.

---

## Launching VSCode

- The prominent **Launch** button (top-right) opens VSCode with **no specific workspace**, with kairos tools on your `PATH`.
- A row's **Open** button launches VSCode **on that workspace**.

---

## Discovery & configuration

Kairos scans configured **discovery sources** for `.code-workspace` files, plus any workspaces you've added manually. Open the config form with the **⚙ Config** button; force a fresh scan with **↻ Rescan**.

The config form has:

- **Discovery Sources** — one source per line:
  - **Bare path** (`W:/git`) — `.code-workspace` files directly in that folder, no subdirectories.
  - **Recursive** (`W:/git/**`) — scan subdirectories down to *Max Depth*, skipping excluded names.
  - **Multi-root** (`{C:/projects, D:/work}/vscode/**`) — several roots at once, with an optional subpath.
  - **Comments** — prefix a line with `#` to disable a source without deleting it.
- **Max Depth** — how deep recursive `/**` scans go (1–10, default 4).
- **Exclude Patterns** — directory *names* to skip during recursive scans (tag input; Enter or comma to add).
- **Hidden Workspaces** — workspaces you've hidden via the kebab menu; each has an **Unhide** button. (Hidden workspaces are still on disk — just filtered out of the list.)

Finish with **Save & Rescan**.

---

## Per-workspace actions

The kebab (⋮) menu on each row:

- **Pin to top** / **Unpin** — pinned workspaces always sort first.
- **Rename** — inline (Enter commits, Esc cancels).
- **Copy path** — copies the full path to the clipboard.
- **Show in folder** — reveals it in your OS file manager.
- **Open terminal** — opens a terminal at the workspace's parent directory.
- **Hide** — removes it from the list (undo via Config › Hidden Workspaces).
- **Remove** — unregisters a manually-added workspace (only shown for **manual** entries).

The toolbar's **Sort** dropdown offers **A–Z**, **Source**, **Path**, and **Recent**; pinned items stay first regardless. **+ Add** registers a workspace manually by path (with an optional display name).

---

## Empty & error states

- **Scanning** — a centered *"Scanning…"* message.
- **No workspaces** — *"No workspaces found."*; if no sources are configured, it points you at **Config** and **Add**.
- **Filter matches nothing** — *"No workspaces match "{text}"."*
- Most per-item actions (pin, hide, remove, reveal, copy, sort) fail silently by design.
