import type { MediaPlayback } from "@overlaysys/core";
import { formatTime } from "@overlaysys/core";
import type { CompanionState } from "./types";

/**
 * Video and STT values that change many times a second on the wire
 * (media_playback ~4 Hz, stt_match several/s). Projected to whole seconds /
 * percent so Companion only sees a change about once a second.
 */

export interface VideoInfo {
  title: string;
  status: MediaPlayback["status"];
  elapsedSec: number;
  remainingSec: number;
  durationSec: number;
  /** 0–100 */
  progress: number;
}

/** The latest known playback for the channel's current video, or null when none. */
export function videoInfo(state: CompanionState, channel: string): VideoInfo | null {
  const media = state.channelStates.get(channel)?.media;
  if (!media) return null;
  const tick = state.mediaPlayback.get(channel);
  const pb = tick && tick.takenAt === media.takenAt && tick.playback.updatedAt >= media.playback.updatedAt
    ? tick.playback
    : media.playback;
  const duration = Number.isFinite(pb.duration) ? Math.max(0, pb.duration) : 0;
  const elapsed = Math.min(Math.max(0, pb.currentTime), duration || pb.currentTime);
  return {
    title: media.label ?? media.rowId,
    status: pb.status,
    elapsedSec: Math.floor(elapsed),
    remainingSec: duration > 0 ? Math.ceil(duration - elapsed) : 0,
    durationSec: duration,
    progress: duration > 0 ? Math.min(100, Math.round((elapsed / duration) * 100)) : 0,
  };
}

export function videoVariables(state: CompanionState, channels: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const c of channels) {
    const v = videoInfo(state, c);
    out[`${c}_video_title`] = v?.title ?? "";
    out[`${c}_video_status`] = v?.status ?? "";
    out[`${c}_video_elapsed`] = v ? formatTime(v.elapsedSec * 1000, "M:SS") : "";
    out[`${c}_video_remaining`] = v && v.durationSec > 0 ? formatTime(v.remainingSec * 1000, "M:SS") : "";
    out[`${c}_video_remaining_sec`] = v && v.durationSec > 0 ? String(v.remainingSec) : "";
    out[`${c}_video_progress`] = v ? String(v.progress) : "";
  }
  return out;
}

/** True when any subscribed channel has a live song session. */
export function songLive(state: CompanionState): boolean {
  for (const st of state.channelStates.values()) if (st.songSession) return true;
  return false;
}

/**
 * Seconds since STT last produced anything while a song is live; null when
 * no song is live. Counts from the later of the song going live and the
 * last stt_match, so a freshly started song isn't "silent" from the past.
 */
export function sttSilentSec(state: CompanionState, now: number = Date.now()): number | null {
  if (state.songLiveSince === null) return null;
  const since = Math.max(state.songLiveSince, state.stt.lastMatchAt ?? 0);
  return Math.max(0, Math.floor((now - since) / 1000));
}

export function sttVariables(state: CompanionState, now: number = Date.now()): Record<string, string> {
  const silent = sttSilentSec(state, now);
  return {
    stt_confidence: state.stt.confidence === null ? "" : String(Math.round(state.stt.confidence * 100)),
    stt_last_heard: state.stt.lastHypothesis,
    stt_silent_sec: silent === null ? "" : String(silent),
  };
}
