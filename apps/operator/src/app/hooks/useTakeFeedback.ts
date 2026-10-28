"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage } from "@overlaysys/ws-protocol";
import { useWs } from "@/lib/useWs";
import { awaitChannelEcho } from "@/lib/takeFeedback";

export type TakeStatus = "idle" | "pending" | "failed";

const FAILED_HINT_MS = 4000;

/**
 * Send a take and track whether the server answered: "pending" until the
 * target channel's state is echoed, "failed" (briefly) when nothing comes
 * back within the timeout. Messages without a channel are sent untracked.
 */
export function useTakeFeedback(): { status: TakeStatus; send: (msg: ClientMessage) => void } {
  const { send: wsSend } = useWs();
  const [status, setStatus] = useState<TakeStatus>("idle");
  const cancelRef = useRef<() => void>(() => {});
  const hintTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(
    () => () => {
      cancelRef.current();
      if (hintTimer.current) clearTimeout(hintTimer.current);
    },
    [],
  );

  const send = useCallback(
    (msg: ClientMessage) => {
      const channel = "channel" in msg && typeof msg.channel === "string" ? msg.channel : null;
      cancelRef.current();
      if (hintTimer.current) clearTimeout(hintTimer.current);
      if (!channel) {
        wsSend(msg);
        return;
      }
      const wait = awaitChannelEcho(channel);
      cancelRef.current = wait.cancel;
      setStatus("pending");
      wsSend(msg);
      void wait.done.then((ok) => {
        if (ok) {
          setStatus("idle");
          return;
        }
        setStatus("failed");
        hintTimer.current = setTimeout(() => setStatus("idle"), FAILED_HINT_MS);
      });
    },
    [wsSend],
  );

  return { status, send };
}
