import { exec as execCb } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { mkdir, rm } from 'node:fs/promises';

const exec = promisify(execCb);

export interface WorktreeInfo {
  agentId: string;
  branch: string;
  path: string;
  baseBranch: string;
}

export interface MergeResult {
  status: 'merged' | 'conflict' | 'error';
  conflictFiles?: string[];
  error?: string;
}

export class WorktreeManager {
  private baseDir: string;
  private projectDir: string;
  private worktrees = new Map<string, WorktreeInfo>();

  constructor(projectDir: string) {
    this.projectDir = projectDir;
    this.baseDir = join(projectDir, '.kairos', 'worktrees');
  }

  async create(agentId: string, baseBranch = 'main'): Promise<WorktreeInfo> {
    await mkdir(this.baseDir, { recursive: true });

    const branch = `kairos/${agentId}`;
    const worktreePath = join(this.baseDir, agentId);

    await exec(`git worktree add "${worktreePath}" -b "${branch}"`, { cwd: this.projectDir });

    const info: WorktreeInfo = { agentId, branch, path: worktreePath, baseBranch };
    this.worktrees.set(agentId, info);
    return info;
  }

  async merge(agentId: string): Promise<MergeResult> {
    const info = this.worktrees.get(agentId);
    if (!info) return { status: 'error', error: `No worktree for agent ${agentId}` };

    try {
      // Check if there are any commits on the agent branch
      const { stdout: diffOutput } = await exec(
        `git log ${info.baseBranch}..${info.branch} --oneline`,
        { cwd: this.projectDir }
      );

      if (!diffOutput.trim()) {
        return { status: 'merged' }; // Nothing to merge
      }

      await exec(`git merge ${info.branch} --no-ff -m "Merge agent ${agentId}"`, { cwd: this.projectDir });
      return { status: 'merged' };
    } catch (err) {
      const errorStr = String(err);
      if (errorStr.includes('CONFLICT')) {
        // Abort the merge
        await exec('git merge --abort', { cwd: this.projectDir }).catch(() => {});
        const conflictFiles = errorStr
          .split('\n')
          .filter((l) => l.includes('CONFLICT'))
          .map((l) => l.replace(/.*CONFLICT.*:\s*/, '').trim());
        return { status: 'conflict', conflictFiles };
      }
      return { status: 'error', error: errorStr };
    }
  }

  async cleanup(agentId: string): Promise<void> {
    const info = this.worktrees.get(agentId);
    if (!info) return;

    try {
      await exec(`git worktree remove "${info.path}" --force`, { cwd: this.projectDir });
    } catch {
      await rm(info.path, { recursive: true, force: true });
      await exec('git worktree prune', { cwd: this.projectDir });
    }

    try {
      await exec(`git branch -D "${info.branch}"`, { cwd: this.projectDir });
    } catch {
      // branch may not exist
    }

    this.worktrees.delete(agentId);
  }

  list(): WorktreeInfo[] {
    return [...this.worktrees.values()];
  }

  getPath(agentId: string): string | undefined {
    return this.worktrees.get(agentId)?.path;
  }
}
