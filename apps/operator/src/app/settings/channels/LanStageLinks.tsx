"use client";

import { useEffect, useRef, useState } from "react";
import { Button, colors } from "@overlaysys/ui";
import { isCloudMode } from "@/lib/mode";
import { httpBase } from "@/lib/pcoClient";
import { isElectron } from "@/lib/desktop";
import { QrCode } from "./QrCode";
import { lanMonitorUrl } from "./lanMonitorUrl";

interface NetworkInfo {
  port: number;
  addresses: string[];
}

// One /api/network request shared by every channel row on the page.
let networkInfoPromise: Promise<NetworkInfo | null> | null = null;
function fetchNetworkInfo(): Promise<NetworkInfo | null> {
  if (!networkInfoPromise) {
    networkInfoPromise = fetch(`${httpBase()}/api/network`)
      .then((r) => (r.ok ? (r.json() as Promise<NetworkInfo>) : null))
      .catch(() => null)
      .then((j) => {
        // Don't cache a failure — the next mount retries.
        if (!j) networkInfoPromise = null;
        return j;
      });
  }
  return networkInfoPromise;
}

/**
 * "Open on another device" links for any channel kind: a clean LAN URL (no
 * debug flag) with Copy and a QR code, for OBS on another PC, a stage
 * display or a tablet.
 */
export function LanStageLinks({ channelId, rendererBase }: { channelId: string; rendererBase: string }) {
  const cloud = isCloudMode();
  const [info, setInfo] = useState<NetworkInfo | null | undefined>(undefined);

  useEffect(() => {
    if (cloud) return;
    let cancelled = false;
    void fetchNetworkInfo().then((j) => {
      if (!cancelled) setInfo(j);
    });
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
          <LanLink key={addr} url={lanMonitorUrl({ rendererBase, fromDesktop: isElectron(), address: addr, port: info.port, channelId })} />
        ))
      ) : (
        <div>
          Couldn&apos;t detect this computer&apos;s network address — use its IP with port{" "}
          {info?.port ?? 4000}.
        </div>
      )}
    </div>
  );
}

function LanLink({ url }: { url: string }) {
  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState(false);
  const [hint, setHint] = useState(false);
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
      setHint(true);
      setTimeout(() => setHint(false), 3000);
    }
  };

  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <code ref={textRef} style={{ fontFamily: "ui-monospace, monospace", color: colors.accent, overflowWrap: "anywhere" }}>
          {url}
        </code>
        <Button size="sm" onClick={copy}>{copied ? "Copied" : "Copy URL"}</Button>
        <Button size="sm" onClick={() => setShowQr((v) => !v)} aria-expanded={showQr}>
          {showQr ? "Hide QR" : "QR code"}
        </Button>
        {hint && <span>Press ⌘C / Ctrl+C to copy</span>}
      </div>
      {showQr && (
        <div style={{ marginTop: 6 }}>
          <QrCode value={url} />
        </div>
      )}
    </div>
  );
}
