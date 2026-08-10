import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
// @ts-expect-error - plain ESM script without type declarations
import { dbConfigFromEnv, normalizeDbRows, writeTestimonialsSnapshot } from '../../scripts/ci/export-testimonials.mjs';

describe('export testimonials', () => {
  it('normalizes database rows into the public snapshot shape', () => {
    expect(normalizeDbRows([
      { username: ' rajat ', note: ' useful ', created_at_epoch: 1785232800 },
      { username: '', note: 'missing author', created_at_epoch: 1785232800 },
      { username: 'anon', note: '   ', created_at_epoch: 1785232800 },
    ])).toEqual([
      {
        username: 'rajat',
        note: 'useful',
        created_at: '2026-07-28T10:00:00.000Z',
      },
    ]);
  });

  it('writes testimonials atomically with a total count', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'kairos-export-testimonials-'));
    try {
      const outFile = path.join(root, 'nested', 'testimonials.json');
      writeTestimonialsSnapshot(outFile, [
        { username: 'maya', note: 'Kairos keeps my agents organized.', created_at: '2026-07-28T10:00:00Z' },
      ]);

      expect(JSON.parse(readFileSync(outFile, 'utf8'))).toEqual({
        testimonials: [
          {
            username: 'maya',
            note: 'Kairos keeps my agents organized.',
            created_at: '2026-07-28T10:00:00Z',
          },
        ],
        total: 1,
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('uses the same database environment variables as the backend', () => {
    expect(dbConfigFromEnv({
      KAIROS_USAGE_DB_HOST: 'db.example.test',
      KAIROS_USAGE_DB_NAME: 'kairos',
      KAIROS_USAGE_DB_USER: 'reader',
      KAIROS_USAGE_DB_PASSWORD: 'secret',
      KAIROS_USAGE_DB_CONNECT_TIMEOUT_MS: '9000',
    })).toMatchObject({
      host: 'db.example.test',
      database: 'kairos',
      user: 'reader',
      password: 'secret',
      connectTimeout: 9000,
    });
  });
});
