# kairos settings

The point-and-click layer over the `kairos` environment itself. The left rail has six sections: **Apps**, **Config**, **Features**, **Updates**, **Security**, and **Doctor**. (Apps is the same installable catalog covered in [Plugins & Skills](plugins-and-skills.md).)

> **Why it exists.** Everything here is normally a `kairos config …`, `kairos update`, `kairos doctor`, or vault command typed at a terminal — with output you have to read and flags you have to remember. This hub surfaces the same operations as searchable lists, toggles, and one-click fixes, with the resolution trace shown so you can see *why* a value is what it is.

- [Config](#config)
- [Feature flags](#feature-flags)
- [Updates](#updates)
- [Security](#security)
- [Doctor / Diagnostics](#doctor--diagnostics)

---

## Config

A searchable table of every `kairos config` key. Columns: **Key** (with description), **Type**, **Value** ("(unset)" when empty), and **Source** (a pill showing where the value resolves from). The header has a **Search keys…** box and a **Show hidden** toggle; a metadata line shows your config directory, project config, active profiles, and override counts.

Clicking a row opens a **drawer** with:

- The key's type, and — for enums — the allowed values and default.
- A green **Resolved:** banner showing the effective value and its source.
- A **layers trace** — one row per layer (env / project / user / profile / default) with each layer's value and source, so you can see exactly where the winning value comes from.
- A **type-aware editor** — a dropdown for enum and boolean keys, a text input otherwise — plus a **"Set in project config (--project)"** checkbox and buttons **Save** and **Unset**.

> **Why the layered trace matters.** Config values come from several places at once, and "why is this setting what it is?" is otherwise a guessing game. The trace answers it directly.

---

## Feature flags

Toggle alpha/beta features. Flags are grouped by namespace, each row showing:

- The flag name and description.
- A **stability pill** — **Alpha** (amber), **Beta** (purple), or **GA** (green).
- A **source pill** — where the current value resolves from.
- A **toggle switch** on the right.

Expand **▸ Why?** on any row for the same layered resolution trace as Config. A **Show hidden** toggle reveals internal flags.

> **Env-override safety.** A flag pinned by a `DEVAI_FLAG_*` environment variable shows its switch **disabled**, with a tooltip explaining why — so you're never confused about why toggling it does nothing. When a flag has an override you can clear it with an **Unset override** link.

---

## Updates

Keep `kairos` and everything installed current.

- **Update All** — a large card that updates kairos itself plus every installed app, plugin, and skill. Its description summarizes what's pending (or *"Everything is up to date"*); clicking runs the update and streams output. The card is dimmed when nothing is pending.
- **kairos CLI** — shows the installed kairos version and a **Self-Update** button for updating only the CLI.
- **Force re-resolve** — re-resolves installed apps to their currently-promoted versions, **downgrading anything ahead**. Confirmation-gated, since it can move you backward.
- **Update channel** — a dropdown to track **stable**, **beta**, or **main**. Changing it saves immediately.

---

## Security

Manage the credential vault, SSH/headless unlock setup, and proxy CA. (Requires being logged in.)

- A **vault status pill** — green **Vault unlocked** or red **Vault locked**.
- **Vault** actions — **Change passphrase…**, **Reset passphrase…** (clears the existing one), and **Rotate encryption key…** (re-encrypts all stored credentials with a new key). Passphrase buttons appear only if a passphrase slot exists.
- **SSH / headless access** — **Set up SSH passphrase…** adds a passphrase slot so credentials can unlock over SSH or without an OS keychain. **Force reset for SSH…** is a recovery path for broken keychains; it destroys stored service credentials and requires logging in again.
- **Proxy CA** actions — **Trust proxy CA…** (adds it to the OS trust store so curl/git work through the credential proxy; may prompt for sudo) and **Untrust proxy CA…**.

Each action is confirmation-gated, streams its output to the terminal panel, and refreshes the vault status when it finishes.

---

## Doctor / Diagnostics

Runs `kairos doctor` and renders the results as grouped checks. (The rail calls it **Doctor**; the pane heading reads **Diagnostics**.)

- A **summary banner** — green *"All checks passed"* or red *"N check(s) failed"*.
- Checks are **grouped by area**; each check row has a green (pass) or red (fail) status dot, the check name, and detail lines.
- **Fixing** — a **Fix** button on each failed check, a **Fix group** button per group, and a **Fix All (N)** button in the header for everything failing at once.
- **Export Zip** — generates a timestamped diagnostic support zip with one click.
- **Refresh** — re-runs the checks.

> **Why it exists.** When something's off — a missing tool, a misconfigured policy, an expired cert — Doctor tells you what and, more often than not, fixes it for you without a single command.
