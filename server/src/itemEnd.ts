import type { ChannelState, RowSource } from "@overlaysys/core";

/**
 * The rundown rows a channel is showing right now: the graphic's row while it
 * is on screen, the row of a live song/scripture/slides session, and a video's
 * row until it finishes. Queued (armed) items don't count, nor does a
 * non-looping media deck holding its last slide, nor a template deck its
 * timer ran to the end.
 */
export function rowsOnAir(st: ChannelState, activeSource: RowSource | null): Set<string> {
  const rows = new Set<string>();
  if (st.active && st.active.phase !== "out" && activeSource) rows.add(activeSource.rowId);
  if (st.songSession?.rowId) rows.add(st.songSession.rowId);
  if (st.scriptureSession?.rowId) rows.add(st.scriptureSession.rowId);
  // A media-slot deck that has passed its last slide (no loop) holds it, but it has ended.
  const mediaDeckEnded = st.slidesSession?.slot === "media" && st.slidesSession.atEnd;
  // So has a template deck its own timer ran to the end (a Space-armed end is still on air).
  const templateDeckEnded = st.slidesSession?.autoEnded === true;
  if (st.slidesSession?.rowId && !mediaDeckEnded && !templateDeckEnded) rows.add(st.slidesSession.rowId);
  const heldByEndedDeck = mediaDeckEnded && !!st.media?.owner && st.media.rowId === st.slidesSession?.rowId;
  if (st.media && st.media.playback.status !== "ended" && !heldByEndedDeck) rows.add(st.media.rowId);
  return rows;
}

/**
 * Reports a row that has stopped being on air on a channel because it was
 * cleared, ended (song/scripture/slides End, a video stopping or finishing)
 * or replaced. A graphic animating out on its own (auto-out) is not an end:
 * the item is still current, e.g. a sermon name strap fading while the
 * sermon countdown keeps running.
 */
export function createItemEndTracker(
  getState: (channel: string) => ChannelState,
  getActiveSource: (channel: string) => RowSource | null,
  onEnded: (channel: string, rowId: string) => void,
) {
  const seen = new Map<string, Set<string>>();
  return {
    onChange(channel: string): void {
      const st = getState(channel);
      const now = rowsOnAir(st, getActiveSource(channel));
      const before = seen.get(channel);
      seen.set(channel, now);
      if (!before) return;
      const autoOut = st.active?.phase === "out" && st.active.outReason === "auto";
      for (const rowId of before) {
        if (now.has(rowId)) continue;
        // A media-slot deck runs beneath graphics: a graphic's auto-out over it is still not an end.
        const graphicsSlides = st.slidesSession && st.slidesSession.slot !== "media";
        if (autoOut && !st.songSession && !st.scriptureSession && !graphicsSlides) continue;
        onEnded(channel, rowId);
      }
    },
  };
}
