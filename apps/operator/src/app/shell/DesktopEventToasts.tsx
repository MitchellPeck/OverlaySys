"use client";

import { useEffect } from "react";
import { toast, type ToastTone } from "@overlaysys/ui";
import { getDesktopApi } from "@/lib/desktop";
import { describeDesktopEvent, type Tone } from "./shellStatus";

const TONE: Record<Tone, ToastTone> = { good: "ok", warn: "warn", bad: "error", dim: "info" };
/** Toasts have no "stay until dismissed"; sticky notices get a long duration. */
const STICKY_MS = 120_000;

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
    return api.onDesktopEvent((ev) => {
      const t = describeDesktopEvent(ev);
      toast({ message: t.text, tone: TONE[t.tone], ...(t.sticky ? { durationMs: STICKY_MS } : {}) });
    });
  }, []);
  return null;
}
