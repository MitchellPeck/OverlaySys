import type { ChannelState, SongSessionSummary } from "@overlaysys/core";

type Listener = (state: ChannelState) => void;

const states = new Map<string, ChannelState>();
const listeners = new Map<string, Set<Listener>>();

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

export function take(channel: string, templateId: string, data: Record<string, string>): void {
  const s = getOrInit(channel);
  s.active = { templateId, data, phase: "in", takenAt: Date.now() };
  states.set(channel, s);
  emit(channel);
}

export function clear(channel: string): void {
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
): void {
  const s = getOrInit(channel);
  if (summary === null) {
    delete s.songSession;
  } else {
    s.songSession = summary;
  }
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

  // Put it on PGM — fresh takenAt so renderers re-mount.
  const pgm = getOrInit(toChannel);
  pgm.active = {
    templateId: queued.templateId,
    data: queued.data,
    phase: "in",
    takenAt: Date.now(),
  };
  states.set(toChannel, pgm);
  emit(toChannel);

  // Clear PVW (use clear() so the post-clear null sweep still happens).
  clear(fromChannel);
}
