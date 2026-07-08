/**
 * Security profiles and policies.
 * Pre-built configurations for different professional domains.
 */

export interface SecurityPolicy {
  /** Tools this agent can use */
  allowedTools?: string[];
  /** Tools explicitly denied */
  deniedTools?: string[];
  /** File system access scope */
  fileAccess?: "none" | "read-only" | "write" | { write: string[] };
  /** Network domains allowed (empty = no network) */
  allowedDomains?: string[];
  /** Whether human approval is required for actions */
  requiresApproval?: "always" | "destructive" | "external" | "never";
  /** Max runtime before auto-kill */
  maxRuntimeMs?: number;
  /** Max recipients for communication actions */
  maxRecipients?: number;
  /** Rate limit (actions per hour) */
  rateLimit?: number;
}

export interface SecurityProfile {
  name: string;
  description: string;
  defaults: {
    /** Default data classification for unclassified content */
    defaultClassification: "confidential" | "internal" | "public";
    /** Whether cloud models are allowed by default */
    cloudAllowed: boolean;
    /** Whether PII auto-detection is enabled */
    piiDetection: boolean;
    /** Audit log retention in days */
    auditRetentionDays: number;
    /** Session auto-lock timeout in minutes */
    autoLockMinutes: number;
    /** Default approval requirement */
    defaultApproval: "always" | "destructive" | "external" | "never";
  };
}

const PROFILES: Record<string, SecurityProfile> = {
  personal: {
    name: "Personal",
    description: "Relaxed settings for hobby and personal projects",
    defaults: {
      defaultClassification: "internal",
      cloudAllowed: true,
      piiDetection: true,
      auditRetentionDays: 30,
      autoLockMinutes: 60,
      defaultApproval: "destructive",
    },
  },
  "tax-firm": {
    name: "Tax Firm",
    description: "IRS Section 7216 + Circular 230 aligned",
    defaults: {
      defaultClassification: "confidential",
      cloudAllowed: false,
      piiDetection: true,
      auditRetentionDays: 2555, // 7 years
      autoLockMinutes: 15,
      defaultApproval: "always",
    },
  },
  enterprise: {
    name: "Enterprise",
    description: "SOC 2 Type II aligned",
    defaults: {
      defaultClassification: "confidential",
      cloudAllowed: true,
      piiDetection: true,
      auditRetentionDays: 365,
      autoLockMinutes: 30,
      defaultApproval: "external",
    },
  },
  healthcare: {
    name: "Healthcare",
    description: "HIPAA aligned",
    defaults: {
      defaultClassification: "confidential",
      cloudAllowed: false,
      piiDetection: true,
      auditRetentionDays: 2190, // 6 years
      autoLockMinutes: 10,
      defaultApproval: "always",
    },
  },
  education: {
    name: "Education",
    description: "FERPA aligned",
    defaults: {
      defaultClassification: "confidential",
      cloudAllowed: false,
      piiDetection: true,
      auditRetentionDays: 365,
      autoLockMinutes: 30,
      defaultApproval: "external",
    },
  },
  financial: {
    name: "Financial Services",
    description: "GLBA + SOX aligned",
    defaults: {
      defaultClassification: "confidential",
      cloudAllowed: false,
      piiDetection: true,
      auditRetentionDays: 2555, // 7 years
      autoLockMinutes: 15,
      defaultApproval: "always",
    },
  },
};

export function getProfile(name: string): SecurityProfile | undefined {
  return PROFILES[name];
}

export function listProfiles(): SecurityProfile[] {
  return Object.values(PROFILES);
}
