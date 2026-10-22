import type {
  ChannelState,
  MediaEndAction,
  MediaPlayback,
  MediaStatus,
  MediaTransition,
  QueuedScripture,
  QueuedSong,
  RowSource,
  ScriptureContext,
  ScriptureSessionSummary,
  SongSessionSummary,
  SubTakeContext,
} from "@overlaysys/core";
import { DEFAULT_MEDIA_TRANSITION } from "@overlaysys/core";
import * as scriptureSession from "./scriptureSession";
import * as songSession from "./songSession";
import * as templates from "./templates";

type Listener = (state: ChannelState) => void;

const states = new Map<string, ChannelState>();
const listeners = new Map<string, Set<Listener>>();

type AnyListener = (channel: string) => void;
const anyListeners = new Set<AnyListener>();

/** Called after every emit on any channel. Used by the stage feed hub. */
export function onAnyChange(listener: AnyListener): () => void {
  anyListeners.add(listener);
  return () => {
    anyListeners.delete(listener);
  };
}

export function allStates(): ChannelState[] {
  return [...states.values()];
}
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
      // An intro fading out on its own still leaves its song queued for the
      // section buttons that follow.
      clear(channel, { keepQueuedSong: true });
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

export function setLiveRow(channel: string, source: RowSource): void {
  const s = getOrInit(channel);
  s.liveRow = source;
  emit(channel);
}

