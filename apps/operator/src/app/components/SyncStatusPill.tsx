"use client";

import { useState } from "react";
import { Button, colors } from "@overlaysys/ui";
import { useSyncStatus } from "@/lib/useSyncStatus";
import { httpBase } from "@/lib/pcoClient";
import { syncView } from "@/app/shell/shellStatus";
import { copyText } from "@/app/shell/clipboard";
import { StatusPopoverButton } from "@/app/shell/StatusPopoverButton";

/**
 * Top-bar status for the desktop server's cloud sync. Renders nothing in the
 * cloud build (no embedded server) or when signed out and healthy. Click for
 * details (per-record errors, overwrites), "Sync now" and "Copy error" —
 * errors used to live only in a hover tooltip.
 */
export function SyncStatusPill() {
  const status = useSyncStatus();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  if (!status) return null;
  const view = syncView(status, Date.now());
  if (!view) return null;

  async function syncNow() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(`${httpBase()}/api/cloud/sync`, { method: "POST" });
      setNote(res.ok ? "Sync started — status updates within 10s." : `Sync request failed (${res.status}).`);
    } catch (e) {
      setNote(`Sync request failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <StatusPopoverButton tone={view.tone} label={view.label} ariaLabel={`Cloud ${view.label} — details`} width={320}>
      {() => (
        <>
          <div style={{ fontWeight: 600 }}>Cloud sync</div>
          {view.details.map((d, i) => (
            <div key={i} style={{ color: i === 0 ? colors.textDim : colors.text, wordBreak: "break-word" }}>
              {d}
            </div>
          ))}
          {note && <div style={{ color: colors.textDim }}>{note}</div>}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {status.paired && (
              <Button size="sm" disabled={busy || status.running} onClick={() => void syncNow()}>
                {busy ? "Starting…" : "Sync now"}
              </Button>
            )}
            {view.error && (
              <Button size="sm" onClick={() => void copyText(view.error!).then((ok) => setNote(ok ? "Error copied." : "Couldn't copy."))}>
                Copy error
              </Button>
            )}
          </div>
        </>
      )}
    </StatusPopoverButton>
  );
}
