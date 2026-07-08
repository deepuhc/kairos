/**
 * Kairos App — Main application entry point.
 *
 * Wires together:
 *   User Input → Coordinator (pattern selection) → ClaudeCodeRuntime (execution) → Dashboard (display)
 *
 * The user just types what they want. The Coordinator decides how to orchestrate.
 * The Dashboard shows everything and handles prompts inline.
 */

import React, { useState, useEffect } from 'react';
import { render, useApp } from 'ink';
import { Dashboard, type DashboardAgent } from './Dashboard.js';
import type { ProjectItem } from './components/ProjectSidebar.js';
import type { LogEntry } from './components/OutputLog.js';
import type { PendingPrompt } from './components/PromptBanner.js';
import { Coordinator, type TaskAnalysis } from '@kairos/core/coordinator';
import { ProjectManager } from '@kairos/core/project-manager';
import { ClaudeCodeRuntime } from '@kairos/runtime/adapters';

interface AppState {
  projects: ProjectItem[];
  agents: DashboardAgent[];
  logEntries: LogEntry[];
  commandHistory: string[];
}

/**
 * Main application logic (non-React, manages state and side effects).
 */
export class KairosApp {
  private coordinator = new Coordinator();
  private projectManager = new ProjectManager();
  private runtime = new ClaudeCodeRuntime();
  private state: AppState = {
    projects: [],
    agents: [],
    logEntries: [],
    commandHistory: [],
  };
  private updateDashboard: ((state: AppState) => void) | null = null;

  async start(workDir?: string): Promise<void> {
    await this.projectManager.init();

    // Auto-register current directory as project
    const cwd = workDir ?? process.cwd();
    await this.projectManager.access(cwd);
    this.syncProjects();

    // Listen to runtime events
    this.runtime.on('agent:started', ({ id }) => {
      this.addLog(id, 'Started', 'status');
    });

    this.runtime.on('agent:output', ({ id, chunk }) => {
      const lines = chunk.split('\n').filter((l: string) => l.trim());
      for (const line of lines) {
        this.addLog(id, line, 'output');
      }
    });

    this.runtime.on('agent:done', ({ id, status }) => {
      this.updateAgentStatus(id, status === 'completed' ? 'completed' : 'failed');
      this.addLog(id, `${status === 'completed' ? '✓ Done' : '✗ Failed'}`, 'status');
    });
  }

  /**
   * Handle a new task from the user.
   * The Coordinator decides the pattern — user doesn't need to specify.
   */
  async handleTask(task: string): Promise<void> {
    this.state.commandHistory.push(task);

    // Check for meta-commands (natural language)
    if (this.handleMetaCommand(task)) return;

    // Coordinator analyzes and picks the orchestration
    const analysis = this.coordinator.analyze(task);

    this.addLog(
      'coordinator',
      `Pattern: ${analysis.pattern} | Complexity: ${analysis.complexity} | Agents: ${analysis.agents.length}`,
      'status'
    );

    if (analysis.needsApproval) {
      this.addLog('coordinator', '⚠ High-risk task detected. Approval gate active.', 'prompt');
    }

    // Create dashboard agents
    for (const agent of analysis.agents) {
      this.state.agents.push({
        id: agent.id,
        role: agent.role,
        status: 'running',
      });
    }
    this.notify();

    // Execute based on pattern
    try {
      await this.executeAnalysis(analysis);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      this.addLog('coordinator', `Error: ${msg}`, 'error');
    }
  }

  /**
   * Execute the coordinator's analysis using ClaudeCodeRuntime.
   */
  private async executeAnalysis(analysis: TaskAnalysis): Promise<void> {
    const startTime = Date.now();

    switch (analysis.pattern) {
      case 'parallel': {
        const tasks = analysis.agents.map(agent => ({
          id: agent.id,
          prompt: agent.role,
        }));
        await this.runtime.runParallel(tasks);
        break;
      }

      case 'sequential': {
        let previousOutput = '';
        for (const agent of analysis.agents) {
          const prompt = previousOutput
            ? `Previous step result:\n${previousOutput}\n\nNow: ${agent.role}`
            : agent.role;
          previousOutput = await this.runtime.runTask(agent.id, prompt);
        }
        break;
      }

      case 'hierarchical': {
        const [manager, ...workers] = analysis.agents;
        const plan = await this.runtime.runTask(
          manager.id,
          `You are a coordinator. Break down this task into specific sub-tasks for ${workers.length} workers: ${manager.role}`
        );

        const workerTasks = workers.map(w => ({
          id: w.id,
          prompt: `Based on this plan:\n${plan}\n\nYour specific task: ${w.role}`,
        }));
        const results = await this.runtime.runParallel(workerTasks);

        const allOutputs = [...results.values()].join('\n---\n');
        await this.runtime.runTask(
          `${manager.id}-synthesis`,
          `Synthesize these worker outputs into a final result:\n${allOutputs}`
        );
        break;
      }

      case 'handoff': {
        const [router, ...specialists] = analysis.agents;
        const decision = await this.runtime.runTask(
          router.id,
          `Analyze this task and decide which specialist should handle it. Available: ${specialists.map(s => s.id + ': ' + s.role).join(', ')}. Task: ${router.role}. Reply with just the specialist id.`
        );

        const selected = specialists.find(s =>
          decision.toLowerCase().includes(s.id.toLowerCase())
        ) ?? specialists[0];

        await this.runtime.runTask(selected.id, selected.role);
        break;
      }

      case 'loop': {
        const maxIterations = 3;
        let output = '';
        for (let i = 0; i < maxIterations; i++) {
          for (const agent of analysis.agents) {
            const iterPrompt = output
              ? `Iteration ${i + 1}/${maxIterations}. Previous output:\n${output}\n\nYour task: ${agent.role}`
              : `Iteration 1/${maxIterations}. ${agent.role}`;
            output = await this.runtime.runTask(
              `${agent.id}-iter-${i + 1}`,
              iterPrompt
            );
          }
        }
        break;
      }
    }

    const duration = Math.round((Date.now() - startTime) / 1000);
    this.projectManager.recordHistory(analysis.intent, analysis.pattern, duration);
    this.addLog('coordinator', `✓ Completed in ${duration}s using ${analysis.pattern} pattern`, 'status');
  }

