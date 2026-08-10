import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error - plain ESM script without type declarations
import {
  RELEASE_NOTES_RELATIVE_PATH,
  generateReleaseNotesMarkdown,
  updateReleaseNotes,
} from '../../scripts/ci/update-release-notes.mjs';

function fakeGit(args: string[]) {
  if (args[0] === 'tag') return 'v0.1.9\n';
  if (args[0] === 'log') {
    const range = args[1];
    if (range === 'v0.1.9..HEAD') return 'feat: launch the thing\nfix: patch the thing\n';
    return '\n';
  }
  throw new Error(`unexpected git ${args.join(' ')}`);
}

function createTempRoot(version = '0.2.0') {
  const root = mkdtempSync(path.join(tmpdir(), 'kairos-notes-'));
  mkdirSync(path.join(root, 'src-tauri'), { recursive: true });
  writeFileSync(path.join(root, 'src-tauri', 'tauri.conf.json'), JSON.stringify({ version }));
  return root;
}

describe('updateReleaseNotes', () => {
  it('generates normalized markdown from release-tag commit ranges', () => {
    expect(generateReleaseNotesMarkdown({ version: 'v0.2.0', to: 'HEAD', run: fakeGit })).toBe(
      '### v0.2.0\n\n- Launch the thing\n- Patch the thing\n',
    );
  });

  it('writes and checks the committed release notes file', () => {
    const root = createTempRoot();
    try {
      const written = updateReleaseNotes({ root, to: 'HEAD', run: fakeGit });
      expect(written.ok).toBe(true);
      expect(readFileSync(path.join(root, RELEASE_NOTES_RELATIVE_PATH), 'utf8')).toBe(
        '### v0.2.0\n\n- Launch the thing\n- Patch the thing\n',
      );

      expect(updateReleaseNotes({ root, to: 'HEAD', run: fakeGit, check: true }).ok).toBe(true);
      writeFileSync(path.join(root, RELEASE_NOTES_RELATIVE_PATH), 'stale\n');
      expect(updateReleaseNotes({ root, to: 'HEAD', run: fakeGit, check: true }).ok).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
