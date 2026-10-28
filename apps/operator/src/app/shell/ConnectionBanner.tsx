"use client";

import { useEffect, useRef, useState } from "react";
import { colors, fontSize, fontWeight } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";
import { isCloudMode } from "@/lib/mode";
import { DISCONNECTED_GRACE_MS, shouldShowDisconnected } from "./shellStatus";

/**
 * Full-width "Disconnected — takes are not being sent" banner under the top
 * bar (local mode only). A dropped take otherwise only reaches the console
 * log, and the small status dot is easy to miss mid-service. Shown after a
 * short grace period so a normal reconnect blip doesn't flash.
 */
export function ConnectionBanner() {
  if (isCloudMode()) return null;
  return <LocalConnectionBanner />;
}

function LocalConnectionBanner() {
  useWs(); // bootstrap the socket even on pages that don't use it
  const conn = useStore((s) => s.conn);
  const notOpenSince = useRef(Date.now());
  const [now, setNow] = useState(() => Date.now());

  // Track when we LEFT "open"; connecting ↔ closed churn keeps the original time.
  const prevConn = useRef(conn);
  if (prevConn.current === "open" && conn !== "open") notOpenSince.current = Date.now();
  prevConn.current = conn;

  // Re-evaluate once the grace period elapses.
  useEffect(() => {
    if (conn === "open") return;
    const remaining = DISCONNECTED_GRACE_MS - (Date.now() - notOpenSince.current);
    if (remaining <= 0) {
      setNow(Date.now());
      return;
    }
    const t = setTimeout(() => setNow(Date.now()), remaining + 10);
    return () => clearTimeout(t);
  }, [conn]);

  if (!shouldShowDisconnected(conn, notOpenSince.current, now)) return null;

  return (
    <div
      role="alert"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "6px 12px",
        background: colors.onairFill,
        color: "#fff",
        fontSize: fontSize.md,
        fontWeight: fontWeight.semibold,
      }}
    >
      <span aria-hidden style={{ width: 8, height: 8, borderRadius: 999, background: "#fff", flexShrink: 0 }} />
      <span>Disconnected from the OverlaySys server — takes are not being sent.</span>
      <span style={{ fontWeight: fontWeight.regular, opacity: 0.9 }}>
        {conn === "connecting" ? "Reconnecting…" : "Retrying automatically."}
      </span>
    </div>
  );
}
