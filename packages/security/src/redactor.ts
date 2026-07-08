/**
 * PII redaction and rehydration engine.
 * Replaces sensitive data with tokens before sending to models,
 * then restores original values in the response.
 */

import { classify, type PatternMatch } from "./classifier.js";

export interface RedactionMap {
  /** Map of token → original value */
  entries: Map<string, string>;
  /** The redacted text */
  redactedText: string;
  /** Original text (stored only in memory, never logged) */
  originalLength: number;
}

/**
 * Redact sensitive content from text.
 * Returns the redacted text and a map to restore original values.
 */
export function redact(text: string): RedactionMap {
  const result = classify(text);
  const entries = new Map<string, string>();

  if (result.matches.length === 0) {
    return { entries, redactedText: text, originalLength: text.length };
  }

  // Sort matches by position (descending) to replace from end to start
  const sorted = [...result.matches].sort((a, b) => b.start - a.start);

  let redacted = text;
  let counter = 1;

  for (const match of sorted) {
    const original = text.slice(match.start, match.end);
    const token = `[REDACTED-${match.label.toUpperCase()}-${counter}]`;
    entries.set(token, original);
    redacted =
      redacted.slice(0, match.start) + token + redacted.slice(match.end);
    counter++;
  }

  return {
    entries,
    redactedText: redacted,
    originalLength: text.length,
  };
}

/**
 * Rehydrate redaction tokens in a response with original values.
 */
export function rehydrate(text: string, map: RedactionMap): string {
  let result = text;
  for (const [token, original] of map.entries) {
    result = result.replaceAll(token, original);
  }
  return result;
}
