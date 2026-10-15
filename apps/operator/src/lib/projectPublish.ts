"use client";

import { BundleSchema, type Bundle } from "@overlaysys/core";
import type { ApplyBundleResult } from "./cloudData";
import { defaultServerUrl } from "./wsClient";

/**
 * Per-project **Publish** for the desktop operator.
 *
 * Automatic sync keeps entity JSON reconciled, but it never moves assets
 * and only pushes records whose local stamp is newer. Publish is the
 * explicit "make my local version canonical, now" action: the server
 * builds the bundle from disk (re-stamping everything it includes), the
 * operator pushes it to the cloud with the existing bundle applier, then
 * kicks a sync pass so the replicas settle straight away.
 *
 * Dependencies are injectable so the flow is testable without a server
 * or a Supabase session.
 */

export interface PublishDeps {
  fetchBundle(projectId: string): Promise<unknown>;
  applyBundle(bundle: Bundle, onProgress?: (msg: string) => void): Promise<ApplyBundleResult>;
  kickSync(): Promise<void>;
}

export interface PublishResult {
  ok: boolean;
  counts: ApplyBundleResult["counts"];
  errors: ApplyBundleResult["errors"];
}

export function publishBundleUrl(httpBase: string, projectId: string): string {
  return `${httpBase}/api/projects/${encodeURIComponent(projectId)}/publish-bundle`;
}

function httpBase(): string {
  try {
    const u = new URL(defaultServerUrl());
    const proto = u.protocol === "wss:" ? "https:" : "http:";
    return `${proto}//${u.host}`;
  } catch {
    return typeof window !== "undefined" ? window.location.origin : "";
  }
}

const defaultDeps: PublishDeps = {
  async fetchBundle(projectId) {
    const res = await fetch(publishBundleUrl(httpBase(), projectId), { method: "POST" });
    if (!res.ok) {
      throw new Error(`server refused to build the publish bundle (HTTP ${res.status})`);
    }
    return res.json();
  },
  async applyBundle(bundle, onProgress) {
    // Lazy so this module (and its tests) don't drag the Supabase client
    // in until a publish actually happens.
    const { applyBundleCloud } = await import("./cloudData");
    return applyBundleCloud(bundle, onProgress);
  },
  async kickSync() {
    await fetch(`${httpBase()}/api/cloud/sync`, { method: "POST" });
  },
};

export async function publishProjectToCloud(
  projectId: string,
  deps: PublishDeps = defaultDeps,
  onProgress?: (msg: string) => void,
): Promise<PublishResult> {
  onProgress?.("building bundle…");
  const raw = await deps.fetchBundle(projectId);
  const parsed = BundleSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("server returned an invalid publish bundle");
  }
  const result = await deps.applyBundle(parsed.data, onProgress);
  // Whatever landed is in the cloud now; converging the local replica is
  // a nicety, not part of the publish itself.
  try {
    onProgress?.("syncing…");
    await deps.kickSync();
  } catch (err) {
    console.warn("[publish] sync kick after publish failed", err);
  }
  return { ok: result.errors.length === 0, counts: result.counts, errors: result.errors };
}
