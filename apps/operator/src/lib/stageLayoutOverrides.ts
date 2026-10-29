/** Set or clear one screen's override; other keys (even for removed screens) are kept. Empty map -> undefined. */
export function nextStageLayouts(
  value: Record<string, string> | undefined,
  channel: string,
  layoutId: string,
): Record<string, string> | undefined {
  const next = { ...(value ?? {}) };
  if (layoutId) next[channel] = layoutId;
  else delete next[channel];
  return Object.keys(next).length > 0 ? next : undefined;
}
