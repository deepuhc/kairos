#!/usr/bin/env node
// Kairos cross-platform installer core.
//
// One code path for macOS, Linux, and Windows: clone (or update) the repo,
// install dependencies, build, and create a double-clickable launcher that runs
// the supervisor — so the in-app Update button can self-update afterward. The
// thin per-OS entry points (Install Kairos.command / .bat / install.sh) just
// locate a Node and invoke this file.
//
// Prerequisites on the target machine: git and Node.js 20+. Both are checked
// up front with a clear message rather than a cryptic failure.
//
// Env / args:
//   KAIROS_REPO   git URL to clone (default: the public repo)
//   KAIROS_HOME   install location (default: ~/Kairos)
//   KAIROS_BRANCH branch to track (default: main)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

const REPO = process.env.KAIROS_REPO || 'https://github.com/deepuhc/kairos.git';
const BRANCH = process.env.KAIROS_BRANCH || 'main';
const HOME = process.env.KAIROS_HOME || join(homedir(), 'Kairos');
const OS = platform();
const isWin = OS === 'win32';

function log(msg) { console.log(`\n\x1b[1;36m==>\x1b[0m ${msg}`); }
function die(msg) { console.error(`\n\x1b[1;31mError:\x1b[0m ${msg}\n`); process.exit(1); }

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { stdio: 'inherit', ...opts });
}
function shOut(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf-8', ...opts }).trim();
}

// --- Preflight: git + Node 20+ ------------------------------------------------
function preflight() {
  try { shOut('git', ['--version']); }
  catch { die('git is not installed. Install it from https://git-scm.com and re-run.'); }

  const major = parseInt(process.versions.node.split('.')[0], 10);
  if (major < 20) die(`Node.js 20+ is required (found ${process.versions.node}). Get it from https://nodejs.org.`);
}

// --- Clone or update ----------------------------------------------------------
function cloneOrUpdate() {
  if (existsSync(join(HOME, '.git'))) {
    log(`Updating existing install at ${HOME}…`);
    sh('git', ['-C', HOME, 'fetch', '--quiet'], {});
    sh('git', ['-C', HOME, 'checkout', BRANCH], {});
    sh('git', ['-C', HOME, 'merge', '--ff-only', `origin/${BRANCH}`], {});
  } else {
    log(`Cloning Kairos into ${HOME}…`);
    mkdirSync(HOME, { recursive: true });
    sh('git', ['clone', '--branch', BRANCH, REPO, HOME], {});
  }
}

// --- Install + build ----------------------------------------------------------
function installAndBuild() {
  const npm = isWin ? 'npm.cmd' : 'npm';
  log('Installing dependencies (this can take a few minutes)…');
  sh(npm, ['install', '--no-audit', '--no-fund'], { cwd: HOME });
  log('Building…');
  sh(npm, ['run', 'build'], { cwd: HOME });
}

// --- Create a double-clickable launcher --------------------------------------
function createLauncher() {
  const supervisor = join(HOME, 'packages', 'desktop', 'supervisor.mjs');
  if (OS === 'darwin') return createMacApp(supervisor);
  if (isWin) return createWindowsLauncher(supervisor);
  return createLinuxLauncher(supervisor);
}

function createMacApp(supervisor) {
  const app = join(HOME, 'Kairos.app');
  const macos = join(app, 'Contents', 'MacOS');
  const resources = join(app, 'Contents', 'Resources');
  mkdirSync(macos, { recursive: true });
  mkdirSync(resources, { recursive: true });

  const icns = join(HOME, 'packages', 'desktop', 'src-tauri', 'icons', 'icon.icns');
  if (existsSync(icns)) sh('cp', [icns, join(resources, 'kairos.icns')], {});

  writeFileSync(join(app, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>Kairos</string>
  <key>CFBundleDisplayName</key><string>Kairos</string>
  <key>CFBundleIdentifier</key><string>com.kairos.app</string>
  <key>CFBundleExecutable</key><string>Kairos</string>
  <key>CFBundleIconFile</key><string>kairos.icns</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>\n`);

  // The launcher finds a Node 20+ (GUI apps get a bare PATH) and runs the
  // supervisor, which serves the app and handles self-update.
  writeFileSync(join(macos, 'Kairos'), `#!/bin/sh
HOME_DIR="${HOME}"
find_node() {
  for c in "$(command -v node 2>/dev/null)" /opt/homebrew/bin/node /usr/local/bin/node "$HOME/.nvm/versions/node"/*/bin/node /usr/bin/node; do
    [ -x "$c" ] || continue
    m="$("$c" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
    [ "$m" -ge 20 ] 2>/dev/null && { echo "$c"; return 0; }
  done
  return 1
}
NODE="$(find_node)" || { osascript -e 'display alert "Kairos needs Node.js 20+" message "Install from https://nodejs.org and reopen." as critical'; exit 1; }
exec "$NODE" "$HOME_DIR/packages/desktop/supervisor.mjs"
`);
  chmodSync(join(macos, 'Kairos'), 0o755);
  return app;
}

function createWindowsLauncher(supervisor) {
  // A .cmd that starts the supervisor without a console window lingering.
  const cmd = join(HOME, 'Kairos.cmd');
  writeFileSync(cmd, `@echo off\r\nstart "" /min node "${supervisor}"\r\n`);
  // Best-effort Start-menu / desktop shortcut via PowerShell.
  try {
    const desktop = join(homedir(), 'Desktop');
    const ps = `$s=(New-Object -ComObject WScript.Shell).CreateShortcut('${join(desktop, 'Kairos.lnk').replace(/\\/g, '\\\\')}');`
      + `$s.TargetPath='${cmd.replace(/\\/g, '\\\\')}';$s.WorkingDirectory='${HOME.replace(/\\/g, '\\\\')}';$s.Save()`;
    execFileSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'ignore' });
  } catch { /* shortcut is a nicety; the .cmd still works */ }
  return cmd;
}

function createLinuxLauncher(supervisor) {
  const sh = join(HOME, 'kairos');
  writeFileSync(sh, `#!/bin/sh\nexec node "${supervisor}"\n`);
  chmodSync(sh, 0o755);
  // A .desktop entry so it shows up in the app menu / is double-clickable.
  try {
    const appsDir = join(homedir(), '.local', 'share', 'applications');
    mkdirSync(appsDir, { recursive: true });
    const icon = join(HOME, 'packages', 'desktop', 'src-tauri', 'icons', '128x128.png');
    writeFileSync(join(appsDir, 'kairos.desktop'),
      `[Desktop Entry]\nType=Application\nName=Kairos\nExec=${sh}\n${existsSync(icon) ? `Icon=${icon}\n` : ''}Terminal=false\nCategories=Development;\n`);
    chmodSync(join(appsDir, 'kairos.desktop'), 0o755);
  } catch { /* menu entry is a nicety; ./kairos still works */ }
  return sh;
}

// --- Run ----------------------------------------------------------------------
function main() {
  log('Installing Kairos');
  preflight();
  cloneOrUpdate();
  installAndBuild();
  const launcher = createLauncher();
  log('Done.');
  console.log(`\n  Installed at: ${HOME}`);
  console.log(`  Launch it:    ${launcher}`);
  if (OS === 'darwin') console.log('  (Drag Kairos.app to /Applications if you like, then double-click it.)');
  console.log('\n  Updates: click "Update Kairos" in the app when a new version is available.\n');
}

main();
