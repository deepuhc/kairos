import { describe, it, expect } from "vitest";
import { redact, rehydrate } from "./redactor.js";

describe("PII Redactor", () => {
  describe("redact", () => {
    it("redacts SSNs from text", () => {
      const result = redact("Client SSN is 123-45-6789");
      expect(result.redactedText).not.toContain("123-45-6789");
      expect(result.redactedText).toContain("[REDACTED-SSN-");
      expect(result.entries.size).toBe(1);
    });

    it("redacts multiple sensitive items", () => {
      const result = redact("SSN: 123-45-6789, EIN: 12-3456789");
      expect(result.redactedText).not.toContain("123-45-6789");
      expect(result.redactedText).not.toContain("12-3456789");
      expect(result.entries.size).toBe(2);
    });

    it("returns unchanged text when no PII found", () => {
      const text = "The standard deduction for 2025 is $15,000";
      const result = redact(text);
      expect(result.redactedText).toBe(text);
      expect(result.entries.size).toBe(0);
    });
  });

  describe("rehydrate", () => {
    it("restores original values from redacted text", () => {
      const original = "Client SSN is 123-45-6789";
      const redacted = redact(original);

      // Simulate model response using the redacted tokens
      const modelResponse = `The individual with ${[...redacted.entries.keys()][0]} has filed their return.`;
      const restored = rehydrate(modelResponse, redacted);

      expect(restored).toContain("123-45-6789");
      expect(restored).not.toContain("REDACTED");
    });

    it("handles multiple tokens in response", () => {
      const original = "SSN: 123-45-6789, also 987-65-4321";
      const redacted = redact(original);

      // Use all tokens in a response
      let response = "Found: ";
      for (const token of redacted.entries.keys()) {
        response += token + " ";
      }

      const restored = rehydrate(response, redacted);
      expect(restored).toContain("123-45-6789");
      expect(restored).toContain("987-65-4321");
    });
  });

  describe("round-trip", () => {
    it("redact → rehydrate preserves original content", () => {
      const original = "John Smith, SSN 123-45-6789, earned $150,000";
      const redacted = redact(original);

      // The redacted text with tokens can be fully restored
      const restored = rehydrate(redacted.redactedText, redacted);
      expect(restored).toBe(original);
    });
  });
});
