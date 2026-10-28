import type { WsStatus } from "@/lib/wsClient";
import { shouldShowDisconnected } from "./shellStatus";

/** View model for the disconnected banner. */
export function connectionView(
  conn: WsStatus,
  notOpenSinceMs: number,
  nowMs: number,
): { show: boolean; title: string; detail: string } {
  return {
    show: shouldShowDisconnected(conn, notOpenSinceMs, nowMs),
    title: "Can't reach the OverlaySys server. Takes are not being sent.",
    detail: conn === "connecting" ? "Reconnecting…" : "Retrying automatically.",
  };
}
