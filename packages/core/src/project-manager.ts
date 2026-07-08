/**
 * Project Manager — tracks multiple projects and their agent state.
 *
 * Stores registry at ~/.kairos/ (global) and .kairos/ (per-project).
 * Auto-detects project from cwd, no explicit init needed.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { existsSync } from "node:fs";

export interface Project {
  name: string;
  path: string;
  lastAccessed: string;
  agentCount: number;
}

export interface AgentRecord {
  id: string;
  task: string;
  status: "running" | "completed" | "failed" | "awaiting_input";
  startedAt: string;
  completedAt?: string;
  output?: string;
  pendingPrompt?: string;
}

export interface ProjectState {
  agents: AgentRecord[];
  history: Array<{
    task: string;
    pattern: string;
    completedAt: string;
    duration: number;
  }>;
}

const KAIROS_HOME = join(homedir(), ".kairos");

export class ProjectManager {
  private projects = new Map<string, Project>();
  private activeProject: string | null = null;
  private states = new Map<string, ProjectState>();

  async init(): Promise<void> {
    await mkdir(KAIROS_HOME, { recursive: true });
    await this.loadRegistry();
  }

  /**
   * Register or access a project. Auto-registers on first access.
   */
  async access(projectPath: string): Promise<Project> {
    const name = basename(projectPath);
    const existing = this.projects.get(projectPath);

    if (existing) {
      existing.lastAccessed = new Date().toISOString();
      this.activeProject = projectPath;
      await this.saveRegistry();
      return existing;
    }

    // Auto-register
    const project: Project = {
      name,
      path: projectPath,
      lastAccessed: new Date().toISOString(),
      agentCount: 0,
    };

    this.projects.set(projectPath, project);
    this.activeProject = projectPath;
    await this.saveRegistry();
    return project;
  }

  /**
   * Switch active project by name (fuzzy match).
   */
  switchTo(nameOrPath: string): Project | null {
    // Exact path match
    if (this.projects.has(nameOrPath)) {
      this.activeProject = nameOrPath;
      return this.projects.get(nameOrPath)!;
    }

    // Name match (case-insensitive, partial)
    const lower = nameOrPath.toLowerCase();
    for (const [path, project] of this.projects) {
      if (project.name.toLowerCase().includes(lower)) {
        this.activeProject = path;
        return project;
      }
    }

    return null;
  }

  /**
   * Get all registered projects, sorted by last accessed.
   */
  listProjects(): Project[] {
    return [...this.projects.values()]
      .sort((a, b) => b.lastAccessed.localeCompare(a.lastAccessed));
  }

  /**
   * Get active project.
   */
  getActive(): Project | null {
    if (!this.activeProject) return null;
    return this.projects.get(this.activeProject) ?? null;
  }

  /**
   * Track an agent in the current project.
   */
  addAgent(agent: AgentRecord): void {
    const state = this.getState();
    state.agents.push(agent);
    this.updateAgentCount();
  }

  /**
   * Update an agent's status.
   */
  updateAgent(id: string, update: Partial<AgentRecord>): void {
    const state = this.getState();
    const agent = state.agents.find(a => a.id === id);
    if (agent) {
      Object.assign(agent, update);
      this.updateAgentCount();
    }
  }

  /**
   * Get all agents for active project (optionally filtered by status).
   */
  getAgents(status?: AgentRecord["status"]): AgentRecord[] {
    const state = this.getState();
    if (status) return state.agents.filter(a => a.status === status);
    return state.agents;
  }

  /**
   * Get agents awaiting user input.
   */
  getPendingPrompts(): AgentRecord[] {
    return this.getAgents("awaiting_input");
  }

  /**
   * Get all agents across ALL projects.
   */
  getAllAgents(): Array<AgentRecord & { projectName: string }> {
    const all: Array<AgentRecord & { projectName: string }> = [];
    for (const [path, project] of this.projects) {
      const state = this.states.get(path) ?? { agents: [], history: [] };
      for (const agent of state.agents) {
        if (agent.status === "running" || agent.status === "awaiting_input") {
          all.push({ ...agent, projectName: project.name });
        }
      }
    }
    return all;
  }

  /**
   * Record a completed task in history.
   */
  recordHistory(task: string, pattern: string, duration: number): void {
    const state = this.getState();
    state.history.push({
      task,
      pattern,
      completedAt: new Date().toISOString(),
      duration,
    });
    // Keep last 50
    if (state.history.length > 50) {
      state.history = state.history.slice(-50);
    }
  }

  /**
   * Get recent history for active project.
   */
  getHistory(limit = 10): ProjectState["history"] {
    const state = this.getState();
    return state.history.slice(-limit);
  }

  // --- Persistence ---

  private async loadRegistry(): Promise<void> {
    const registryPath = join(KAIROS_HOME, "projects.json");
    try {
      const data = await readFile(registryPath, "utf-8");
      const parsed = JSON.parse(data) as {
        projects: Array<Project>;
        active: string | null;
      };
      for (const p of parsed.projects) {
        this.projects.set(p.path, p);
      }
      this.activeProject = parsed.active;
    } catch {
      // First run — no registry yet
    }
  }

  private async saveRegistry(): Promise<void> {
    const registryPath = join(KAIROS_HOME, "projects.json");
    const data = {
      projects: [...this.projects.values()],
      active: this.activeProject,
    };
    await writeFile(registryPath, JSON.stringify(data, null, 2));
  }

  private getState(): ProjectState {
    const path = this.activeProject ?? "default";
    if (!this.states.has(path)) {
      this.states.set(path, { agents: [], history: [] });
    }
    return this.states.get(path)!;
  }

  private updateAgentCount(): void {
    if (!this.activeProject) return;
    const project = this.projects.get(this.activeProject);
    if (project) {
      const state = this.getState();
      project.agentCount = state.agents.filter(
        a => a.status === "running" || a.status === "awaiting_input"
      ).length;
    }
  }
}
