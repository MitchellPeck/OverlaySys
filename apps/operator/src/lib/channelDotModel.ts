import type { ChannelConfig, ChannelState } from "@overlaysys/core";
import type { OutputsState } from "@overlaysys/ws-protocol";

/**
 * Output presence for one dot:
 *   - "unknown": no outputs_state yet (disconnected, or an older server)
 *   - "connected": at least one renderer window is subscribed
 *   - "idle": nothing connected, nothing on air (hollow dot)
 *   - "missing": nothing connected but the channel HAS content (red) — the
 *     operator is taking to an output nobody can see.
 */
export type OutputPresenceTone = "unknown" | "connected" | "idle" | "missing";

/**
 * Bottom-bar dot for one channel. Mirrors show their source's state (that's
 * what their renderer displays) but never offer Clear — clearing a mirror is
 * a no-op server-side. A media-only channel is busy but not clearable:
 * the server's `clear` only fades out `active`, it doesn't stop video.
 */
export function channelDotModel(
  config: ChannelConfig,
  channelStates: Record<string, ChannelState>,
  outputs: OutputsState | null = null,
): {
  tone: "live" | "good" | "dim";
  busy: boolean;
  canClear: boolean;
  sourceId: string;
  outputCount: number | null;
  presence: OutputPresenceTone;
} {
  const sourceId = config.mirrorOf ?? config.id;
  const st = channelStates[sourceId];
  const busy = !!st?.active || !!st?.media;
  const tone = !busy ? "dim" : config.id === "program" ? "live" : "good";
  // A mirror window subscribes under its own id, so presence is per dot.
  const outputCount = outputs ? (outputs[config.id]?.count ?? 0) : null;
  const presence: OutputPresenceTone =
    outputCount === null ? "unknown" : outputCount > 0 ? "connected" : busy ? "missing" : "idle";
  return { tone, busy, canClear: !!st?.active && !config.mirrorOf, sourceId, outputCount, presence };
}

export interface PageLocation {
  protocol: string;
  hostname: string;
  host: string;
  pathname: string;
}

/**
 * Where a channel's renderer page lives, for "Open renderer" in a browser.
 * The packaged server serves the operator at /operator/ and the renderer at
 * /renderer/ on the same origin; in dev the renderer is Vite on :3001 of
 * whatever host the operator was opened from (not always localhost — an
 * operator opened from another machine must not point at its own machine).
 */
export function rendererBaseFor(loc: PageLocation): string {
  if (loc.pathname === "/operator" || loc.pathname.startsWith("/operator/")) {
    return `${loc.protocol}//${loc.host}/renderer`;
  }
  return `${loc.protocol}//${loc.hostname}:3001`;
}

export function rendererHref(base: string, channelId: string): string {
  return `${base.replace(/\/+$/, "")}/?channel=${encodeURIComponent(channelId)}`;
}