function emit(channel: string): void {
  const s = states.get(channel);
  if (!s) return;
  const ls = listeners.get(channel);
  if (ls) for (const l of ls) l(s);
  for (const l of anyListeners) l(channel);
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
  scripture?: { context: ScriptureContext; session?: ScriptureSessionSummary; queued?: QueuedScripture },
  source?: RowSource,
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
    // Any external take replaces whatever an intro had queued. (An intro
    // take re-queues its own song right after this.)
    if (songSession.dropQueued(channel)) {
      delete s.queuedSong;
    }
  }
  // Every take replaces whatever scripture owned the channel — including song
  // slides (internal takes) and scripture's own takes, which re-establish
  // their state from `scripture` below. One emit carries both changes.
  scriptureSession.dropAll(channel);
  delete s.scriptureSession;
  delete s.queuedScripture;
  if (scripture?.session) s.scriptureSession = scripture.session;
  if (scripture?.queued) s.queuedScripture = scripture.queued;
  s.active = {
    templateId,
    data,
    phase: "in",
    takenAt: Date.now(),
    ...(subTakeContext ? { subTakeContext } : {}),
    ...(scripture ? { scriptureContext: scripture.context } : {}),
  };
  if (source) s.liveRow = source;
  states.set(channel, s);
  emit(channel);
  // Internal takes (song slide advances) bypass auto-out — songs control
  // their own progression and shouldn't self-clear mid-set on a slide
  // pause. Scripture slide takes (those carrying a session) do the same so
  // an auto-out can't end the session mid-passage; scripture intros keep it.
  if (!takeIsInternal && !scripture?.session) {
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

export function clear(
  channel: string,
  options?: { keepQueuedSong?: boolean },
): void {
  if (!clearIsInternal) {
    // External clear ends any live song session on this channel; without this
    // the session summary persists in ChannelState and the operator UI stays
    // in song mode after the screen is cleared.
    const session = songSession.getSession(channel);
    if (session) songSession.end(channel);
    if (scriptureSession.dropLive(channel)) {
      const st = getOrInit(channel);
      delete st.scriptureSession;
    }
  }
  cancelAutoOut(channel);
  const s = getOrInit(channel);
  if (!clearIsInternal && !options?.keepQueuedSong && scriptureSession.dropQueued(channel)) {
    delete s.queuedScripture;
    states.set(channel, s);
    if (!s.active) emit(channel);
  }
  if (!clearIsInternal && !options?.keepQueuedSong && songSession.dropQueued(channel)) {
    delete s.queuedSong;
    states.set(channel, s);
    if (!s.active) emit(channel);
  }
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

export function setQueuedSong(
  channel: string,
  queued: QueuedSong | null,
  options?: { deferEmit?: boolean },
): void {
  const s = getOrInit(channel);
  if (queued === null) delete s.queuedSong;
  else s.queuedSong = queued;
  states.set(channel, s);
  if (!options?.deferEmit) emit(channel);
}

export function setQueuedScripture(channel: string, queued: QueuedScripture | null): void {
  const s = getOrInit(channel);
  if (queued === null) delete s.queuedScripture;
  else s.queuedScripture = queued;
  states.set(channel, s);
  emit(channel);
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
  // The destination's queued song (e.g. an earlier intro that auto-outed)
  // no longer applies. If what we're promoting IS an intro, its song moves
  // with it so the section buttons that follow target program.
  let carried: QueuedSong | null = null;
  if (queued.subTakeContext?.sub === "intro") {
    carried = songSession.moveQueued(fromChannel, toChannel);
  } else {
    songSession.dropQueued(toChannel);
  }
  if (carried) {
    pgm.queuedSong = carried;
    delete src.queuedSong;
  } else {
    delete pgm.queuedSong;
  }
  // Scripture mirrors songs: live scripture on the destination ends; a
  // promoted scripture intro carries its queue.
  if (scriptureSession.dropLive(toChannel)) delete pgm.scriptureSession;
  let carriedScripture: QueuedScripture | null = null;
  if (queued.scriptureContext?.sub === "intro") {
    carriedScripture = scriptureSession.moveQueued(fromChannel, toChannel);
  } else {
    scriptureSession.dropQueued(toChannel);
  }
  if (carriedScripture) {
    pgm.queuedScripture = carriedScripture;
    delete src.queuedScripture;
  } else {
    delete pgm.queuedScripture;
  }
  pgm.active = {
    templateId: queued.templateId,
    data: queued.data,
    phase: "in",
    takenAt: Date.now(),
    ...(queued.subTakeContext ? { subTakeContext: queued.subTakeContext } : {}),
    ...(queued.scriptureContext ? { scriptureContext: queued.scriptureContext } : {}),
  };
  if (src.liveRow) pgm.liveRow = src.liveRow;
  states.set(toChannel, pgm);
  emit(toChannel);

  // Clear PVW (use clear() so the post-clear null sweep still happens).
  // clear() also cancels the source's auto-out timer for us.
  clear(fromChannel);

  // Schedule auto-out on the destination if the promoted template defines
  // it. Same async-with-takenAt-recheck pattern as take().
  void maybeScheduleAutoOut(toChannel, queued.templateId, pgm.active.takenAt);
}

// ───── Media slot ──────────────────────────────────────────────────────────
//
// Full-frame video beneath graphics. Independent of `active`: nothing above
// touches `media`, nothing below touches `active`. Status transitions emit
// full `state`; ~4 Hz time ticks go to playback listeners only, so template
// renderers and Companion aren't re-rendered on every tick.

export type MediaPlaybackEvent = {
  channel: string;
  takenAt: number;
  playback: MediaPlayback;
};
type PlaybackListener = (e: MediaPlaybackEvent) => void;
const playbackListeners = new Map<string, Set<PlaybackListener>>();

export function subscribeMediaPlayback(
  channel: string,
  listener: PlaybackListener,
): () => void {
  let set = playbackListeners.get(channel);
  if (!set) {
    set = new Set();
    playbackListeners.set(channel, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
  };
}

function notifyPlayback(e: MediaPlaybackEvent): void {
  const ls = playbackListeners.get(e.channel);
  if (!ls) return;
  for (const l of ls) l(e);
}

export type MediaTakeArgs = {
  rowId: string;
  showId?: string;
  assetUrl: string;
  label?: string;
  volume: number;
  endAction: MediaEndAction;
  transitionIn?: MediaTransition;
  transitionOut?: MediaTransition;
};

export function mediaTake(channel: string, args: MediaTakeArgs, now = Date.now()): void {
  const s = getOrInit(channel);
  // takenAt is the take's identity — a late `ended` from the previous take
  // must never match, so force it strictly increasing even within one ms.
  const prev = s.media?.takenAt ?? 0;
  const takenAt = now > prev ? now : prev + 1;
  s.media = {
    rowId: args.rowId,
    assetUrl: args.assetUrl,
    ...(args.label !== undefined ? { label: args.label } : {}),
    volume: args.volume,
    endAction: args.endAction,
    transitionIn: args.transitionIn ?? DEFAULT_MEDIA_TRANSITION,
    transitionOut: args.transitionOut ?? DEFAULT_MEDIA_TRANSITION,
    takenAt,
    paused: false,
    playback: { status: "loading", currentTime: 0, duration: 0, updatedAt: now },
  };
  delete s.mediaClearCut;
  if (args.showId) s.liveRow = { showId: args.showId, rowId: args.rowId };
  emit(channel);
}

export function mediaClear(channel: string, opts: { cut?: boolean } = {}): void {
  const s = getOrInit(channel);
  if (!s.media) return;
  s.media = null;
  if (opts.cut) s.mediaClearCut = true;
  else delete s.mediaClearCut;
  emit(channel);
}

export type MediaControlAction = "play" | "pause" | "restart" | "seek";

export function mediaControl(
  channel: string,
  takenAt: number,
  action: MediaControlAction,
  time?: number,
): void {
  const m = states.get(channel)?.media;
  if (!m || m.takenAt !== takenAt) return;
  const nextSeq = (m.seek?.seq ?? 0) + 1;
  switch (action) {
    case "play":
      // Playing a held-at-end video starts it over.
      if (m.playback.status === "ended") m.seek = { time: 0, seq: nextSeq };
      m.paused = false;
      break;
    case "pause":
      m.paused = true;
      break;
    case "restart":
      m.seek = { time: 0, seq: nextSeq };
      m.paused = false;
      break;
    case "seek":
      if (time === undefined) return;
      m.seek = { time: Math.max(0, time), seq: nextSeq };
      // A scrub leaves the held-at-end state, so a following Play resumes
      // from here instead of restarting from 0.
      if (m.playback.status === "ended") m.playback.status = "paused";
      break;
  }
  emit(channel);
}

export type MediaStatusReport = {
  status: MediaStatus;
  currentTime: number;
  duration: number;
  error?: string;
};

export function mediaStatus(
  channel: string,
  takenAt: number,
  report: MediaStatusReport,
  now = Date.now(),
): void {
  const m = states.get(channel)?.media;
  if (!m || m.takenAt !== takenAt) return;
  const prev = m.playback;
  const next: MediaPlayback = {
    status: report.status,
    currentTime: report.currentTime,
    duration: report.duration,
    updatedAt: now,
    ...(report.error ? { error: report.error } : {}),
  };
  m.playback = next;

  if (report.status === "ended") {
    if (m.endAction === "clear") {
      mediaClear(channel);
    } else {
      m.paused = true;
      emit(channel);
    }
    return;
  }

  const transition =
    prev.status !== next.status ||
    prev.error !== next.error ||
    prev.duration !== next.duration;
  if (transition) emit(channel);
  else notifyPlayback({ channel, takenAt, playback: next });
}
