"use client";

import { useEffect, useRef, useState } from "react";
import { Button, colors, fontSize, fontWeight, radius, shadow } from "@overlaysys/ui";
import { useWs } from "@/lib/useWs";
import { useConnection } from "@/lib/useConnection";
import { defaultServerUrl } from "@/lib/wsClient";
import { formatRelative } from "@/lib/listFormat";
import { isCloudMode } from "@/lib/mode";
import { DISCONNECTED_GRACE_MS } from "./shellStatus";
import { connectionView } from "./connectionView";

/**
 * Full-width "Can't reach the OverlaySys server" banner under the top bar
 * (local mode only). A dropped take otherwise only reaches the console log,
 * and the small status dot is easy to miss mid-service. Shown after a short
 * grace period so a normal reconnect blip doesn't flash.
 */
export function ConnectionBanner() {
  if (isCloudMode()) return null;
  return <LocalConnectionBanner />;
}

function LocalConnectionBanner() {
  useWs(); // bootstrap the socket even on pages that don't use it
  const { conn, retry } = useConnection();
  const notOpenSince = useRef(Date.now());
  const lastOpenAt = useRef<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [detailsOpen, setDetailsOpen] = useState(false);

  // Track when we LEFT "open"; connecting <-> closed churn keeps the original time.
  const prevConn = useRef(conn);
  if (prevConn.current === "open" && conn !== "open") {
    notOpenSince.current = Date.now();
    lastOpenAt.current = notOpenSince.current;
  }
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

  const view = connectionView(conn, notOpenSince.current, now);
  if (!view.show) return null;

  const last = lastOpenAt.current
    ? `Last connected ${formatRelative(new Date(lastOpenAt.current).toISOString(), new Date(now))}`
    : "Not connected since this page loaded";

  return (
    <div
      role="alert"
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "6px 12px",
        background: colors.danger,
        color: "#fff",
        fontSize: fontSize.md,
        fontWeight: fontWeight.semibold,
      }}
    >
      <span aria-hidden style={{ width: 8, height: 8, borderRadius: 999, background: "#fff", flexShrink: 0 }} />
      <span>{view.title}</span>
      <span style={{ fontWeight: fontWeight.regular, opacity: 0.9 }}>{view.detail}</span>
      <span style={{ flex: 1 }} />
      <Button
        size="sm"
        variant="secondary"
        onClick={() => {
          retry();
          setNow(Date.now());
        }}
      >
        Retry now
      </Button>
      <Button size="sm" variant="secondary" aria-expanded={detailsOpen} onClick={() => setDetailsOpen((v) => !v)}>
        Details
      </Button>
      {detailsOpen && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            right: 12,
            zIndex: 50,
            marginTop: 4,
            padding: "8px 10px",
            background: colors.surface,
            color: colors.text,
            border: `1px solid ${colors.border}`,
            borderRadius: radius.md,
            boxShadow: shadow.modal,
            fontWeight: fontWeight.regular,
            fontSize: fontSize.sm,
          }}
        >
          <div>Server: {defaultServerUrl()}</div>
          <div>{last}</div>
        </div>
      )}
    </div>
  );
}
