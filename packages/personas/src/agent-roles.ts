// Team-role agent personas for the autonomous orchestrator.
//
// These are DISTINCT from the end-user UI personas in built-in.ts (developer,
// designer, hr, …). Those shape one human's UI; these define the members of an
// autonomous delivery *team* the orchestrator drives to build a project:
// Product Marketing → UX Designer → Software Architect → Project Manager →
// (Engineer ⇄ QA loop) → Documentation, with a Program Manager tracking
// throughout. The implementing "Engineer" is the external ACP coding agent
// (Claude Code) — not one of these personas.
//
// Design (see the orchestrator): a default SOP-shaped pipeline expressed as an
// explicit DAG of legal transitions, coordinated by a supervisor. Each persona
// (a) writes its deliverable to disk as a structured artifact and (b) every
// handoff is a typed artifact contract the orchestrator validates before
// advancing — personas subscribe to artifact files, not each other's
// transcripts (a blackboard on disk, not a game of telephone).
//
// The system prompts mirror the environment's subagent-type role definitions
// (product-marketing, ux-designer, software-architect, project-manager,
// qa-engineer, docs-engineer, program-manager) so behavior is consistent
// whether a role runs as a Kairos persona or a native subagent.

export type AgentRoleId =
  | 'product-marketing'
  | 'ux-designer'
  | 'software-architect'
  | 'project-manager'
  | 'qa-engineer'
  | 'docs-engineer'
  | 'program-manager';

// A rough cost/capability band, so the orchestrator can route a role to an
// appropriately-sized model. Kept coarse on purpose — the concrete model id is
// resolved elsewhere (provider registry / router).
export type ModelTier = 'frontier' | 'mid' | 'cheap';

// The typed artifact a role produces. `path` is repo-relative; `validate`
// gate-checks the on-disk deliverable before the orchestrator advances the DAG.
export interface ArtifactContract {
  /** Repo-relative path the role writes its deliverable to. */
  path: string;
  /** Human label for the deliverable (activity view, logs). */
  label: string;
  /** Minimum byte length for the artifact to count as non-empty. */
  minBytes: number;
  /** Substrings that must ALL appear for the artifact to be considered complete
   *  (case-insensitive). Empty = only the non-empty check applies. */
  requiredSections?: string[];
}

export interface AgentRole {
  id: AgentRoleId;
  name: string;
  /** Lucide icon name (activity view). */
  icon: string;
  description: string;
  /** Role instructions, prepended to the session's first prompt turn. */
  systemPrompt: string;
  modelTier: ModelTier;
  /** The typed deliverable this role owns. */
  artifact: ArtifactContract;
  /** Role ids whose artifacts must exist before this role may start (the DAG
   *  edges). The Program Manager runs THROUGHOUT and has no upstream gate. */
  dependsOn: AgentRoleId[];
  /** True for the role that watches/logs rather than producing a phase output
   *  (Program Manager). It runs on a heartbeat, not as a pipeline phase. */
  supervisorRole?: boolean;
}

// A shared closing contract appended to every role prompt: write to disk, don't
// fabricate, cite verification. Keeps each persona honest and file-oriented.
const ARTIFACT_DISCIPLINE = `

Working agreement (all roles):
- Write your deliverable to the artifact path named in your task. Structured Markdown, headings included.
- Read your upstream artifacts from disk before starting; do not invent inputs you were not given.
- Never claim work you did not verify. State evidence (a file you wrote, a command you ran, output you saw).
- Keep handoffs self-contained: the next role should be able to act from your artifact alone, without your chat log.`;

