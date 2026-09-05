#!/usr/bin/env node
// Kairos supervisor — the cross-platform half of git-based self-update.
//
// It runs the built server as a child process and watches its exit code:
//   - exit 42 (RESTART_EXIT_CODE): the server just fast-forwarded the clone and
//     wants a fresh build. The supervisor runs `npm install` (in case deps
//     changed) + `npm run build`, then relaunches the server on the SAME port.
//   - any other exit: the supervisor exits with the same code (normal quit).
//
// This is deliberately Node-only (no bash/PowerShell branching) so one script
// drives updates identically on macOS, Linux, and Windows. The first-run
// installer/launcher scripts just invoke `node supervisor.mjs`.
//
// Env:
//   PORT              port to run the server on (default: pick a free one)
//   KAIROS_NO_OPEN=1  don't open the browser on first boot
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { platform } from 'node:process';

const RESTART_EXIT_CODE = 42;
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..'); // packages/desktop -> repo root
const serverEntry = join(repoRoot, 'packages', 'server', 'dist', 'main.js');
const npmCmd = platform === 'win32' ? 'npm.cmd' : 'npm';

function log(msg) {
  console.log(`[kairos] ${msg}`);
}

function pickFreePort() {
  return new Promise((resolve) => {
    const s = createServer();
    s.listen(0, () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

// Run a command to completion, streaming its output. Rejects on nonzero exit.
function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: repoRoot, stdio: 'inherit', shell: false, ...opts });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} exited ${code}`))));
  });
}

// Did dependency manifests change between two commits? We only reinstall when
// they did — most feedback-driven updates are code-only, and an unconditional
// `npm install` is both slow and exposed to npm's optional-deps native-binary
// bug (#4828), which can leave the tree unbuildable. Skipping it when nothing
// changed keeps updates fast and safe.
function depsChanged(fromCommit, toCommit) {
  if (!fromCommit || !toCommit || fromCommit === toCommit) return false;
  try {
    const out = execFileSync('git', ['diff', '--name-only', fromCommit, toCommit], {
      cwd: repoRoot,
      encoding: 'utf-8',
    });
    return out.split('\n').some((f) => f === 'package-lock.json' || /(^|\/)package\.json$/.test(f));
  } catch {
    // If we can't tell, err on the side of reinstalling — correctness over speed.
    return true;
  }
}

async function rebuild(fromCommit, toCommit) {
  if (depsChanged(fromCommit, toCommit)) {
    log('Dependencies changed — installing…');
    try {
      await run(npmCmd, ['install', '--no-audit', '--no-fund']);
    } catch (err) {
      // A failed install shouldn't strand the user on a half-updated tree; the
      // build below will surface the real problem if deps are actually broken.
      log(`npm install reported: ${err.message} (continuing to build)`);
    }
  } else {
    log('No dependency changes — skipping install.');
  }
  log('Building…');
  await run(npmCmd, ['run', 'build']);
  log('Build complete.');
}

// The commit HEAD points at right now, or null if git isn't available.
function currentCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
}

function startServer(port, openBrowser) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [serverEntry], {
      cwd: repoRoot,
      stdio: 'inherit',
      env: { ...process.env, PORT: String(port), KAIROS_UI_DIST: join(repoRoot, 'packages', 'ui', 'dist') },
    });
    if (openBrowser) openInBrowser(port);
    child.on('exit', (code) => resolve(code ?? 0));
    // Forward Ctrl+C / termination to the child so quitting is clean.
    const stop = () => child.kill();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}

function openInBrowser(port) {
  const url = `http://localhost:${port}`;
  // Wait a beat for the server to bind before opening.
  setTimeout(() => {
    const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open';
    const args = platform === 'win32' ? ['/c', 'start', '', url] : [url];
    try {
      spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
    } catch {
      log(`Open ${url} in your browser.`);
    }
  }, 1200);
}

async function main() {
  if (!existsSync(serverEntry)) {
    log('Server not built yet — building first…');
    await run(npmCmd, ['run', 'build']);
  }
  const port = process.env.PORT ? parseInt(process.env.PORT, 10) : await pickFreePort();
  const openBrowser = process.env.KAIROS_NO_OPEN !== '1';
  log(`Starting Kairos on http://localhost:${port}`);

  let firstBoot = true;
  for (;;) {
    // Capture the commit before the server runs; if it exits asking for a
    // restart, HEAD has already been fast-forwarded, so this is the "from".
    const before = currentCommit();
    const code = await startServer(port, firstBoot && openBrowser);
    firstBoot = false;
    if (code === RESTART_EXIT_CODE) {
      log('Applying update and restarting…');
      try {
        await rebuild(before, currentCommit());
      } catch (err) {
        log(`Update build failed: ${err.message}`);
        log('Restarting the previous build so the app stays usable.');
      }
      continue; // relaunch on the same port
    }
    log(`Server exited (${code}). Shutting down.`);
    process.exit(code);
  }
}

main().catch((err) => {
  log(`Fatal: ${err.message}`);
  process.exit(1);
});
