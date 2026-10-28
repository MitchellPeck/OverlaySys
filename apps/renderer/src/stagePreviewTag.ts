export interface StageLayoutPreview {
  channel: string;
  layoutId: string;
}

/** True while an operator is previewing a stage layout on `channel`. */
export function isPreviewingChannel(previews: readonly StageLayoutPreview[], channel: string): boolean {
  return previews.some((p) => p.channel === channel);
}
