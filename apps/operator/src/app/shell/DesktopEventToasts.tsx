"use client";

import { useEffect } from "react";
import { dismissToast, toast, type ToastTone } from "@overlaysys/ui";
import { getDesktopApi } from "@/lib/desktop";
import { describeDesktopEvent, type Tone } from "./shellStatus";

const TONE: Record<Tone, ToastTone> = { good: "ok", warn: "warn", bad: "error", dim: "info" };

/**
 * Toasts for what the desktop host did on the operator's behalf: restarted a
 * crashed server, reloaded a crashed output, closed an output whose display
 * was unplugged. Without these the operator only sees outputs blink.
 * Renders nothing; the shared ToastHost shows them.
 */
export function DesktopEventToasts(): null {
  useEffect(() => {
    const api = getDesktopApi();
    if (!api?.onDesktopEvent) return;
    // Ids of "server is down" notices; a restart supersedes them.
    let serverDown: string[] = [];
    return api.onDesktopEvent((ev) => {
      const t = describeDesktopEvent(ev);
      const isDown = ev.kind === "server-restarting" || ev.kind === "server-failed";
      if (ev.kind === "server-restarted") {
        serverDown.forEach(dismissToast);
        serverDown = [];
      }
      // Sticky notices (and "server is down") stay until dismissed or superseded.
      const id = toast({ message: t.text, tone: TONE[t.tone], ...(t.sticky || isDown ? { durationMs: null } : {}) });
      if (isDown) serverDown.push(id);
    });
  }, []);
  return null;
}
