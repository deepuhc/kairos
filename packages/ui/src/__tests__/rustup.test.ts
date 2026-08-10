import path from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-ignore - plain ESM script without type declarations
import { addCargoBinToPath, cargoBinDir, cargoCommand, ensureRust, hasCargo } from '../../scripts/lib/rustup.mjs';

// Expected cargo bin path is derived via path.join so these assertions hold on
// both POSIX (/Users/example/.cargo/bin) and Windows (\Users\example\.cargo\bin).
const CARGO_BIN = path.join('/Users/example', '.cargo', 'bin');

describe('rustup helpers', () => {
  it('resolves the cargo bin directory under the user home', () => {
    expect(cargoBinDir({ homeDir: '/Users/example' })).toBe(CARGO_BIN);
  });

  it('prepends cargo bin to PATH when it exists', () => {
    const env = { PATH: '/usr/bin:/bin' };

    addCargoBinToPath(env, {
      delimiter: ':',
      homeDir: '/Users/example',
      exists: (entry: string) => entry === CARGO_BIN,
    });

    expect(env.PATH).toBe(`${CARGO_BIN}:/usr/bin:/bin`);
  });

  it('uses the bare cargo command on every platform, including Windows', () => {
    // rustup ships cargo.exe, not a cargo.cmd shim, so probing cargo.cmd on
    // Windows always fails and wrongly reports Rust as missing.
    expect(cargoCommand()).toBe('cargo');
  });

  it('probes cargo (not cargo.cmd) on win32', () => {
    const calls: Array<{ command: string; shell: boolean }> = [];
    const found = hasCargo({}, {
      platform: 'win32',
      spawnSync: (command: string, _args: string[], opts: { shell: boolean }) => {
        calls.push({ command, shell: opts.shell });
        return { status: 0 };
      },
    });

    expect(found).toBe(true);
    expect(calls).toEqual([{ command: 'cargo', shell: true }]);
  });

  it('detects cargo with the platform command', () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const found = hasCargo({}, {
      platform: 'linux',
      spawnSync: (command: string, args: string[]) => {
        calls.push({ command, args });
        return { status: 0 };
      },
    });

    expect(found).toBe(true);
    expect(calls).toEqual([{ command: 'cargo', args: ['--version'] }]);
  });

  it('returns true when cargo is already installed', () => {
    const commands: string[] = [];
    const env = { PATH: '/usr/bin' };
    const ok = ensureRust(env, {
      platform: 'linux',
      delimiter: ':',
      homeDir: '/Users/example',
      exists: () => true,
      spawnSync: (command: string) => {
        commands.push(command);
        return { status: 0 };
      },
    });

    expect(ok).toBe(true);
    expect(commands).toEqual(['cargo']);
    expect(env.PATH).toContain(CARGO_BIN);
  });

  it('never installs rust when cargo is missing', () => {
    const commands: string[] = [];
    const ok = ensureRust({ PATH: '/usr/bin' }, {
      platform: 'linux',
      spawnSync: (command: string) => {
        commands.push(command);
        return { status: 1 };
      },
    });

    expect(ok).toBe(false);
    // Only the cargo detection probe runs; no rustup installer is ever spawned.
    expect(commands).toEqual(['cargo']);
  });
});
