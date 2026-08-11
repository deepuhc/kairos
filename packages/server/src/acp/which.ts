import { existsSync, statSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';

// Is `command` runnable from PATH? Used to mark external stdio agents as
// installed/uninstalled in the catalog so the UI can show a real backend as
// unavailable instead of offering a connect that will immediately fail to spawn.
// A bare name is searched across $PATH (respecting PATHEXT on Windows); an
// absolute/relative path is checked directly.
export function isOnPath(command: string, environment: NodeJS.ProcessEnv = process.env): boolean {
  if (!command) return false;

  const isFile = (p: string): boolean => {
    try {
      return existsSync(p) && statSync(p).isFile();
    } catch {
      return false;
    }
  };

  // Explicit path — check it (and Windows extension variants) directly.
  const exts = process.platform === 'win32'
    ? (environment.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [''];
  const withExts = (base: string) => (exts.length ? exts.map((e) => base + e) : [base]);

  if (isAbsolute(command) || command.includes('/') || command.includes('\\')) {
    return withExts(command).some(isFile);
  }

  const pathDirs = (environment.PATH ?? '').split(process.platform === 'win32' ? ';' : ':').filter(Boolean);
  return pathDirs.some((dir) => withExts(join(dir, command)).some(isFile));
}
