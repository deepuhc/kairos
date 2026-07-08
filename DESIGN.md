# Kairos — Design Philosophy

> *The art of the decisive moment.*

## Design Principle: "Calm Technology"

Inspired by Mark Weiser's concept of calm technology — tools that inform without demanding attention. The orchestrator should feel like a well-tuned instrument: powerful when played, silent when at rest.

---

## Visual Identity

### Core Metaphor: The Mosaic

Each agent is a tessera (tile). Alone, it's a fragment. Together, they form a complete picture. The user doesn't need to see every tile being placed — they see the picture emerge.

### Color Philosophy

```
Primary:    Deep Indigo (#1e1b4b)     — depth, focus, intelligence
Accent:     Warm Amber (#f59e0b)      — energy, warmth, human touch
Success:    Sage Green (#059669)       — growth, completion, nature
Warning:    Soft Coral (#f97316)       — attention without alarm
Background: Warm Stone (#fafaf9)      — calm, paper-like, professional
Terminal:   Midnight (#0f0f23)         — immersive, focused coding
```

**Why these colors:** Most dev tools use harsh blues and bright greens. We use warm, natural tones that reduce eye strain and create a sense of calm professionalism. An accountant at 9 PM during tax season shouldn't feel like they're staring at a control panel.

### Typography

```
Headings:   Inter (clean, modern, highly legible)
Body:       Inter (consistent)
Code/CLI:   JetBrains Mono (ligatures for readability)
Accent:     Playfair Display (elegant, for branding only)
```

### Iconography

Minimal, line-based icons with rounded corners. Never aggressive. Think: a gentle hand guiding, not a command center controlling.

```
Agent idle:     ○  (open circle — ready, breathing)
Agent working:  ◉  (filled — active, engaged)
Agent complete: ✓  (check — done, confident)
Agent blocked:  ◐  (half — waiting, needs you)
Pipeline flow:  ─→ (clean arrow — direction without urgency)
```

---

## CLI Experience Design

### Principle: "Breathe"

Most CLIs assault you with information. Ours breathes. White space is intentional. Updates appear smoothly. Nothing flashes or demands unless it truly needs you.

### Layout Hierarchy

```
┌─────────────────────────────────────────────────────┐
│  Status Bar (minimal: model, budget, security)       │ ← always visible, never distracting
├─────────────────────────────────────────────────────┤
│                                                       │
│  Main Content Area                                    │ ← where work happens
│  (clean, spacious, one thing at a time)              │
│                                                       │
├─────────────────────────────────────────────────────┤
│  Input (your prompt)                                  │ ← always ready
└─────────────────────────────────────────────────────┘
```

### Progress Without Noise

Instead of verbose logs:

```
BAD (typical CLI):
  [2026-07-08 14:23:01] INFO: Spawning agent security-reviewer with model anthropic/claude-sonnet-4-6...
  [2026-07-08 14:23:01] INFO: Agent security-reviewer started (PID 12345)
  [2026-07-08 14:23:01] INFO: Spawning agent logic-reviewer with model anthropic/claude-sonnet-4-6...
  [2026-07-08 14:23:02] INFO: Agent logic-reviewer started (PID 12346)
  [2026-07-08 14:23:15] INFO: Agent security-reviewer completed. Tokens: 1,234. Cost: $0.012
  [2026-07-08 14:23:18] INFO: Agent logic-reviewer completed. Tokens: 987. Cost: $0.009

GOOD (ours):
  Code Review
  ├─ security    ◉ analyzing...
  ├─ logic       ◉ analyzing...
  └─ style       ✓ done

  [updates in-place, no scroll, no noise]
```

### Moments of Delight

Small touches that make the tool feel crafted:

- **Completion chime** (optional): A soft tone when a long pipeline finishes
- **Progress poetry**: Instead of "Processing..." → "Reading between the lines..."
- **Session greeting**: Remembers your name, acknowledges time of day
- **Graceful errors**: "I couldn't reach TaxCaddy — their site might be down. Want me to try again in a minute, or skip this step?"

---

## Web Dashboard Design

### Principle: "Gallery, Not Control Room"

The dashboard should feel like walking through a gallery — each pipeline is a piece being composed. Not a NASA control room with 47 blinking indicators.

### Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  [Logo]                              [Budget: $2.41]  [Profile] │
├───────────┬─────────────────────────────────────────────────────┤
│           │                                                       │
│  Projects │   Active Pipeline                                    │
│           │                                                       │
│  • Current│   ┌─────────┐    ┌─────────┐    ┌─────────┐        │
│  • Recent │   │ Extract │───▶│ Analyze │───▶│ Report  │        │
│  • Saved  │   │   ✓     │    │   ◉     │    │   ○     │        │
│           │   └─────────┘    └─────────┘    └─────────┘        │
│           │                                                       │
│  ─────── │   Status: Analyzing 23 client records                │
│  Recipes  │   Time: 1:23 elapsed | ~0:30 remaining              │
│           │   Cost: $0.18 / $5.00 budget                         │
│  • Tax    │                                                       │
│  • Docs   │   ┌─────────────────────────────────────────┐       │
│  • Mail   │   │ Agent: reconciler                        │       │
│           │   │ "Matching transactions from Chase..."    │       │
│           │   └─────────────────────────────────────────┘       │
│           │                                                       │
├───────────┴─────────────────────────────────────────────────────┤
│  [Approval needed: Send 12 reminder emails?]  [Review] [Approve]│
└─────────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