  /**
   * Handle natural language meta-commands.
   */
  private handleMetaCommand(task: string): boolean {
    const lower = task.toLowerCase().trim();

    // Project switching
    if (lower.startsWith('switch to ') || lower.startsWith('go to ')) {
      const name = task.replace(/^(switch to|go to)\s+/i, '').trim();
      const project = this.projectManager.switchTo(name);
      if (project) {
        this.addLog('system', `Switched to project: ${project.name}`, 'status');
        this.syncProjects();
      } else {
        this.addLog('system', `Project "${name}" not found`, 'error');
      }
      return true;
    }

    // Status
    if (lower === 'status' || lower === "what's running" || lower === 'what is running') {
      const running = this.state.agents.filter(a => a.status === 'running');
      if (running.length === 0) {
        this.addLog('system', 'No agents currently running', 'status');
      } else {
        this.addLog('system', `${running.length} agent(s) running:`, 'status');
        for (const a of running) {
          this.addLog('system', `  ${a.id}: ${a.role}`, 'status');
        }
      }
      return true;
    }

    // Stop/kill all
    if (lower === 'stop' || lower === 'stop all' || lower === 'kill all') {
      for (const agent of this.state.agents.filter(a => a.status === 'running')) {
        this.runtime.kill(agent.id);
        this.updateAgentStatus(agent.id, 'failed');
      }
      this.addLog('system', 'All agents stopped', 'status');
      return true;
    }

    // History
    if (lower === 'history' || lower === 'recent') {
      const history = this.projectManager.getHistory(5);
      if (history.length === 0) {
        this.addLog('system', 'No history yet', 'status');
      } else {
        for (const h of history) {
          this.addLog('system', `  ${h.pattern} | ${h.duration}s | ${h.task.slice(0, 50)}`, 'status');
        }
      }
      return true;
    }

    // Help
    if (lower === 'help' || lower === '?') {
      this.addLog('system', 'Just type what you want to do. Examples:', 'status');
      this.addLog('system', '  "review this code for bugs and security issues"', 'status');
      this.addLog('system', '  "analyze the performance, then suggest fixes"', 'status');
      this.addLog('system', '  "switch to my-other-project"', 'status');
      this.addLog('system', '  "status" / "history" / "stop all"', 'status');
      return true;
    }

    return false;
  }

  /** Handle user response to an agent prompt. */
  handlePromptResponse(agentId: string, response: string): void {
    this.runtime.send(agentId, response);
    this.updateAgentStatus(agentId, 'running');
    this.addLog(agentId, `User responded: ${response}`, 'status');
  }

  /** Handle project switch from sidebar click. */
  handleProjectSwitch(path: string): void {
    this.projectManager.switchTo(path);
    this.syncProjects();
  }

  /** Handle agent kill from dashboard. */
  handleAgentKill(agentId: string): void {
    this.runtime.kill(agentId);
    this.updateAgentStatus(agentId, 'failed');
    this.addLog(agentId, 'Killed by user', 'status');
  }

  // --- Internal helpers ---

  private addLog(agentId: string, text: string, type: LogEntry['type']): void {
    this.state.logEntries.push({
      agentId,
      text,
      timestamp: new Date().toLocaleTimeString('en-US', { hour12: false }).slice(0, 8),
      type,
    });
    if (this.state.logEntries.length > 200) {
      this.state.logEntries = this.state.logEntries.slice(-200);
    }
    this.notify();
  }

  private updateAgentStatus(id: string, status: DashboardAgent['status']): void {
    const agent = this.state.agents.find(a => a.id === id);
    if (agent) agent.status = status;
    this.notify();
  }

  private syncProjects(): void {
    const active = this.projectManager.getActive();
    this.state.projects = this.projectManager.listProjects().map(p => ({
      name: p.name,
      path: p.path,
      agentCount: p.agentCount,
      isActive: p.path === active?.path,
    }));
    this.notify();
  }

  private notify(): void {
    if (this.updateDashboard) {
      this.updateDashboard({ ...this.state });
    }
  }

  /** Connect the React dashboard to receive state updates. */
  setUpdater(fn: (state: AppState) => void): void {
    this.updateDashboard = fn;
  }

  getState(): AppState {
    return this.state;
  }
}

/**
 * React wrapper that renders the Dashboard with live state from KairosApp.
 */
export function AppRoot({ app }: { app: KairosApp }) {
  const [state, setState] = useState(app.getState());

  useEffect(() => {
    app.setUpdater(setState);
  }, [app]);

  return (
    <Dashboard
      projects={state.projects}
      agents={state.agents}
      logEntries={state.logEntries}
      commandHistory={state.commandHistory}
      onTaskSubmit={(task) => app.handleTask(task)}
      onPromptRespond={(id, resp) => app.handlePromptResponse(id, resp)}
      onProjectSwitch={(path) => app.handleProjectSwitch(path)}
      onAgentKill={(id) => app.handleAgentKill(id)}
    />
  );
}

/**
 * Launch the Kairos dashboard.
 */
export async function launchDashboard(workDir?: string): Promise<void> {
  const app = new KairosApp();
  await app.start(workDir);
  render(<AppRoot app={app} />);
}
