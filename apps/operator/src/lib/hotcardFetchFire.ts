import type { Hotcard } from "@overlaysys/core";
import type { ClientMessage } from "@overlaysys/ws-protocol";
import { errorMatches, type AckClient } from "./awaitAck";

/**
 * How long a Take / Cue / F-key on an uncached hotcard waits for the card.
 * On the LAN it arrives in a few ms; a second is the longest a press can
 * still feel like "that press" on air. After that the press is dropped
 * (the card is cached by then, so pressing again fires at once).
 */
export const HOTCARD_FETCH_FIRE_TIMEOUT_MS = 1000;

export type FetchFireClient = AckClient & { onSend(l: (m: ClientMessage) => void): () => void };

/** Messages that put something on, change, or take something off a channel. */
const ON_AIR_TYPES = new Set<ClientMessage["type"]>([
  "take",
  "cue",
  "clear",
  "clear_all_channels",
  "take_pvw_to_pgm",
  "song_take",
  "song_take_pvw_to_pgm",
  "take_song_sub",
  "song_end",
  "scripture_take_intro",
  "scripture_take_slide",
  "scripture_end",
  "media_take",
  "media_clear",
  "slides_take",
  "slides_end",
]);

/** Whether sending `m` is a take / cue / clear that a waiting hotcard fire must not land after. */
export function changesOnAir(m: ClientMessage): boolean {
  return ON_AIR_TYPES.has(m.type);
}

// One waiting press at a time: a newer press supersedes it.
let cancelWaiting: (() => void) | null = null;

/**
 * Ask the server for a hotcard that isn't cached yet and resolve with it, so
 * the caller can fire the press that asked for it. Resolves null instead when
 * the press has gone stale: anything goes to air first (from this console, or
 * any channel changes on the server), another hotcard press comes in, the
 * socket drops, the server can't find the card, or the timeout passes.
 */
export function fetchHotcardForFire(
  client: FetchFireClient,
  hotcardId: string,
  o?: { timeoutMs?: number },
): Promise<Hotcard | null> {
  cancelWaiting?.();
  cancelWaiting = null;
  if (client.getStatus() !== "open") return Promise.resolve(null);
  return new Promise<Hotcard | null>((resolve) => {
    const cleanups: Array<() => void> = [];
    let done = false;
    const finish = (h: Hotcard | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      for (const c of cleanups) c();
      if (cancelWaiting === cancel) cancelWaiting = null;
      resolve(h);
    };
    const cancel = () => finish(null);
    cancelWaiting = cancel;
    const timer = setTimeout(cancel, o?.timeoutMs ?? HOTCARD_FETCH_FIRE_TIMEOUT_MS);
    cleanups.push(
      client.onSend((m) => {
        if (changesOnAir(m)) cancel();
      }),
    );
    cleanups.push(
      client.on((m) => {
        if (m.type === "hotcard" && m.hotcard.id === hotcardId) finish(m.hotcard);
        else if (m.type === "state") cancel();
        else if (errorMatches(m, { op: "get_hotcard", id: hotcardId })) cancel();
      }),
    );
    cleanups.push(
      client.onStatus((s) => {
        if (s !== "open") cancel();
      }),
    );
    client.send({ type: "get_hotcard", hotcardId });
  });
}