- **Pipeline as visual flow** — not a table of tasks. You see the shape of the work.
- **One approval at a time** — never stack 5 approval dialogs. Queue them, show one.
- **Agent peek** — hover to see what an agent is currently doing. Don't pollute the main view.
- **Cost is always visible** — like a taxi meter. No surprises.
- **Time estimates** — help users plan. "~2 minutes remaining."

---

## Non-Developer Interface Design

### Principle: "Conversation, Not Configuration"

For non-technical users, the interface is a conversation — not a form, not a config file, not a dashboard.

### The Conversation Flow

```
┌─────────────────────────────────────────────────────┐
│                                                       │
│  Good morning! Your tools are ready:                 │
│  ✓ Excel  ✓ Word  ✓ Outlook  ✓ UltraTax  ✓ TaxCaddy│
│                                                       │
│  What would you like to work on?                     │
│                                                       │
│  ┌─ Recent ─────────────────────────────────────┐   │
│  │ • Check TaxCaddy status (ran yesterday)       │   │
│  │ • Send client reminders (ran Monday)          │   │
│  │ • Update depreciation schedules               │   │
│  └───────────────────────────────────────────────┘   │
│                                                       │
│  ┌───────────────────────────────────────────────┐   │
│  │ Type what you'd like to do...                  │   │
│  └───────────────────────────────────────────────┘   │
│                                                       │
└─────────────────────────────────────────────────────┘
```

### Confirmation Dialogs (The Gate)

When approval is needed, present it clearly and simply:

```
┌─────────────────────────────────────────────────────┐
│                                                       │
│  I'm ready to send reminder emails to 12 clients    │
│  who haven't uploaded their W-2s yet.               │
│                                                       │
│  ┌───────────────────────────────────────────────┐  │
│  │  Anderson, Corp.  — missing: W-2, 1099-INT    │  │
│  │  Baker LLC        — missing: K-1              │  │
│  │  Chen, David      — missing: W-2              │  │
│  │  ... (9 more)                                  │  │
│  └───────────────────────────────────────────────┘  │
│                                                       │
│  Each client will receive a personalized email       │
│  like this: [Preview sample email]                   │
│                                                       │
│  ┌──────────┐  ┌──────────────┐  ┌────────┐        │
│  │ Send All │  │ Edit & Send  │  │ Cancel │        │
│  └──────────┘  └──────────────┘  └────────┘        │
│                                                       │
└─────────────────────────────────────────────────────┘
```

### Design Rules for Non-Dev UI

1. **No jargon** — "Checking your clients" not "Executing parallel fan-out across TaxCaddy API"
2. **One action at a time** — never overwhelm with choices
3. **Always escapable** — "Cancel" is always visible and always works
4. **Show, don't tell** — preview what will happen before it happens
5. **Remember context** — "Last time you ran this on March 3rd for 18 clients"
6. **Progressive detail** — summary by default, expand for details if curious
7. **Warm language** — "I'll check on that" not "EXECUTING QUERY"
8. **Time awareness** — "This usually takes about 2 minutes" (calibrated from history)

---

## Focus-Enhancing Design Patterns

### 1. Single-Task Mode

When a pipeline is running, the UI focuses entirely on it. No sidebar notifications, no unrelated updates. Just this work, right now.

### 2. Ambient Progress

Instead of demanding attention for progress updates, use subtle ambient indicators:
- A gentle color gradient that fills as work completes
- A soft pulse on active agents (like breathing)
- A satisfying "settle" animation when a phase completes

### 3. Distraction Elimination

- No badges, no notification counts
- No "tips" or "did you know?" popups
- No upsell banners
- No analytics tracking that could slow the interface

### 4. Context Preservation

When you return to the tool after being away:
- It remembers exactly where you left off
- Shows a brief "since you were gone" summary
- Doesn't force you to re-orient

### 5. Deep Work Support

- Optional "focus mode" that hides everything except the current pipeline
- Keyboard shortcuts for everything (power users never touch the mouse)
- Tab completion in CLI that's actually helpful (context-aware suggestions)

---

## Sound Design (Optional, Off by Default)

For users who enable it:

| Event | Sound | Character |
|-------|-------|-----------|
| Pipeline starts | Soft rising tone (like dawn) | Anticipation |
| Phase completes | Gentle wooden "tok" | Progress, craftsmanship |
| Approval needed | Two-note chime (ascending) | "I need you" without urgency |
| Pipeline complete | Resolving chord (warm) | Satisfaction, completion |
| Error | Single low tone | Attention without alarm |

---

## Brand Voice

### In the CLI

```
Starting:    "Let's begin."
Working:     "Working on it..."  /  "Checking with TaxCaddy..."
Waiting:     "Ready when you are."
Completing:  "All done. Here's what I found:"
Error:       "I ran into a problem: [clear explanation]. Want me to try again?"
```

### In documentation

- Direct, warm, respectful of the user's time
- Never condescending ("simply", "just", "easy")
- Acknowledge complexity without being intimidating
- Show, don't explain abstractly

### Tone spectrum

```
Formal ─────────────────────── Casual
           ↑
       We are here
    (professional but warm)
```

---

## Accessibility

- All text meets WCAG 2.1 AA contrast ratios
- Screen reader compatible (proper ARIA labels)
- Keyboard navigable throughout
- Color is never the only indicator (always paired with icon/text)
- Respects system dark/light mode preference
- Reduced motion mode for users who need it
