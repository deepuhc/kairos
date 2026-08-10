import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const source = readFileSync(path.join(__dirname, '..', 'components', 'agents-source-control.ts'), 'utf8');

describe('agents source control panel', () => {
  it('loads git status for the session workdir and reports a rail summary', () => {
    expect(source).toContain("import { getGitStatus");
    expect(source).toContain('return this.session.worktree?.worktreePath ?? this.session.cwd;');
    expect(source).toContain("this.dispatchEvent(new CustomEvent('source-status'");
    expect(source).toContain('changes: status?.changes.length ?? 0');
  });

  it('groups source-control entries into standard git buckets', () => {
    expect(source).toContain("type ChangeGroupId = 'conflicted' | 'staged' | 'unstaged' | 'untracked';");
    expect(source).toContain("title: 'Merge conflicts'");
    expect(source).toContain("title: 'Staged changes'");
    expect(source).toContain("title: 'Changes'");
    expect(source).toContain("title: 'Untracked files'");
  });

  it('hands file selection back to the existing Files panel', () => {
    expect(source).toContain("this.dispatchEvent(new CustomEvent('open-file'");
    expect(source).toContain('detail: { path }');
    expect(source).toContain("if (!deleted) this.openFile(change.path);");
  });
});
