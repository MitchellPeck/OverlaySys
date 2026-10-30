"use client";

import { useEffect } from "react";
import { dismissToast, toast, type ToastTone } from "@overlaysys/ui";
import { getDesktopApi } from "@/lib/desktop";
import { describeDesktopEvent, desktopToastKeys, type Tone } from "./shellStatus";

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
    // Open toast ids by group ("server is down", one window's "keeps
    // crashing"); a later event that supersedes a group dismisses them.
    const open = new Map<string, string[]>();
    return api.onDesktopEvent((ev) => {
      // Starting/stopped are the operator's own actions; only news gets a toast.
      if (ev.kind === "decklink-status" && (ev.status.state === "starting" || ev.status.state === "stopped")) return;
      const t = describeDesktopEvent(ev);
      const { opens, closes } = desktopToastKeys(ev);
      if (closes) {
        open.get(closes)?.forEach(dismissToast);
        open.delete(closes);
      }
      // Sticky notices (and "server is down") stay until dismissed or superseded.
      const isDown = ev.kind === "server-restarting" || ev.kind === "server-failed";
      const id = toast({ message: t.text, tone: TONE[t.tone], ...(t.sticky || isDown ? { durationMs: null } : {}) });
      if (opens) open.set(opens, [...(open.get(opens) ?? []), id]);
    });
  }, []);
  return null;
}
