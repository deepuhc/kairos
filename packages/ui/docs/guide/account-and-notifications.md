# Account & Notifications

Three things that live in the top app header rather than in a tab: the **account menu** (the avatar on the far right), the **Kairos update** button when a desktop update is installable, and the **notification** cues that tell you when an agent needs you.

- [Account menu](#account-menu)
- [Staying up to date](#staying-up-to-date)
- [Notifications](#notifications)

---

## Account menu

The circular **avatar** in the top-right corner. When you're logged in it shows your initials; when you're not, it shows a **?**. An **amber dot** on the avatar means an update is available.

Clicking it opens a dropdown with:

- **Identity** — your username and, when logged in, **"Session expires: {time}"**. Logged out, it prompts you to log in.
- **Log In** / **Log Out** — sign in or sign out of your auth session.
- **Kairos version** — the installed desktop app version.
- **Kairos update** — when a desktop update is available, the dropdown shows a prominent install card. Source checkouts show a source-update card when they are behind.

> **Session expiry, handled gracefully.** If your auth session expires (say, left overnight), a banner appears at the top of the app — *"Your kairos session has expired — agents can't run until you sign in again"* — with a **Log in** button, rather than letting agent turns fail mysteriously. Auth state refreshes automatically when the tab regains focus.

---

## Staying up to date

There are three update paths:

- **`kairos` itself** — via **Self-Update** or **Update All** in [kairos settings › Updates](kairos-settings.md#updates).
- **Kairos desktop** — when an installable desktop update is available, the amber **Update Kairos** button in the header downloads, installs, and restarts or prompts you to reopen the app. The account menu shows the same install action plus the current app version.
- **Kairos source checkouts** — developer/source builds show source-update guidance in the account menu when the checkout is behind `origin/main`; they do not route through `kairos settings`.

---

## Notifications

When an agent **finishes a turn or needs your input while you're looking elsewhere** — a hidden app window, a different view, or a different session focused — Kairos raises two cues so you don't have to babysit it:

- A **colored dot in the app** — **emerald** for *done*, **amber** for *needs you* (needs-you takes priority). Always shown, silent, and cleared the instant you look at the session.
- A short **chime** — a gentle rising two-note for *done*, a quicker double-ping for *needs input*, so you can tell them apart without looking.

**Muting.** The **speaker icon in the top header** mutes and unmutes the chime. The visual badge is always shown regardless — muting only silences the sound.

> **Why it exists.** Agents run for minutes at a stretch and pause for permission at unpredictable moments. These cues let you start a task, switch away to something else, and get pulled back exactly when the agent finishes or needs a decision.
