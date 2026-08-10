export type DropPosition = 'before' | 'after';

export function moveId(ids: string[], sourceId: string, targetId: string, position: DropPosition): string[] {
  if (sourceId === targetId) return ids;
  const from = ids.indexOf(sourceId);
  const target = ids.indexOf(targetId);
  if (from === -1 || target === -1) return ids;

  const next = ids.filter((id) => id !== sourceId);
  const targetAfterRemoval = next.indexOf(targetId);
  if (targetAfterRemoval === -1) return ids;

  const insertAt = position === 'after' ? targetAfterRemoval + 1 : targetAfterRemoval;
  next.splice(insertAt, 0, sourceId);
  return next;
}

export function reorderByIds<T>(
  items: T[],
  ids: string[],
  getId: (item: T) => string,
): T[] {
  const order = new Map(ids.map((id, index) => [id, index]));
  return [...items].sort((a, b) => {
    const ai = order.get(getId(a));
    const bi = order.get(getId(b));
    if (ai == null && bi == null) return 0;
    if (ai == null) return 1;
    if (bi == null) return -1;
    return ai - bi;
  });
}
