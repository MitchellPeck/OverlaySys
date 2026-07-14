import type { ChannelState, SongSessionSummary, SubTakeContext } from "@overlaysys/core";
import * as songSession from "./songSession";
import * as templates from "./templates";

type Listener = (state: ChannelState) => void;

const states = new Map<string, ChannelState>();
const listeners = new Map<string, Set<Listener>>();
// Auto-out timers keyed by channel. Set when a take/promote lands a
// template that has autoOutMs configured; fires clear() so the renderer
// plays its out animation. Always cancelled on any subsequent take, clear,
// or promote so the timer for an outdated active never fires.
const autoOutTimers = new Map<string, ReturnType<typeof setTimeout>>();

let takeIsInternal = false;
let clearIsInternal = false;

function cancelAutoOut(channel: string): void {
  const t = autoOutTimers.get(channel);
  if (t) {
    clearTimeout(t);
    autoOutTimers.delete(channel);
  }
}

/**
 * Async lookup of the just-taken template's `autoOutMs`. The template lives
 * on disk, so this is fire-and-forget — by the time it resolves, a newer
 * take may already have happened. We guard with a takenAt re-check so the
 * timer is only scheduled when the active mount is still the one we asked
 * for. Internal takes (song slides) skip this entirely.
 */
async function maybeScheduleAutoOut(
  channel: string,
  templateId: string,
  takenAt: number,
): Promise<void> {
  const tpl = await templates.getTemplate(templateId);
  const ms = tpl?.autoOutMs;
  if (!ms || ms <= 0) return;
  const s = states.get(channel);
  if (!s?.active || s.active.templateId !== templateId || s.active.takenAt !== takenAt) {
    return;
  }
  // Cancel any previously-scheduled timer for this channel before installing
  // ours. Could exist if two takes raced and both reached this point.
  cancelAutoOut(channel);
  const timer = setTimeout(() => {
    autoOutTimers.delete(channel);
    const cur = states.get(channel);
    if (
      cur?.active &&
      cur.active.templateId === templateId &&
      cur.active.takenAt === takenAt
    ) {
      clear(channel);
    }
  }, ms);
  autoOutTimers.set(channel, timer);
}

function getOrInit(channel: string): ChannelState {
  let s = states.get(channel);
  if (!s) {
    s = { channel, active: null };
    states.set(channel, s);
  }
  return s;
}

export function getState(channel: string): ChannelState {
  return getOrInit(channel);
}

function emit(channel: string): void {
  const s = states.get(channel);
  if (!s) return;
  const ls = listeners.get(channel);
  if (!ls) return;
  for (const l of ls) l(s);
}

export function subscribe(channel: string, listener: Listener): () => void {
  let set = listeners.get(channel);
  if (!set) {
    set = new Set();
    listeners.set(channel, set);
  }
  set.add(listener);
  // Immediately push current state to the new subscriber.
  listener(getOrInit(channel));
  return () => {
    set!.delete(listener);
  };
}

export function take(
  channel: string,
  templateId: string,
  data: Record<string, string>,
  subTakeContext?: SubTakeContext,
): void {
  // Cancel any prior auto-out before we install the new active mount —
  // even if the new take is for the same template, the timer should
  // restart from this take's takenAt.
  cancelAutoOut(channel);
  const s = getOrInit(channel);
  if (!takeIsInternal) {
    // External take while a song session is live → tear down the session and
    // clear songSession from channel state inline. We deliberately DON'T emit
    // between the session teardown and the active mutation below: the
    // renderer fires a session-end stage fade (opacity 1→0 over 600ms) when
    // `songSession` goes from set→null, and emitting that delta first would
    // let the fade hide the new template's IN animation (which manifests as
    // a "snap"). Coalescing both into the post-active emit lets the renderer
    // see one transition and animate normally.
    if (songSession.tearDownSession(channel)) {
      delete s.songSession;
    }
  }
  s.active = {
    templateId,
    data,
    phase: "in",
    takenAt: Date.now(),
    ...(subTakeContext ? { subTakeContext } : {}),
  };
  states.set(channel, s);
  emit(channel);
  // Internal takes (song slide advances) bypass auto-out — songs control
  // their own progression and shouldn't self-clear mid-set on a slide
  // pause.
  if (!takeIsInternal) {
    void maybeScheduleAutoOut(channel, templateId, s.active.takenAt);
  }
}

