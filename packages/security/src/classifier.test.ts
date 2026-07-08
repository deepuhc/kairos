import { describe, it, expect } from "vitest";
import { classify } from "./classifier.js";

describe("Data Classifier", () => {
  describe("SSN detection", () => {
    it("detects SSN patterns as restricted", () => {
      const result = classify("Client SSN is 123-45-6789");
      expect(result.class).toBe("restricted");
      expect(result.recommendation).toBe("local_only");
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0].label).toBe("SSN");
    });

    it("detects multiple SSNs", () => {
      const result = classify("Primary: 123-45-6789, Spouse: 987-65-4321");
      expect(result.matches).toHaveLength(2);
    });
  });

  describe("EIN detection", () => {
    it("detects EIN patterns as restricted", () => {
      const result = classify("Company EIN: 12-3456789");
      expect(result.class).toBe("restricted");
      expect(result.matches[0].label).toBe("EIN");
    });
  });

  describe("Credit card detection", () => {
    it("detects credit card numbers as restricted", () => {
      const result = classify("Card: 4111 1111 1111 1111");
      expect(result.class).toBe("restricted");
      expect(result.matches[0].label).toBe("credit_card");
    });

    it("detects cards without spaces", () => {
      const result = classify("Card: 4111111111111111");
      expect(result.class).toBe("restricted");
    });
  });

  describe("Clean text", () => {
    it("classifies text without PII as public", () => {
      const result = classify("The tax rate for 2025 is 22% for income between $44,725 and $95,375.");
      expect(result.class).toBe("public");
      expect(result.matches).toHaveLength(0);
      expect(result.recommendation).toBe("any");
    });
  });

  describe("Mixed content", () => {
    it("returns highest classification when mixed", () => {
      const result = classify("Client: John Smith, SSN: 123-45-6789, earned $150,000");
      expect(result.class).toBe("restricted");
      expect(result.recommendation).toBe("local_only");
    });
  });
});
