/**
 * Immutable audit log for compliance and debugging.
 * Append-only log of all orchestrator actions.
 */

import { writeFile, appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export interface AuditEntry {
  timestamp: string;
  sessionId: string;
  user?: string;
  agent: string;
  action: string;
  details?: Record<string, unknown>;
  dataClassification: string;
  modelUsed: string;
  dataSentToCloud: boolean;
  approvalGate?: string;
  durationMs?: number;
  costUsd?: number;
}

export interface AuditConfig {
  /** Directory to store audit logs */
  logDir: string;
  /** Retention in days (default: 2555 = 7 years) */
  retentionDays?: number;
  /** Whether to write to stdout as well */
  verbose?: boolean;
}

export class AuditLog {
  private config: AuditConfig;
  private initialized = false;

  constructor(config: AuditConfig) {
    this.config = {
      retentionDays: 2555,
      verbose: false,
      ...config,
    };
  }

  async record(entry: AuditEntry): Promise<void> {
    if (!this.initialized) {
      await mkdir(this.config.logDir, { recursive: true });
      this.initialized = true;
    }

    const line = JSON.stringify(entry) + "\n";
    const date = entry.timestamp.slice(0, 10); // YYYY-MM-DD
    const logFile = join(this.config.logDir, `audit-${date}.jsonl`);

    await appendFile(logFile, line, "utf-8");

    if (this.config.verbose) {
      process.stderr.write(
        `[audit] ${entry.agent}:${entry.action} (${entry.dataClassification})\n`
      );
    }
  }

  /** Create an entry with current timestamp */
  entry(
    partial: Omit<AuditEntry, "timestamp" | "sessionId">,
    sessionId: string
  ): AuditEntry {
    return {
      timestamp: new Date().toISOString(),
      sessionId,
      ...partial,
    };
  }
}