export function takeInternal(channel: string, templateId: string, data: Record<string, string>): void {
  takeIsInternal = true;
  try {
    take(channel, templateId, data);
  } finally {
    takeIsInternal = false;
  }
}

export function clear(channel: string): void {
  if (!clearIsInternal) {
    // External clear ends any live song session on this channel; without this
    // the session summary persists in ChannelState and the operator UI stays
    // in song mode after the screen is cleared.
    const session = songSession.getSession(channel);
    if (session) songSession.end(channel);
  }
  cancelAutoOut(channel);
  const s = getOrInit(channel);
  if (!s.active) return;
  s.active = { ...s.active, phase: "out" };
  states.set(channel, s);
  emit(channel);
  // After a short grace, drop to null so reconnecting renderers don't replay.
  setTimeout(() => {
    const cur = states.get(channel);
    if (cur && cur.active && cur.active.phase === "out") {
      cur.active = null;
      emit(channel);
    }
  }, 1500);
}

/**
 * Clear without ending an active song session. Used by song mode's blank
 * action — we want the renderer's out animation to play but the session
 * stays live so the operator can unblank back into the same slide.
 */
export function clearInternal(channel: string): void {
  clearIsInternal = true;
  try {
    clear(channel);
  } finally {
    clearIsInternal = false;
  }
}

export function update(channel: string, data: Record<string, string>): void {
  const s = getOrInit(channel);
  if (!s.active) return;
  s.active = { ...s.active, data: { ...s.active.data, ...data } };
  states.set(channel, s);
  emit(channel);
}

export function setSongSessionSummary(
  channel: string,
  summary: SongSessionSummary | null,
  options?: { deferEmit?: boolean },
): void {
  const s = getOrInit(channel);
  if (summary === null) {
    delete s.songSession;
  } else {
    s.songSession = summary;
  }
  states.set(channel, s);
  // `deferEmit` lets a caller coalesce the songSession delta with a follow-up
  // state mutation (e.g. songSession.end → channels.clear, where we want one
  // event carrying both "hasSession=false" and "active.phase=out" so the
  // renderer can tell a true end from a take-replaces-session).
  if (!options?.deferEmit) emit(channel);
}

export function setActiveNull(channel: string): void {
  const s = getOrInit(channel);
  s.active = null;
  states.set(channel, s);
  emit(channel);
}

/**
 * Atomically take whatever is queued on `fromChannel` (typically "preview")
 * and put it live on `toChannel` (typically "program"), then clear the source.
 * This is the standard PVW→PGM behavior of a broadcast switcher.
 */
export function takePvwToPgm(fromChannel: string, toChannel: string): void {
  const src = states.get(fromChannel);
  if (!src || !src.active) return;
  const queued = src.active;

  // End any song session live on the destination channel — otherwise the
  // session keeps rendering lyric slides over whatever we just promoted.
  const destSession = songSession.getSession(toChannel);
  if (destSession) songSession.end(toChannel);

  // Cancel any prior auto-out on the destination so the new active mount's
  // timer starts fresh from this promotion.
  cancelAutoOut(toChannel);
  // Put it on PGM — fresh takenAt so renderers re-mount. Carry the queued
  // subTakeContext forward so identity-aware feedback (Companion) sees the
  // promoted intro/outro as belonging to its originating song row.
  const pgm = getOrInit(toChannel);
  pgm.active = {
    templateId: queued.templateId,
    data: queued.data,
    phase: "in",
    takenAt: Date.now(),
    ...(queued.subTakeContext ? { subTakeContext: queued.subTakeContext } : {}),
  };
  states.set(toChannel, pgm);
  emit(toChannel);

  // Clear PVW (use clear() so the post-clear null sweep still happens).
  // clear() also cancels the source's auto-out timer for us.
  clear(fromChannel);

  // Schedule auto-out on the destination if the promoted template defines
  // it. Same async-with-takenAt-recheck pattern as take().
  void maybeScheduleAutoOut(toChannel, queued.templateId, pgm.active.takenAt);
}
