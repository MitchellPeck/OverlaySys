"use client";

import { isCloudMode } from "./mode";
import { reconnectNow, useWsStatus } from "./useWs";
import type { WsStatus } from "./wsClient";

export function useConnection(): { connected: boolean; conn: WsStatus; retry(): void } {
  const conn = useWsStatus();
  return { connected: isCloudMode() || conn === "open", conn, retry: reconnectNow };
}
