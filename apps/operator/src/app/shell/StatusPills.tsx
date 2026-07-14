"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Pill, type PillTone } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { getClient } from "@/lib/useWs";
import { isCloudMode } from "@/lib/mode";
import { SyncStatusPill } from "@/app/components/SyncStatusPill";

export function StatusPills() {
  const conn = useStore((s) => s.conn);
  const dot = { connecting: "🟡", open: "🟢", closed: "🔴" }[conn];
  if (isCloudMode()) return null;
  return (
    <>
      <SyncStatusPill />
      <SttStatusPill />
      <ConnectionPill conn={conn} dot={dot} />
    </>
  );
}

/**
 * Connection state + server port. The port matters when external tools
 * (Companion, Stream Deck) need to know where the server is listening —
 * especially in the packaged Electron build where the port can differ
 * from the dev default.
 */
function ConnectionPill({ conn, dot }: { conn: string; dot: string }) {
  const [port, setPort] = useState<string>("");
  useEffect(() => {
    try {
      const url = new URL(getClient().getUrl());
      setPort(url.port || (url.protocol === "wss:" ? "443" : "80"));
    } catch {
      // ignore parse errors — fall back to no port
    }
  }, [conn]);
  return (
    <span style={{ color: "var(--text-dim)", fontSize: 12 }}>
      {dot} {conn}
      {port && <span style={{ marginLeft: 4 }}>:{port}</span>}
    </span>
  );
}

/**
 * Tiny STT spawner status indicator. Always rendered in the global header
 * so the operator can see at a glance whether STT is up — no matter which
 * page they're on. Click navigates to /stt for control + logs.
 */
function SttStatusPill() {
  const status = useStore((s) => s.sttSpawnerStatus);
  const pathname = usePathname() ?? "/";
  if (!status) return null;
  // On /stt itself the page already shows a big status pill in its actions
  // slot; suppress the global one to avoid duplication.
  if (pathname === "/stt" || pathname.startsWith("/stt/")) return null;

  const TONES: Record<string, PillTone> = {
    idle: "dim",
    starting: "warn",
    running: "good",
    stopped: "dim",
    error: "bad",
  };
  const tone = TONES[status.state] ?? "dim";

  return (
    <Link
      href="/stt"
      title={
        status.state === "error" && status.lastError
          ? `STT: ${status.state} — ${status.lastError}`
          : `STT: ${status.state}`
      }
      style={{ textDecoration: "none" }}
    >
      <Pill tone={tone} uppercase>
        🎤 {status.state}
      </Pill>
    </Link>
  );
}
