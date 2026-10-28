"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { colors, fontSize, radius, shadow } from "@overlaysys/ui";
import { getDesktopApi } from "@/lib/desktop";
import { describeDesktopEvent, type DesktopToast } from "./shellStatus";

type Toast = DesktopToast & { id: number };

const AUTO_DISMISS_MS = 8000;
const TONE_COLOR = { good: colors.ok, warn: colors.warn, bad: colors.danger, dim: colors.textDim } as const;

/**
 * Toasts for what the desktop host did on the operator's behalf: restarted a
 * crashed server, reloaded a crashed output, closed an output whose display
 * was unplugged. Without these the operator only sees outputs blink.
 */
export function DesktopEventToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const api = getDesktopApi();
    if (!api?.onDesktopEvent) return;
    let seq = 0;
    return api.onDesktopEvent((ev) => {
      const toast: Toast = { ...describeDesktopEvent(ev), id: ++seq };
      // A restart supersedes the "restarting…" notice.
      setToasts((prev) => [...prev.filter((t) => !(ev.kind === "server-restarted" && t.text.startsWith("Server"))), toast].slice(-4));
      if (!toast.sticky) {
        setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== toast.id)), AUTO_DISMISS_MS);
      }
    });
  }, []);

  if (toasts.length === 0) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{ position: "fixed", right: 16, bottom: 16, zIndex: 1600, display: "flex", flexDirection: "column", gap: 8, maxWidth: 420 }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          style={{
            display: "flex",
            gap: 10,
            alignItems: "flex-start",
            padding: "10px 12px",
            background: colors.surface,
            border: `1px solid ${colors.borderStrong}`,
            borderLeft: `4px solid ${TONE_COLOR[t.tone]}`,
            borderRadius: radius.md,
            boxShadow: shadow.modal,
            fontSize: fontSize.md,
            color: colors.text,
          }}
        >
          <span style={{ flex: 1 }}>{t.text}</span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
            style={{ background: "transparent", border: "none", color: colors.textDim, padding: 2, lineHeight: 0 }}
          >
            <X size={14} aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}
