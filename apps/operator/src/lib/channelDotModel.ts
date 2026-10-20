import type { ChannelConfig, ChannelState } from "@overlaysys/core";

/**
 * Bottom-bar dot for one channel. Mirrors show their source's state (that's
 * what their renderer displays) but never offer Clear — clearing a mirror is
 * a no-op server-side. A media-only channel is busy but not clearable:
 * the server's `clear` only fades out `active`, it doesn't stop video.
 */
export function channelDotModel(
  config: ChannelConfig,
  channelStates: Record<string, ChannelState>,
): { tone: "live" | "good" | "dim"; busy: boolean; canClear: boolean; sourceId: string } {
  const sourceId = config.mirrorOf ?? config.id;
  const st = channelStates[sourceId];
  const busy = !!st?.active || !!st?.media;
  const tone = !busy ? "dim" : config.id === "program" ? "live" : "good";
  return { tone, busy, canClear: !!st?.active && !config.mirrorOf, sourceId };
}