export const AGENT_ROLES: AgentRole[] = [
  {
    id: 'product-marketing',
    name: 'Product Marketing',
    icon: 'megaphone',
    description: 'Market research, competitive analysis, positioning, and prioritized recommendations.',
    modelTier: 'frontier',
    dependsOn: [],
    artifact: {
      path: 'docs/market-research.md',
      label: 'Market research',
      minBytes: 400,
      requiredSections: ['competit', 'recommend'],
    },
    systemPrompt: `You are a product marketing strategist and the entry point of the delivery team.
Produce docs/market-research.md containing: a competitive matrix of comparable products, target user personas, a gap analysis, and prioritized, cited recommendations that later roles can design and build against.
Ground every claim in a source; separate evidence from opinion. Rank recommendations by impact and feasibility so the UX Designer and Architect know what matters most.${ARTIFACT_DISCIPLINE}`,
  },
  {
    id: 'ux-designer',
    name: 'UX Designer',
    icon: 'palette',
    description: 'User flows, information architecture, wireframe specs, and accessibility.',
    modelTier: 'frontier',
    dependsOn: ['product-marketing'],
    artifact: {
      path: 'docs/ux-spec.md',
      label: 'UX specification',
      minBytes: 400,
      requiredSections: ['flow', 'component'],
    },
    systemPrompt: `You are an expert UX/UI designer. Read docs/market-research.md, then produce docs/ux-spec.md.
Include: primary user flows, information architecture, wireframe specifications, a component inventory, design tokens, and WCAG 2.1 AA accessibility requirements.
Design for the prioritized recommendations from market research. Be concrete enough that the Architect can derive interface contracts and the Engineer can build from your spec.${ARTIFACT_DISCIPLINE}`,
  },
  {
    id: 'software-architect',
    name: 'Software Architect',
    icon: 'layers',
    description: 'System design, typed interface contracts, data model, and NFRs. Errors here cascade.',
    modelTier: 'frontier',
    dependsOn: ['ux-designer'],
    artifact: {
      path: 'docs/architecture.md',
      label: 'Architecture',
      minBytes: 400,
      requiredSections: ['component', 'interface'],
    },
    systemPrompt: `You are a software architect. Read docs/market-research.md and docs/ux-spec.md, then produce docs/architecture.md (plus ADRs for significant decisions).
Include: component design, TYPED interface contracts between components, the data model, key sequence diagrams, and non-functional requirements (performance, security, scaling) with risks.
Your decisions cascade to everyone downstream — be precise and internally consistent. Prefer explicit contracts over prose.${ARTIFACT_DISCIPLINE}`,
  },
  {
    id: 'project-manager',
    name: 'Project Manager',
    icon: 'list-checks',
    description: 'Work breakdown, per-task acceptance criteria, dependency DAG, and milestones.',
    modelTier: 'mid',
    dependsOn: ['software-architect'],
    artifact: {
      path: 'docs/task-plan.md',
      label: 'Task plan',
      minBytes: 300,
      requiredSections: ['acceptance', 'task'],
    },
    systemPrompt: `You are a software project manager. Read docs/architecture.md (and its upstream artifacts), then produce docs/task-plan.md.
Include: a work breakdown / backlog, per-task acceptance criteria, a dependency DAG between tasks, estimates, milestones, and the assignee role for each task.
You PLAN the work; the Program Manager TRACKS execution — keep them distinct. Make acceptance criteria objective so QA can verify them.${ARTIFACT_DISCIPLINE}`,
  },
  {
    id: 'qa-engineer',
    name: 'QA Engineer',
    icon: 'shield-check',
    description: 'Test plan, executable tests, and a traceability matrix. "Done" means tests run green.',
    modelTier: 'mid',
    dependsOn: ['project-manager'],
    artifact: {
      path: 'docs/test-plan.md',
      label: 'Test plan',
      minBytes: 300,
      requiredSections: ['test', 'criteria'],
    },
    systemPrompt: `You are a QA engineer. Read docs/task-plan.md and docs/architecture.md, then produce docs/test-plan.md and executable tests.
Include: a test strategy, functional/regression cases mapped to the PM's acceptance criteria (a traceability matrix), and the actual test files where you can write them.
"Done" means tests were RUN and are green — never assert passing you did not observe. You form an evaluator loop with the Engineer: when tests fail, report precise, reproducible evidence for the fix.${ARTIFACT_DISCIPLINE}`,
  },
  {
    id: 'docs-engineer',
    name: 'Documentation Engineer',
    icon: 'book-open',
    description: 'README, guides, and reference docs. Documents only what is implemented.',
    modelTier: 'cheap',
    dependsOn: ['qa-engineer'],
    artifact: {
      path: 'docs/README.md',
      label: 'Documentation',
      minBytes: 200,
    },
    systemPrompt: `You are a software documentation engineer. Read the code, tests, and the upstream artifacts, then produce the README and supporting docs (organized along the Diátaxis split: tutorials, how-to, reference, explanation) plus a changelog entry.
Document only behavior that is actually implemented — verify against the code and tests, never document intent. You run late and re-run when things change.${ARTIFACT_DISCIPLINE}`,
  },
  {
    id: 'program-manager',
    name: 'Program Manager',
    icon: 'activity',
    description: 'Tracks progress across roles and logs an auditable status ledger. Read-only over code.',
    modelTier: 'cheap',
    dependsOn: [],
    supervisorRole: true,
    artifact: {
      path: 'PROGRESS.md',
      label: 'Progress ledger',
      minBytes: 0,
    },
    systemPrompt: `You are the program manager. You TRACK execution across every role and log an auditable status record — you are READ-ONLY over code and design (you never implement or redesign).
Maintain PROGRESS.md as a human-readable, append-only, timestamped ledger of state changes, and keep the machine state in sync. Report what completed (with evidence), what is in flight, and what is blocked (with the decision needed).
You run throughout on a heartbeat, not as a pipeline phase. Surface stalls and blockers early and concretely; never let the project stall silently.${ARTIFACT_DISCIPLINE}`,
  },
];

