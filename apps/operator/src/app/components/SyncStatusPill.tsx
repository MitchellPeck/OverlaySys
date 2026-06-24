"use client";

import { Pill, type PillTone } from "@overlaysys/ui";
import { useSyncStatus } from "@/lib/useSyncStatus";

/**
 * Header pill summarizing the desktop server's last cloud-sync pass.
 * Renders nothing in cloud build mode (no embedded server) or when the
 * server hasn't received tokens yet — the pill is only meaningful for
 * Electron operators paired to apps-portal.
 *
 * States:
 *   - running:      dim, "syncing…"
 *   - last had errors: bad, "sync error"
 *   - last succeeded: good, "synced Xm ago"
 *   - paired, no pass yet: dim, "sync pending"
 */
export function SyncStatusPill() {
  const status = useSyncStatus();
  if (!status || !status.paired) return null;

  const { running, lastRanAt, lastError, lastResult } = status;
  let tone: PillTone = "dim";
  let label: string;
  let title: string | undefined;

  if (running) {
    tone = "warn";
    label = "syncing…";
  } else if (lastError) {
    tone = "bad";
    label = "sync error";
    title = lastError;
  } else if (lastResult && lastResult.errors.length > 0) {
    tone = "bad";
    label = `sync ${lastResult.errors.length} err`;
    title = lastResult.errors
      .slice(0, 5)
      .map((e) => `[${e.kind}:${e.id}] ${e.message}`)
      .join("\n");
  } else if (lastRanAt) {
    const overwriteCount = lastResult?.overwrites.length ?? 0;
    if (overwriteCount > 0) {
      // Cloud version was newer for at least one local record — surface
      // it as a soft warn so the operator knows their local copy of
      // those entities was replaced. Distinct from `errors` (which mean
      // the sync pass itself failed for some records).
      tone = "warn";
      label = `synced · ${overwriteCount} overwrite${overwriteCount === 1 ? "" : "s"}`;
      title = lastResult?.overwrites
        .slice(0, 5)
        .map(
          (o) =>
            `[${o.kind}:${o.id}] local ${o.localUpdatedAt} → remote ${o.remoteUpdatedAt}`,
        )
        .join("\n");
    } else {
      tone = "good";
      label = `synced ${formatRelative(lastRanAt)}`;
      if (lastResult) {
        title = `pulled ${lastResult.pulled}, pushed ${lastResult.pushed} on last pass`;
      }
    }
  } else {
    tone = "dim";
    label = "sync pending";
  }

  return (
    <Pill tone={tone} uppercase title={title}>
      ⇅ {label}
    </Pill>
  );
}

/**
 * Compact "Xs/m/h ago" formatter. The pill polls every 10s so resolution
 * below 60s gets a "just now" treatment.
 */
function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return new Date(iso).toLocaleDateString();
}
