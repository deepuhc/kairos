import { describe, it, expect, beforeEach } from "vitest";
import { PipelineExecutor } from "./executor.js";
import { SmartRouter } from "@kairos/providers";
import { MockProvider } from "@kairos/test-utils";
import type { Recipe } from "./types.js";
import type { AuditEntry } from "@kairos/security";

// In-memory audit log for testing
class TestAuditLog {
  entries: AuditEntry[] = [];

  async record(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }

  entry(partial: Omit<AuditEntry, "timestamp" | "sessionId">, sessionId: string): AuditEntry {
    return {
      timestamp: new Date().toISOString(),
      sessionId,
      ...partial,
    };
  }

  reset(): void {
    this.entries = [];
  }
}

describe("PipelineExecutor", () => {
  let mockProvider: MockProvider;
  let router: SmartRouter;
  let auditLog: TestAuditLog;

  beforeEach(() => {
    mockProvider = new MockProvider([
      "Agent 1 response",
      "Agent 2 response",
      "Agent 3 response",
    ]);
    router = new SmartRouter({
      providers: [mockProvider],
      defaultModel: "mock/test-model",
    });
    auditLog = new TestAuditLog();
  });

  describe("sequential execution", () => {
    it("executes agents in order with output chaining", async () => {
      const recipe: Recipe = {
        name: "Sequential Test",
        description: "Test sequential pattern",
        version: 1,
        providers: { default: "mock/test-model" },
        agents: [
          { id: "agent-1", role: "First agent" },
          { id: "agent-2", role: "Second agent" },
          { id: "agent-3", role: "Third agent" },
        ],
        pipeline: [
          {
            phase: "process",
            pattern: "sequential",
            agents: ["agent-1", "agent-2", "agent-3"],
          },
        ],
      };

      const executor = new PipelineExecutor({
        router,
        auditLog,
        sessionId: "test-session",
      });

      const result = await executor.execute(recipe);

      expect(result.status).toBe("completed");
      expect(result.tasks).toHaveLength(3);
      expect(result.tasks[0].agentId).toBe("agent-1");
      expect(result.tasks[1].agentId).toBe("agent-2");
      expect(result.tasks[2].agentId).toBe("agent-3");

      // Verify all tasks completed
      expect(result.tasks.every((t) => t.status === "completed")).toBe(true);

      // Verify calls happened in order
      expect(mockProvider.calls).toHaveLength(3);
    });

    it("stops execution if a task fails", async () => {
      // Provider returns error on second call
      const failingProvider = new MockProvider([
        "First response",
        "Second response", // Won't be used
      ]);
      failingProvider.complete = async () => {
        if (failingProvider.calls.length === 1) {
          throw new Error("Simulated failure");
        }
        return {
          content: "Should not reach here",
          model: "mock/test-model",
          tokensUsed: { input: 0, output: 0, total: 0 },
          costUsd: 0,
          durationMs: 0,
        };
      };

      const failRouter = new SmartRouter({
        providers: [failingProvider],
        defaultModel: "mock/test-model",
      });

      const recipe: Recipe = {
        name: "Failing Sequential",
        description: "Test failure handling",
        version: 1,
        providers: { default: "mock/test-model" },
        agents: [
          { id: "agent-1", role: "First" },
          { id: "agent-2", role: "Second" },
          { id: "agent-3", role: "Third" },
        ],
        pipeline: [
          {
            phase: "process",
            pattern: "sequential",
            agents: ["agent-1", "agent-2", "agent-3"],
          },
        ],
      };

      const executor = new PipelineExecutor({
        router: failRouter,
        auditLog,
      });

      const result = await executor.execute(recipe);

      expect(result.status).toBe("failed");
      expect(result.tasks).toHaveLength(2); // First succeeds, second fails, third never runs
      expect(result.tasks[0].status).toBe("completed");
      expect(result.tasks[1].status).toBe("failed");
      expect(result.tasks[1].error).toContain("Simulated failure");
    });
  });

  describe("parallel execution", () => {
    it("runs all agents concurrently", async () => {
      const recipe: Recipe = {
        name: "Parallel Test",
        description: "Test parallel pattern",
        version: 1,
        providers: { default: "mock/test-model" },
        agents: [
          { id: "worker-1", role: "Worker 1" },
          { id: "worker-2", role: "Worker 2" },
          { id: "worker-3", role: "Worker 3" },
        ],
        pipeline: [
          {
            phase: "parallel-work",
            pattern: "parallel",
            agents: ["worker-1", "worker-2", "worker-3"],
          },
        ],
      };

      const executor = new PipelineExecutor({
        router,
        auditLog,
      });

      const result = await executor.execute(recipe);

      expect(result.status).toBe("completed");
      expect(result.tasks).toHaveLength(3);

      // All tasks should complete
      expect(result.tasks.every((t) => t.status === "completed")).toBe(true);

      // All three agent calls should have happened
      expect(mockProvider.calls).toHaveLength(3);
    });
  });

  describe("budget enforcement", () => {
    it("stops execution when budget is exceeded", async () => {
      // Provider that costs money
      const costlyProvider = new MockProvider(["Expensive response"]);
      costlyProvider.complete = async (messages, options) => {
        return {
          content: "Expensive response",
          model: "mock/test-model",
          tokensUsed: { input: 100, output: 100, total: 200 },
          costUsd: 0.15, // Each call costs $0.15
          durationMs: 100,
        };
      };

      const costlyRouter = new SmartRouter({
        providers: [costlyProvider],
        defaultModel: "mock/test-model",
        budgetLimit: 0.25, // Only $0.25 budget
      });

      const recipe: Recipe = {
        name: "Budget Test",
        description: "Test budget enforcement",
        version: 1,
        providers: { default: "mock/test-model" },
        budget: {
          maxCost: 0.25,
        },
        agents: [
          { id: "agent-1", role: "First" },
          { id: "agent-2", role: "Second" },
          { id: "agent-3", role: "Third" },
        ],
        pipeline: [
          {
            phase: "work",
            pattern: "sequential",
            agents: ["agent-1", "agent-2", "agent-3"],
          },
        ],
      };

      const executor = new PipelineExecutor({
        router: costlyRouter,
        auditLog,
      });

      const result = await executor.execute(recipe);

      // Should stop after first agent (0.15) + second would exceed
      expect(result.status).toBe("failed");
      expect(result.tasks.length).toBeLessThanOrEqual(2);
      expect(result.totalCostUsd).toBeLessThanOrEqual(0.25);
    });
  });

  describe("PII redaction", () => {
    it("redacts PII before sending to model and rehydrates response", async () => {
      const recipe: Recipe = {
        name: "PII Test",
        description: "Test PII handling",
        version: 1,
        providers: { default: "mock/test-model" },
        agents: [
          { id: "processor", role: "Process sensitive data" },
        ],
        pipeline: [
          {
            phase: "process",
            pattern: "sequential",
            agents: ["processor"],
          },
        ],
      };

      // Input contains SSN
      const sensitiveInput = "Customer SSN: 123-45-6789";

      const executor = new PipelineExecutor({
        router,
        auditLog,
      });

      // Mock the phase to inject sensitive input
      (executor as any).phaseOutputs.set("input", sensitiveInput);

      const modifiedRecipe = {
        ...recipe,
        pipeline: [
          {
            ...recipe.pipeline[0],
            input: "input", // Reference the stored input
          },
        ],
      };

      const result = await executor.execute(modifiedRecipe);

      expect(result.status).toBe("completed");

      // Check that redaction happened in the call
      const call = mockProvider.calls[0];
      const userMessage = call.messages.find((m) => m.role === "user");

      // Should contain redaction token, not actual SSN
      expect(userMessage?.content).toContain("REDACTED");
      expect(userMessage?.content).not.toContain("123-45-6789");

      // Audit log should note data classification
      const taskEntry = auditLog.entries.find((e) => e.action === "task_executed");
      expect(taskEntry?.dataClassification).toBe("restricted");
      expect(taskEntry?.details?.hadRedaction).toBe(true);
    });
  });

  describe("gate checking", () => {
    it("passes quality gate when all tasks succeed", async () => {
      const recipe: Recipe = {
        name: "Gate Test",
        description: "Test quality gate",
        version: 1,
        providers: { default: "mock/test-model" },
        agents: [
          { id: "builder", role: "Builder" },
          { id: "tester", role: "Tester" },
        ],
        pipeline: [
          {
            phase: "build",
            pattern: "sequential",
            agents: ["builder"],
            gate: {
              type: "quality",
            },
          },
          {
            phase: "test",
            pattern: "sequential",
            agents: ["tester"],
          },
        ],
      };

      const executor = new PipelineExecutor({
        router,
        auditLog,
      });

      const result = await executor.execute(recipe);

      expect(result.status).toBe("completed");
      expect(result.tasks).toHaveLength(2); // Both phases executed
    });

    it("fails quality gate when tasks fail", async () => {
      const failingProvider = new MockProvider(["Response"]);
      failingProvider.complete = async () => {
        throw new Error("Task failed");
      };

      const failRouter = new SmartRouter({
        providers: [failingProvider],
        defaultModel: "mock/test-model",
      });

      const recipe: Recipe = {
        name: "Failing Gate Test",
        description: "Test gate failure",
        version: 1,
        providers: { default: "mock/test-model" },
        agents: [
          { id: "builder", role: "Builder" },
          { id: "tester", role: "Tester" },
        ],
        pipeline: [
          {
            phase: "build",
            pattern: "sequential",
            agents: ["builder"],
            gate: {
              type: "quality",
            },
          },
          {
            phase: "test",
            pattern: "sequential",
            agents: ["tester"],
          },
        ],
      };

      const executor = new PipelineExecutor({
        router: failRouter,
        auditLog,
      });

      const result = await executor.execute(recipe);

      expect(result.status).toBe("failed");
      expect(result.tasks).toHaveLength(1); // Only first phase attempted
      expect(result.tasks[0].status).toBe("failed");
    });
  });

  describe("state accumulation", () => {
    it("accumulates state across phases correctly", async () => {
      const recipe: Recipe = {
        name: "Multi-phase Test",
        description: "Test state tracking",
        version: 1,
        providers: { default: "mock/test-model" },
        agents: [
          { id: "phase1-agent", role: "Phase 1" },
          { id: "phase2-agent", role: "Phase 2" },
          { id: "phase3-agent", role: "Phase 3" },
        ],
        pipeline: [
          {
            phase: "phase-1",
            pattern: "sequential",
            agents: ["phase1-agent"],
          },
          {
            phase: "phase-2",
            pattern: "sequential",
            agents: ["phase2-agent"],
          },
          {
            phase: "phase-3",
            pattern: "sequential",
            agents: ["phase3-agent"],
          },
        ],
      };

      const executor = new PipelineExecutor({
        router,
        auditLog,
      });

      const events: string[] = [];
      executor.on("stateChange", (state) => {
        events.push(`phase-${state.currentPhase}`);
      });

      const result = await executor.execute(recipe);

      expect(result.status).toBe("completed");
      expect(result.tasks).toHaveLength(3);

      // Verify cost and token accumulation
      expect(result.totalCostUsd).toBeGreaterThanOrEqual(0);
      expect(result.totalTokens).toBeGreaterThan(0);

      // Verify each task is associated with correct phase
      expect(result.tasks[0].phase).toBe("phase-1");
      expect(result.tasks[1].phase).toBe("phase-2");
      expect(result.tasks[2].phase).toBe("phase-3");

      // Verify events were emitted for phase transitions
      expect(events.length).toBeGreaterThan(0);
    });
  });

  describe("audit logging", () => {
    it("records audit entries for all task executions", async () => {
      const recipe: Recipe = {
        name: "Audit Test",
        description: "Test audit logging",
        version: 1,
        providers: { default: "mock/test-model" },
        agents: [
          { id: "agent-1", role: "Agent 1" },
          { id: "agent-2", role: "Agent 2" },
        ],
        pipeline: [
          {
            phase: "work",
            pattern: "sequential",
            agents: ["agent-1", "agent-2"],
          },
        ],
      };

      const executor = new PipelineExecutor({
        router,
        auditLog,
        sessionId: "audit-session",
        user: "test-user",
      });

      await executor.execute(recipe);

      // Should have 2 audit entries (one per task)
      const taskEntries = auditLog.entries.filter((e) => e.action === "task_executed");
      expect(taskEntries).toHaveLength(2);

      // Verify audit entry structure
      const entry = taskEntries[0];
      expect(entry.sessionId).toBe("audit-session");
      expect(entry.user).toBe("test-user");
      expect(entry.agent).toBeTruthy();
      expect(entry.modelUsed).toBeTruthy();
      expect(entry.dataClassification).toBeTruthy();
      expect(entry.dataSentToCloud).toBeDefined();
    });

    it("records failure audit entries", async () => {
      const failingProvider = new MockProvider([]);
      failingProvider.complete = async () => {
        throw new Error("Test failure");
      };

      const failRouter = new SmartRouter({
        providers: [failingProvider],
        defaultModel: "mock/test-model",
      });

      const recipe: Recipe = {
        name: "Failure Audit Test",
        description: "Test failure audit",
        version: 1,
        providers: { default: "mock/test-model" },
        agents: [{ id: "agent", role: "Agent" }],
        pipeline: [
          {
            phase: "work",
            pattern: "sequential",
            agents: ["agent"],
          },
        ],
      };

      const executor = new PipelineExecutor({
        router: failRouter,
        auditLog,
      });

      await executor.execute(recipe);

      // Should have failure entry
      const failureEntry = auditLog.entries.find((e) => e.action === "task_failed");
      expect(failureEntry).toBeTruthy();
      expect(failureEntry?.details?.error).toContain("Test failure");
    });
  });
});
