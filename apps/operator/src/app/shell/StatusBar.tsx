"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { getClient, reconnectNow, useWs } from "@/lib/useWs";
import { isCloudMode } from "@/lib/mode";
import { SyncStatusPill } from "@/app/components/SyncStatusPill";
import { copyText } from "./clipboard";
import { StatusPopoverButton } from "./StatusPopoverButton";
import { statusPopoverModel } from "./statusPopover";
import type { Tone } from "./shellStatus";

async function copyWithToast(text: string, what: string): Promise<void> {
  const ok = await copyText(text);
  toast(ok ? { message: `${what} copied`, tone: "ok" } : { message: "Couldn't copy to the clipboard", tone: "warn" });
}

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
      {/* [P2b.20] reserved: P2b.20 adds its own marked block here. */}
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
      model={{
        title: online ? "Online" : "Offline",
        lines: [
          online
            ? "Connected to the internet. Changes save to the cloud."
            : "This browser is offline. Changes can't be saved until the connection is back.",
        ],
        actions: [],
      }}
    />
  );
}

function ServerDot() {
  useWs(); // make sure the socket is bootstrapped on every page
  const conn = useStore((s) => s.conn);
  const router = useRouter();
  const [url, setUrl] = useState("");
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
  const model = statusPopoverModel("server", { conn, url });
  return (
    <StatusPopoverButton
      tone={tone}
      label={conn === "open" ? `Server${port ? ` :${port}` : ""}` : state}
      ariaLabel={`Server ${state} — details`}
      model={model}
      onAction={(id) => {
        if (id === "retry") reconnectNow();
        else if (id === "copy") void copyWithToast(`Server: ${state}\nURL: ${url || "unknown"}`, "Details");
        else if (id === "settings") router.push("/settings/connection");
      }}
    />
  );
}

const STT_TONES: Record<string, Tone> = { idle: "dim", starting: "warn", running: "good", stopped: "dim", error: "bad" };

function SttDot() {
  const { send } = useWs();
  const router = useRouter();
  const status = useStore((s) => s.sttSpawnerStatus);
  const config = useStore((s) => s.sttSpawnerConfig);
  // [P2b.20]
  const onSttSettings = usePathname() === "/settings/stt";
  if (!status || onSttSettings) return null;
  // [/P2b.20]
  const tone = STT_TONES[status.state] ?? "dim";
  const lastError = status.lastError ?? null;
  const model = statusPopoverModel("stt", { state: status.state, lastError, hasConfig: !!config });
  return (
    <StatusPopoverButton
      tone={tone}
      label={tone === "bad" ? "STT error" : "STT"}
      ariaLabel={`Speech-to-text ${status.state} — details`}
      width={260}
      model={model}
      onAction={(id) => {
        if (id === "stop") send({ type: "stt_spawner_stop" });
        else if (id === "start" && config) send({ type: "stt_spawner_start", config });
        else if (id === "copy-error" && lastError) void copyWithToast(lastError, "Error");
        else if (id === "settings") router.push("/settings/stt");
      }}
    />
  );
}
