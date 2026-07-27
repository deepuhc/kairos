/**
 * Bridges @kairos/core Coordinator logic to the ACP client.
 * Analyzes tasks, spawns agents, and executes orchestration patterns.
 */

import { Coordinator, type TaskAnalysis } from "@kairos/core/coordinator";
import { store } from "./store.js";
import type { ACPClient } from "./acp/client.js";
import type { Session } from "./acp/session.js";

const coordinator = new Coordinator();

export interface OrchestrationResult {
  analysis: TaskAnalysis;
  agentIds: string[];
}

export function analyzeTask(task: string): TaskAnalysis {
  return coordinator.analyze(task);
}

export async function executeOrchestration(
  task: string,
  client: ACPClient
): Promise<OrchestrationResult> {
  const analysis = analyzeTask(task);

  if (analysis.complexity === "simple") {
    const agentId = await spawnAndPrompt(client, analysis.agents[0].role, task);
    return { analysis, agentIds: [agentId] };
  }

  store.activeAgent?.messages.push({
    type: "system",
    text: `Orchestrating: ${analysis.pattern} pattern with ${analysis.agents.length} agents`,
  });

  const agentIds: string[] = [];

  switch (analysis.pattern) {
    case "parallel": {
      const promises = analysis.agents.map((agent) =>
        spawnAndPrompt(client, agent.role, agent.role)
      );
      const ids = await Promise.all(promises);
      agentIds.push(...ids);
      break;
    }

    case "sequential": {
      for (const agent of analysis.agents) {
        const id = await spawnAndPrompt(client, agent.role, agent.role);
        agentIds.push(id);
      }
      break;
    }

    case "hierarchical": {
      const [manager, ...workers] = analysis.agents;
      const managerId = await spawnAndPrompt(
        client,
        manager.role,
        `You are the manager. Decompose this task and coordinate: ${task}\nAvailable workers: ${workers.map(w => w.role).join(", ")}`
      );
      agentIds.push(managerId);

      const workerPromises = workers.map((w) =>
        spawnAndPrompt(client, w.role, w.role)
      );
      const workerIds = await Promise.all(workerPromises);
      agentIds.push(...workerIds);
      break;
    }

    case "handoff": {
      const [router, ...specialists] = analysis.agents;
      const routerId = await spawnAndPrompt(
        client,
        router.role,
        `Route this task to the appropriate specialist: ${task}\nSpecialists: ${specialists.map(s => s.role).join(", ")}`
      );
      agentIds.push(routerId);
      break;
    }

    case "loop": {
      const [drafter, reviewer] = analysis.agents;
      const drafterId = await spawnAndPrompt(client, drafter.role, task);
      agentIds.push(drafterId);
      if (reviewer) {
        const reviewerId = await spawnAndPrompt(client, reviewer.role, reviewer.role);
        agentIds.push(reviewerId);
      }
      break;
    }
  }

  return { analysis, agentIds };
}

async function spawnAndPrompt(
  client: ACPClient,
  name: string,
  prompt: string
): Promise<string> {
  const agentId = store.createAgent(name.slice(0, 40));
  const session = await client.newSession();
  store.setSession(agentId, session.id);
  store.addUserMessage(agentId, prompt);
  await client.prompt(session.id, prompt);
  return agentId;
}
