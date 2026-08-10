import { describe, expect, it } from 'vitest';
// @ts-expect-error - plain ESM script without type declarations
import {
  collectBullets,
  formatReleaseNotes,
  generateReleaseNotes,
} from '../../scripts/ci/generate-release-notes.mjs';

describe('collectBullets', () => {
  it('strips type prefix and sentence-cases all bullets into a flat list', () => {
    const bullets = collectBullets([
      'feat: add whats-new panel',
      'feat(agents): live steering',
      'fix: correct scroll offset',
      'fix(ui)!: breaking layout fix',
    ]);
    expect(bullets).toEqual([
      'Add whats-new panel',
      'Live steering',
      'Correct scroll offset',
      'Breaking layout fix',
    ]);
  });

  it('includes non-conventional subjects with sentence casing', () => {
    const bullets = collectBullets(['Update download page screenshot', 'refine Poly mascot eyes']);
    expect(bullets).toEqual(['Update download page screenshot', 'Refine Poly mascot eyes']);
  });

  it('drops chore/ci/docs/test/build/style/refactor, merges, and version bumps', () => {
    const bullets = collectBullets([
      'chore: bump deps',
      'ci: tweak pipeline',
      'docs: update readme',
      'test: add coverage',
      'build: adjust bundler',
      'style: reformat',
      'refactor: extract helper',
      'Merge branch main into feature',
      'Merge pull request #12 from x/y',
      'release: 0.1.47',
      '0.1.47',
      'feat: real feature',
    ]);
    expect(bullets).toEqual(['Real feature']);
  });

  it('ignores blank subjects', () => {
    const bullets = collectBullets(['', '   ', 'feat: kept']);
    expect(bullets).toEqual(['Kept']);
  });
});

describe('formatReleaseNotes', () => {
  it('emits a version heading with flat bullet list', () => {
    const md = formatReleaseNotes(['Add feature', 'Fix bug', 'Polish UI'], '1.2.3');
    expect(md).toBe("### v1.2.3\n\n- Add feature\n- Fix bug\n- Polish UI");
  });

  it('falls back to a title line when there are no bullets', () => {
    const md = formatReleaseNotes([], '1.2.3');
    expect(md).toBe('Kairos v1.2.3');
  });
});

describe('generateReleaseNotes', () => {
  // Model a repo as an ordered list of tags (newest-first) plus the commit
  // subjects for each `floor..ceiling` range keyed as "floor..ceiling" (or just
  // "ceiling" for the no-floor first release).
  function fakeGit(tags: string[], subjectsByRange: Record<string, string[]>) {
    return (args: string[]) => {
      if (args[0] === 'tag') return `${tags.join('\n')}\n`;
      if (args[0] === 'log') {
        const range = args[1];
        return `${(subjectsByRange[range] ?? []).join('\n')}\n`;
      }
      throw new Error(`unexpected git ${args.join(' ')}`);
    };
  }

  it('uses the previous tag as the range floor and formats the log', () => {
    const md = generateReleaseNotes({
      version: '0.1.47',
      to: 'abc123',
      run: fakeGit(['v0.1.46'], { 'v0.1.46..abc123': ['feat: new thing', 'fix: a bug'] }),
    });
    expect(md).toBe("### v0.1.47\n\n- New thing\n- A bug");
  });

  it('falls back to the title line when the range has no notable commits', () => {
    const md = generateReleaseNotes({
      version: '0.1.47',
      to: 'abc123',
      run: fakeGit(['v0.1.46'], { 'v0.1.46..abc123': ['chore: bump', 'ci: fix'] }),
    });
    expect(md).toBe('Kairos v0.1.47');
  });

  it('handles a first release with no previous tag', () => {
    const md = generateReleaseNotes({
      version: '0.1.0',
      to: 'abc123',
      run: fakeGit([], { abc123: ['feat: first'] }),
    });
    expect(md).toBe("### v0.1.0\n\n- First");
  });

  it('emits the last few releases separated by --- dividers, newest first', () => {
    const md = generateReleaseNotes({
      version: '0.1.47',
      to: 'abc123',
      history: 3,
      run: fakeGit(['v0.1.46', 'v0.1.45', 'v0.1.44'], {
        'v0.1.46..abc123': ['feat: newest'],
        'v0.1.45..v0.1.46': ['fix: mid'],
        'v0.1.44..v0.1.45': ['feat: old'],
      }),
    });
    expect(md).toBe(
      "### v0.1.47\n\n- Newest\n\n---\n\n"
        + "### v0.1.46\n\n- Mid\n\n---\n\n"
        + "### v0.1.45\n\n- Old",
    );
  });

  it('honors the history count and stops after N releases', () => {
    const md = generateReleaseNotes({
      version: '0.1.47',
      to: 'abc123',
      history: 2,
      run: fakeGit(['v0.1.46', 'v0.1.45', 'v0.1.44'], {
        'v0.1.46..abc123': ['feat: newest'],
        'v0.1.45..v0.1.46': ['fix: mid'],
        'v0.1.44..v0.1.45': ['feat: old'],
      }),
    });
    expect(md).toBe(
      "### v0.1.47\n\n- Newest\n\n---\n\n"
        + "### v0.1.46\n\n- Mid",
    );
  });

  it('skips older releases that have no notable commits but keeps rendering newer ones', () => {
    const md = generateReleaseNotes({
      version: '0.1.47',
      to: 'abc123',
      history: 3,
      run: fakeGit(['v0.1.46', 'v0.1.45'], {
        'v0.1.46..abc123': ['feat: newest'],
        'v0.1.45..v0.1.46': ['chore: nothing user-facing'],
        'v0.1.45': ['docs: also nothing'],
      }),
    });
    expect(md).toBe("### v0.1.47\n\n- Newest");
  });

  it('--from pins a single release range and disables history walking', () => {
    const md = generateReleaseNotes({
      version: '0.1.47',
      to: 'abc123',
      from: 'v0.1.40',
      run: fakeGit(['v0.1.46', 'v0.1.45'], {
        'v0.1.40..abc123': ['feat: spanning several tags'],
      }),
    });
    expect(md).toBe("### v0.1.47\n\n- Spanning several tags");
  });
});
