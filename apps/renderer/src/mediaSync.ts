import type { ChannelMedia } from "@overlaysys/core";

/**
 * Pure helpers for the renderer's media slot. Kept out of MediaLayer.tsx so
 * the reconnect / device-fallback logic is unit-tested (same split as
 * mirrorSubscription.ts).
 */

/**
 * Stored asset URLs are relative (`/assets/<sha>.mp4`). The renderer page
 * may be served from a different origin than the asset server (Vite :3001
 * in dev), so resolve against the WS server's HTTP origin.
 */
export function resolveMediaUrl(stored: string, wsUrl: string): string {
  if (!stored.startsWith("/assets/")) return stored;
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
