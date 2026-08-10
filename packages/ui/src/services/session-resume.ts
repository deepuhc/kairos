export function usableSessionDir(dir: string | null | undefined): string | null {
  const trimmed = (dir ?? '').trim();
  if (!trimmed || /^\\+$/.test(trimmed)) return null;
  return trimmed;
}
