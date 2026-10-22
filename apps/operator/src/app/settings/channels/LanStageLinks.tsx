"use client";

import { useEffect, useRef, useState } from "react";
import { Button, colors } from "@overlaysys/ui";
import { isCloudMode } from "@/lib/mode";
import { httpBase } from "@/lib/pcoClient";
import { QrCode } from "./QrCode";

interface NetworkInfo {
  port: number;
  addresses: string[];
}

/** "Open on another device" links for a stage channel. */
export function LanStageLinks({ channelId }: { channelId: string }) {
  const cloud = isCloudMode();
  const [info, setInfo] = useState<NetworkInfo | null | undefined>(undefined);

  useEffect(() => {
    if (cloud) return;
    let cancelled = false;
    fetch(`${httpBase()}/api/network`)
      .then((r) => (r.ok ? (r.json() as Promise<NetworkInfo>) : Promise.reject(new Error(String(r.status)))))
      .then((j) => !cancelled && setInfo(j))
      .catch(() => !cancelled && setInfo(null));
    return () => {
      cancelled = true;
    };
  }, [cloud]);

  if (cloud || info === undefined) return null;

  return (
    <div style={{ marginTop: 10, fontSize: 11, color: colors.textDim }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>Open on another device</div>
      {info && info.addresses.length > 0 ? (
        info.addresses.map((addr) => (
          <LanLink key={addr} url={`http://${addr}:${info.port}/renderer/?channel=${encodeURIComponent(channelId)}`} />
        ))
      ) : (
        <div>
          Couldn&apos;t detect this computer&apos;s network address — use its IP with port{" "}
          {info?.port ?? 4000}.
        </div>
      )}
      <div style={{ marginTop: 4 }}>
        Devices must be on the same network. On macOS, allow incoming connections for OverlaySys if asked.
      </div>
    </div>
  );
}

function LanLink({ url }: { url: string }) {
  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState(false);
  const textRef = useRef<HTMLElement>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      const el = textRef.current;
      if (el) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
  };

  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <code ref={textRef} style={{ fontFamily: "ui-monospace, monospace", color: colors.accent2 }}>
          {url}
        </code>
        <Button onClick={copy}>{copied ? "Copied" : "Copy"}</Button>
        <Button onClick={() => setShowQr((v) => !v)}>{showQr ? "Hide QR" : "QR"}</Button>
      </div>
      {showQr && (
        <div style={{ marginTop: 6 }}>
          <QrCode value={url} />
        </div>
      )}
    </div>
  );
}
