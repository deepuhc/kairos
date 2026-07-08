/**
 * Data classification engine.
 * Scans text for sensitive patterns and assigns a classification level.
 */

export type DataClass = "restricted" | "confidential" | "internal" | "public";

export interface ClassificationResult {
  class: DataClass;
  matches: PatternMatch[];
  recommendation: "local_only" | "cloud_with_consent" | "any";
}

export interface PatternMatch {
  pattern: string;
  label: string;
  class: DataClass;
  start: number;
  end: number;
}

interface ClassifierPattern {
  regex: RegExp;
  label: string;
  class: DataClass;
}

const PATTERNS: ClassifierPattern[] = [
  // Restricted — never send to cloud
  {
    regex: /\b\d{3}-\d{2}-\d{4}\b/g,
    label: "SSN",
    class: "restricted",
  },
  {
    regex: /\b\d{2}-\d{7}\b/g,
    label: "EIN",
    class: "restricted",
  },
  {
    regex: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
    label: "credit_card",
    class: "restricted",
  },
  {
    regex: /\b\d{9,12}\b(?=.*(?:routing|account|acct))/gi,
    label: "bank_account",
    class: "restricted",
  },
  // Confidential — local default, cloud with consent
  {
    regex: /\b(?:client|taxpayer|patient|student):\s*[A-Z][a-z]+(?:\s[A-Z][a-z]+)+/g,
    label: "named_entity",
    class: "confidential",
  },
];

/**
 * Classify text content by scanning for sensitive patterns.
 * Returns the highest classification found and all matches.
 */
export function classify(text: string): ClassificationResult {
  const matches: PatternMatch[] = [];
  let highestClass: DataClass = "public";

  for (const pattern of PATTERNS) {
    // Reset regex state for global patterns
    pattern.regex.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = pattern.regex.exec(text)) !== null) {
      matches.push({
        pattern: pattern.regex.source,
        label: pattern.label,
        class: pattern.class,
        start: match.index,
        end: match.index + match[0].length,
      });

      if (classRank(pattern.class) > classRank(highestClass)) {
        highestClass = pattern.class;
      }
    }
  }

  return {
    class: highestClass,
    matches,
    recommendation: recommendAction(highestClass),
  };
}

function classRank(c: DataClass): number {
  switch (c) {
    case "restricted":
      return 3;
    case "confidential":
      return 2;
    case "internal":
      return 1;
    case "public":
      return 0;
  }
}

function recommendAction(
  c: DataClass
): "local_only" | "cloud_with_consent" | "any" {
  switch (c) {
    case "restricted":
      return "local_only";
    case "confidential":
      return "cloud_with_consent";
    default:
      return "any";
  }
}
