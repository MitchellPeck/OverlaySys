// Which output windows must be taken down after a display change. Pure so it
// can be unit-tested; main.ts feeds it Electron's screen state.
//
// When a projector or TV is unplugged, the OS moves its windows onto a
// remaining display — usually the operator's. A fullscreen, always-on-top
// output would then cover the console mid-service. We close those windows;
// the existing display-added path reopens auto-open channels when the
// display comes back.

export interface OpenOutput {
  channelId: string;
  /** Display the window was opened on (Electron Display.id). */
  displayId: number | undefined;
}

/**
 * Channel ids whose window was opened on a display that is no longer
 * attached. Windows with no recorded display (opened on the primary by
 * default) are left alone.
 */
export function outputsOnRemovedDisplays(
  outputs: OpenOutput[],
  attachedDisplayIds: number[],
): string[] {
  const attached = new Set(attachedDisplayIds);
  return outputs
    .filter((o) => o.displayId !== undefined && !attached.has(o.displayId))
    .map((o) => o.channelId);
}
