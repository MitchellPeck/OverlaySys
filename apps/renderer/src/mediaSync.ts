import { mediaObjectPosition, type ChannelMedia, type MediaPlayback } from "@overlaysys/core";

/**
 * Pure helpers for the renderer's media slot. Kept out of MediaLayer.tsx so
 * the reconnect / device-fallback logic is unit-tested (same split as
 * mirrorSubscription.ts).
 */

/**
 * Stored asset URLs are relative (`/assets/<sha>.mp4`, or a live-folder file
 * at `/media-folders/<id>/<name>`). The renderer page may be served from a
 * different origin than the asset server (Vite :3001 in dev), so resolve
 * against the WS server's HTTP origin.
 */
export function resolveMediaUrl(stored: string, wsUrl: string): string {
  if (!stored.startsWith("/assets/") && !stored.startsWith("/media-folders/")) return stored;
  try {
    const u = new URL(wsUrl);
    const proto = u.protocol === "wss:" ? "https:" : "http:";
    return `${proto}//${u.host}${stored}`;
  } catch {
    return stored;
  }
}

export type SinkRequest = { id?: string; label?: string };
export type AudioDeviceLike = { deviceId: string; label: string; kind: string };

/**
 * Device ids are per-origin hashes and can differ between the operator page
 * (where the id was picked) and the renderer page, so fall back to label.
 * Missing device → system default plus a warning; never silence.
 */
export function pickAudioSink(
  devices: AudioDeviceLike[],
  want: SinkRequest,
): { deviceId: string | null; warning?: string } {
  if (!want.id && !want.label) return { deviceId: null };
  const outputs = devices.filter((d) => d.kind === "audiooutput");
  const byId = want.id ? outputs.find((d) => d.deviceId === want.id) : undefined;
  if (byId) return { deviceId: byId.deviceId };
  const byLabel = want.label ? outputs.find((d) => d.label === want.label) : undefined;
  if (byLabel) return { deviceId: byLabel.deviceId };
  return {
    deviceId: null,
    warning: `audio device '${want.label ?? want.id}' not found — using default`,
  };
}

export function readSinkRequest(search: string): SinkRequest {
  const p = new URLSearchParams(search);
  const id = p.get("audioSinkId");
  const label = p.get("audioSinkLabel");
  return { ...(id ? { id } : {}), ...(label ? { label } : {}) };
}

export type AppliedSeek = { takenAt: number; seq: number };

/**
 * On (re)mount, start from the last reported position and treat any seek
 * already in state as applied — re-applying it would jump a reconnecting
 * renderer back to an old scrub point.
 */
export function initialMountPlan(media: ChannelMedia): { startAt: number; applied: AppliedSeek } {
  return {
    startAt: media.playback.currentTime > 0 ? media.playback.currentTime : 0,
    applied: { takenAt: media.takenAt, seq: media.seek?.seq ?? 0 },
  };
}

export function pendingSeek(media: ChannelMedia, applied: AppliedSeek): number | null {
  if (!media.seek) return null;
  if (applied.takenAt === media.takenAt && applied.seq >= media.seek.seq) return null;
  return media.seek.time;
}

export type MirrorCorrection = { action: "none" } | { action: "rate"; rate: number } | { action: "seek"; time: number };

/** Beyond this, nudging the rate would take too long: jump. */
export const MIRROR_SEEK_THRESHOLD_S = 0.2;
/** Within a frame of the primary is in sync. */
export const MIRROR_FRAME_S = 1 / 30;
const MAX_RATE_NUDGE = 0.05;
/** Don't extrapolate a stale report further than this. */
const MAX_EXTRAPOLATE_MS = 2000;

/**
 * Fill/key mirrors (e.g. alpha-program in matte mode) play the same video as
 * the primary window but on their own clock, so the key slowly slides off
 * the fill. Each tick the mirror compares its position to where the
 * primary's last report says it should be now: more than a frame off →
 * nudge playbackRate (up to ±5%), more than 200 ms off → seek.
 */
export function mirrorCorrection(localTime: number, primary: MediaPlayback, serverNowMs: number): MirrorCorrection {
  if (primary.status !== "playing") return { action: "none" };
  const elapsedMs = Math.min(Math.max(0, serverNowMs - primary.updatedAt), MAX_EXTRAPOLATE_MS);
  const expected = primary.currentTime + elapsedMs / 1000;
  const drift = localTime - expected;
  if (Math.abs(drift) > MIRROR_SEEK_THRESHOLD_S) return { action: "seek", time: expected };
  if (Math.abs(drift) > MIRROR_FRAME_S) {
    // Ahead (drift > 0) → slow down; behind → speed up. Close the gap over ~2 s.
    const nudge = Math.max(-MAX_RATE_NUDGE, Math.min(MAX_RATE_NUDGE, drift / 2));
    return { action: "rate", rate: 1 - nudge };
  }
  return { action: "none" };
}

export type MediaElementProps = {
  element: "img" | "video";
  objectFit: ChannelMedia["fit"];
  objectPosition: string;
  /** Photos are see-through outside the picture; videos keep a black background. */
  background: "transparent" | "#000";
  loop: boolean;
  muted: boolean;
};

/**
 * What the media slot mounts for a take: a photo as `<img>`, anything else
 * as `<video>`. Full-screen video plays audio unless the take is muted;
 * mirror windows are always silent. A photo paints nothing outside the
 * picture, so a transparent output shows what's beneath it.
 */
export function mediaElementProps(media: ChannelMedia, isMirror: boolean): MediaElementProps {
  return {
    element: media.mediaType === "image" ? "img" : "video",
    objectFit: media.fit,
    objectPosition: mediaObjectPosition(media.position),
    background: media.mediaType === "image" ? "transparent" : "#000",
    loop: media.mediaType !== "image" && media.loop,
    muted: isMirror || media.muted,
  };
}
