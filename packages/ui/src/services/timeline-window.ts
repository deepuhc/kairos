// Helpers for the Agents timeline's bottom-anchored render window.

export function preserveTimelineWindowStart(
  currentCap: number,
  previousLength: number,
  nextLength: number,
): number {
  if (nextLength <= previousLength) return currentCap;
  const previousHidden = Math.max(0, previousLength - currentCap);
  return Math.max(currentCap, nextLength - previousHidden);
}
