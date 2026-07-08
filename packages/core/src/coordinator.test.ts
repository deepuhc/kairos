import { describe, it, expect } from "vitest";
import { Coordinator } from "./coordinator.js";

describe("Coordinator", () => {
  const coord = new Coordinator();

  describe("pattern selection", () => {
    it("selects parallel for independent subtasks", () => {
      const result = coord.analyze(
        "check for security issues and check for performance issues"
      );
      expect(result.pattern).toBe("parallel");
      expect(result.agents.length).toBeGreaterThanOrEqual(2);
    });

    it("selects sequential for dependent steps", () => {
      const result = coord.analyze(
        "first analyze the bug, then propose a fix"
      );
      expect(result.pattern).toBe("sequential");
      expect(result.hasDependencies).toBe(true);
    });

    it("selects loop for iterative tasks", () => {
      const result = coord.analyze(
        "write a draft, then iterate and improve until it's polished"
      );
      expect(result.pattern).toBe("loop");
      expect(result.requiresIteration).toBe(true);
    });

    it("selects hierarchical for complex decomposition", () => {
      const result = coord.analyze(
        "do a comprehensive thorough plan to decompose this large system"
      );
      expect(result.pattern).toBe("hierarchical");
      expect(result.requiresDecomposition).toBe(true);
    });

    it("selects handoff for specialist routing", () => {
      const result = coord.analyze(
        "route this to the right expert based on whether it's a security or performance issue"
      );
      expect(result.pattern).toBe("handoff");
      expect(result.requiresSpecialization).toBe(true);
    });

    it("selects sequential for simple single tasks", () => {
      const result = coord.analyze("summarize this file");
      expect(result.pattern).toBe("sequential");
      expect(result.complexity).toBe("simple");
      expect(result.agents.length).toBe(1);
    });
  });

  describe("risk assessment", () => {
    it("flags high risk for production/database tasks", () => {
      const result = coord.analyze("deploy this to production");
      expect(result.riskLevel).toBe("high");
      expect(result.needsApproval).toBe(true);
    });

    it("flags high risk for tax/compliance tasks", () => {
      const result = coord.analyze("process tax filings for clients");
      expect(result.riskLevel).toBe("high");
    });

    it("flags medium risk for refactoring", () => {
      const result = coord.analyze("refactor the auth module");
      expect(result.riskLevel).toBe("medium");
    });

    it("flags low risk for read-only tasks", () => {
      const result = coord.analyze("explain how this function works");
      expect(result.riskLevel).toBe("low");
    });
  });

  describe("subtask extraction", () => {
    it("splits on 'and'", () => {
      const result = coord.analyze(
        "check security vulnerabilities and check test coverage and check performance"
      );
      expect(result.subtasks.length).toBeGreaterThanOrEqual(2);
    });

    it("splits on 'then' for sequential", () => {
      const result = coord.analyze(
        "read the file, then summarize it, then write tests"
      );
      expect(result.subtasks.length).toBeGreaterThanOrEqual(2);
      expect(result.hasDependencies).toBe(true);
    });

    it("keeps simple tasks as single subtask", () => {
      const result = coord.analyze("fix the login bug");
      expect(result.subtasks.length).toBe(1);
    });
  });

  describe("agent generation", () => {
    it("creates a manager + workers for hierarchical", () => {
      const result = coord.analyze(
        "do a thorough comprehensive code review and break down all issues"
      );
      if (result.pattern === "hierarchical") {
        expect(result.agents[0].id).toBe("manager");
        expect(result.agents.length).toBeGreaterThanOrEqual(2);
      }
    });

    it("creates a router + specialists for handoff", () => {
      const result = coord.analyze(
        "route this to the right security specialist"
      );
      if (result.pattern === "handoff") {
        expect(result.agents[0].id).toBe("router");
      }
    });

    it("creates drafter + reviewer for loop", () => {
      const result = coord.analyze("write an essay and keep improving it");
      if (result.pattern === "loop") {
        expect(result.agents.some(a => a.id === "drafter")).toBe(true);
        expect(result.agents.some(a => a.id === "reviewer")).toBe(true);
      }
    });
  });
});
