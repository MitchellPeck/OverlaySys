"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button, Pill, StatusDot, colors, type PillTone } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { getClient, useWs } from "@/lib/useWs";
import { isCloudMode } from "@/lib/mode";
import { SyncStatusPill } from "@/app/components/SyncStatusPill";
import { AnchoredPopover } from "@/app/components/AnchoredPopover";

export function StatusBar() {
  if (isCloudMode()) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <SyncStatusPill />
      <SttDot />
      <ServerDot />
    </div>
  );
}

function ServerDot() {
  const conn = useStore((s) => s.conn);
  const [port, setPort] = useState("");
  useEffect(() => {
    try {
      const url = new URL(getClient().getUrl());
      setPort(url.port || (url.protocol === "wss:" ? "443" : "80"));
    } catch {
      // ignore parse errors — fall back to no port
    }
  }, [conn]);
  if (conn === "closed") return <Pill tone="bad">Disconnected</Pill>;
  return (
    <StatusDot
      tone={conn === "open" ? "good" : "warn"}
      label={`Server${port ? ` :${port}` : ""}`}
      title={conn === "open" ? "Connected" : "Connecting…"}
    />
  );
}

const STT_TONES: Record<string, PillTone> = { idle: "dim", starting: "warn", running: "good", stopped: "dim", error: "bad" };

function SttDot() {
  const { send } = useWs();
  const status = useStore((s) => s.sttSpawnerStatus);
  const config = useStore((s) => s.sttSpawnerConfig);
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const [open, setOpen] = useState(false);
  if (!status) return null;
  const tone = STT_TONES[status.state] ?? "dim";
  const running = status.state === "running" || status.state === "starting";
  return (
    <span ref={anchorRef}>
      {tone === "bad" ? (
        <span onClick={() => setOpen((v) => !v)} style={{ cursor: "pointer" }} title={status.lastError ?? undefined}>
          <Pill tone="bad">STT error</Pill>
        </span>
      ) : (
        <StatusDot tone={tone} label="STT" title={`STT: ${status.state}`} onClick={() => setOpen((v) => !v)} />
      )}
      {open && (
        <AnchoredPopover anchorEl={anchorRef.current} onClose={() => setOpen(false)} width={220}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
            <div style={{ color: colors.textDim }}>Speech-to-text: {status.state}</div>
            {running ? (
              <Button size="sm" onClick={() => { send({ type: "stt_spawner_stop" }); setOpen(false); }}>
                Stop
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={!config}
                title={config ? undefined : "Configure STT in Settings first"}
                onClick={() => { if (config) send({ type: "stt_spawner_start", config }); setOpen(false); }}
              >
                Start
              </Button>
            )}
            <Link href="/settings/stt" onClick={() => setOpen(false)} style={{ color: colors.textDim }}>
              Speech-to-text settings
            </Link>
          </div>
        </AnchoredPopover>
      )}
    </span>
  );
}