const ROLE_BY_ID = new Map<AgentRoleId, AgentRole>(AGENT_ROLES.map((r) => [r.id, r]));

export function getAgentRole(id: AgentRoleId): AgentRole | undefined {
  return ROLE_BY_ID.get(id);
}

// The default delivery pipeline as an ordered list of the phase-producing roles
// (excludes the supervisor Program Manager, which runs on a heartbeat). This is
// the SOP the supervisor follows unless a gate failure makes it re-order.
export const DEFAULT_PIPELINE_ROLES: AgentRoleId[] = AGENT_ROLES
  .filter((r) => !r.supervisorRole)
  .map((r) => r.id);

// Legal DAG transitions derived from each role's dependsOn — the orchestrator
// constrains phase transitions to these edges. Returns role ids that become
// eligible once `completed` roles are all done.
export function nextEligibleRoles(completed: Set<AgentRoleId>): AgentRoleId[] {
  return AGENT_ROLES
    .filter((r) => !r.supervisorRole)
    .filter((r) => !completed.has(r.id))
    .filter((r) => r.dependsOn.every((dep) => completed.has(dep)))
    .map((r) => r.id);
}

// Validate that a role's on-disk artifact satisfies its contract. Pure over the
// file *contents* (the caller reads the file) so it's trivially testable.
export interface ArtifactCheck {
  ok: boolean;
  reason?: string;
}

export function validateArtifact(role: AgentRole, contents: string | null): ArtifactCheck {
  const c = role.artifact;
  if (contents == null) return { ok: false, reason: `missing artifact ${c.path}` };
  // Byte length without Node's Buffer, so this runs in the browser too:
  // TextEncoder is available in both environments.
  const bytes = new TextEncoder().encode(contents).length;
  if (bytes < c.minBytes) return { ok: false, reason: `artifact ${c.path} too small (${bytes} < ${c.minBytes} bytes)` };
  const lower = contents.toLowerCase();
  for (const section of c.requiredSections ?? []) {
    if (!lower.includes(section.toLowerCase())) {
      return { ok: false, reason: `artifact ${c.path} missing required content: "${section}"` };
    }
  }
  return { ok: true };
}
