"use client";

import { useState } from "react";
import { toast } from "@overlaysys/ui";
import { useSyncStatus } from "@/lib/useSyncStatus";
import { httpBase } from "@/lib/pcoClient";
import { syncView } from "@/app/shell/shellStatus";
import { copyText } from "@/app/shell/clipboard";
import { StatusPopoverButton } from "@/app/shell/StatusPopoverButton";
import { statusPopoverModel } from "@/app/shell/statusPopover";

/**
 * Top-bar status for the desktop server's cloud sync. Renders nothing in the
 * cloud build (no embedded server) or when signed out and healthy. Click for
 * details (per-record errors, overwrites), "Sync now" and "Copy error" —
 * errors used to live only in a hover tooltip.
 */
export function SyncStatusPill() {
  const status = useSyncStatus();
  const [busy, setBusy] = useState(false);
  if (!status) return null;
  const view = syncView(status, Date.now());
  if (!view) return null;

  async function syncNow() {
    setBusy(true);
    try {
      const res = await fetch(`${httpBase()}/api/cloud/sync`, { method: "POST" });
      toast(
        res.ok
          ? { message: "Sync started. Status updates within 10s.", tone: "ok" }
          : { message: `Sync request failed (${res.status})`, tone: "error" },
      );
    } catch (e) {
      toast({ message: `Sync request failed: ${e instanceof Error ? e.message : String(e)}`, tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  const model = statusPopoverModel("sync", {
    details: view.details,
    paired: status.paired,
    running: status.running,
    busy,
    error: view.error,
  });
  return (
    <StatusPopoverButton
      tone={view.tone}
      label={view.label}
      ariaLabel={`Cloud ${view.label} — details`}
      width={320}
      model={model}
      onAction={(id) => {
        if (id === "sync-now") void syncNow();
        else if (id === "copy-error" && view.error) {
          void copyText(view.error).then((ok) =>
            toast(ok ? { message: "Error copied", tone: "ok" } : { message: "Couldn't copy to the clipboard", tone: "warn" }),
          );
        }
      }}
    />
  );
}
