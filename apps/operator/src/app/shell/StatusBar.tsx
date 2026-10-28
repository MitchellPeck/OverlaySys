"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, colors } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { getClient, useWs } from "@/lib/useWs";
import { isCloudMode } from "@/lib/mode";
import { SyncStatusPill } from "@/app/components/SyncStatusPill";
import { copyText } from "./clipboard";
import { DetailLine, StatusPopoverButton } from "./StatusPopoverButton";
import type { Tone } from "./shellStatus";

export function StatusBar() {
  if (isCloudMode()) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <OnlineDot />
      </div>
    );
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <SyncStatusPill />
      <SttDot />
      <ServerDot />
    </div>
  );
}

/** Cloud build: there's no local server, but the browser can still drop offline. */
function OnlineDot() {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return (
    <StatusPopoverButton
      tone={online ? "good" : "bad"}
      label={online ? "Online" : "Offline"}
      ariaLabel={online ? "Online — details" : "Offline — details"}
      width={240}
    >
      {() => (
        <div style={{ color: colors.textDim }}>
          {online
            ? "Connected to the internet. Changes save to the cloud."
            : "This browser is offline. Changes can't be saved until the connection is back."}
        </div>
      )}
    </StatusPopoverButton>
  );
}

function ServerDot() {
  useWs(); // make sure the socket is bootstrapped on every page
  const conn = useStore((s) => s.conn);
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setUrl(getClient().getUrl());
  }, [conn]);
  let port = "";
  try {
    const u = new URL(url);
    port = u.port || (u.protocol === "wss:" ? "443" : "80");
  } catch {
    // no URL yet
  }
  const tone: Tone = conn === "open" ? "good" : conn === "closed" ? "bad" : "warn";
  const state = conn === "open" ? "Connected" : conn === "closed" ? "Disconnected" : "Connecting…";
  const details = `Server: ${state}\nURL: ${url || "unknown"}`;
  return (
    <StatusPopoverButton
      tone={tone}
      label={conn === "open" ? `Server${port ? ` :${port}` : ""}` : state}
      ariaLabel={`Server ${state} — details`}
    >
      {(close) => (
        <>
          <DetailLine label="Status">{state}</DetailLine>
          <DetailLine label="Address">{url || "unknown"}</DetailLine>
          {conn !== "open" && (
            <div style={{ color: colors.textDim }}>
              Takes and edits are not reaching the server. Reconnecting automatically.
            </div>
          )}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Button
              size="sm"
              onClick={async () => {
                setCopied(await copyText(details));
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? "Copied" : "Copy details"}
            </Button>
            <Link href="/settings/connection" onClick={close} style={{ color: colors.textDim, alignSelf: "center" }}>
              Connection settings
            </Link>
          </div>
        </>
      )}
    </StatusPopoverButton>
  );
}

const STT_TONES: Record<string, Tone> ={ idle: "dim", starting: "warn", running: "good", stopped: "dim", error: "bad" };

function SttDot() {
  const { send } = useWs();
  const status = useStore((s) => s.sttSpawnerStatus);
  const config = useStore((s) => s.sttSpawnerConfig);
  const [copied, setCopied] = useState(false);
  if (!status) return null;
  const tone = STT_TONES[status.state] ?? "dim";
  const running = status.state === "running" || status.state === "starting";
  const lastError = status.lastError ?? null;
  return (
    <StatusPopoverButton
      tone={tone}
      label={tone === "bad" ? "STT error" : "STT"}
      ariaLabel={`Speech-to-text ${status.state} — details`}
      width={260}
    >
      {(close) => (
        <>
          <div style={{ color: colors.textDim }}>Speech-to-text: {status.state}</div>
          {lastError && (
            <div style={{ color: colors.danger, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{lastError}</div>
          )}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {running ? (
              <Button size="sm" onClick={() => { send({ type: "stt_spawner_stop" }); close(); }}>
                Stop
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={!config}
                title={config ? undefined : "Configure STT in Settings first"}
                onClick={() => { if (config) send({ type: "stt_spawner_start", config }); close(); }}
              >
                {tone === "bad" ? "Retry" : "Start"}
              </Button>
            )}
            {lastError && (
              <Button
                size="sm"
                onClick={async () => {
                  setCopied(await copyText(lastError));
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? "Copied" : "Copy error"}
              </Button>
            )}
          </div>
          <Link href="/settings/stt" onClick={close} style={{ color: colors.textDim }}>
            Speech-to-text settings
          </Link>
        </>
      )}
    </StatusPopoverButton>
  );
}
