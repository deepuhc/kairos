function trimLineSuffix(path: string): string {
  return path.replace(/:(\d+)(?::\d+)?$/, '');
}

function stripHrefDecorations(href: string): string {
  return trimLineSuffix(href.split('#', 1)[0].split('?', 1)[0]);
}

function decodePath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function cleanRelativePath(path: string): string | null {
  let rel = decodePath(path).replace(/\\/g, '/').replace(/^\/+/, '');
  while (rel.startsWith('./')) rel = rel.slice(2);
  if (!rel || rel.endsWith('/')) return null;
  const parts = rel.split('/');
  if (parts.some((p) => !p || p === '.' || p === '..')) return null;
  return parts.join('/');
}

function relativeToBase(path: string, base: string): string | null {
  const normalizedBase = base.replace(/\/+$/, '');
  const normalizedPath = path.replace(/\/+$/, '');
  if (!normalizedBase || normalizedPath === normalizedBase) return null;
  if (!normalizedPath.startsWith(`${normalizedBase}/`)) return null;
  return cleanRelativePath(normalizedPath.slice(normalizedBase.length + 1));
}

export function workspacePathFromHref(href: string, workdir: string, cwd = workdir): string | null {
  const raw = href.trim();
  if (!raw || raw.startsWith('#') || raw.startsWith('//')) return null;
  const protocol = /^([a-z][a-z0-9+.-]*):/i.exec(raw)?.[1]?.toLowerCase();
  if (protocol && protocol !== 'file') return null;

  let path = raw;
  if (protocol === 'file') {
    try {
      path = new URL(raw).pathname;
    } catch {
      path = raw.replace(/^file:\/*/i, '/');
    }
  }

  path = decodePath(stripHrefDecorations(path)).replace(/\\/g, '/');
  if (!path) return null;

  if (path.startsWith('/')) {
    const rel = relativeToBase(path, workdir) ?? relativeToBase(path, cwd);
    if (rel) return rel;
    if (/^\/(?:Applications|Users|Volumes|home|opt|private|tmp|var)\//.test(path)) return null;
    return cleanRelativePath(path);
  }
  return cleanRelativePath(path);
}
