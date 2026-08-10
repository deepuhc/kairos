export interface ToolBodyOpenInput {
  hasBody: boolean;
  expanded: boolean;
  startExpanded: boolean;
  defaultExpanded: boolean;
  awaiting: boolean;
  userToggled: boolean;
  isSubAgent: boolean;
}

export function defaultDiffBodyExpanded(
  hasDiff: boolean,
  _status: string,
  _collapseReplayDiffs = false,
): boolean {
  if (!hasDiff) return false;
  return false;
}

export function toolBodyOpen({
  hasBody,
  expanded,
  startExpanded,
  defaultExpanded,
  awaiting,
  userToggled,
  isSubAgent,
}: ToolBodyOpenInput): boolean {
  if (!hasBody) return false;
  if (expanded || awaiting) return true;
  if (userToggled) return false;
  if (startExpanded) return true;
  return defaultExpanded && !isSubAgent;
}
