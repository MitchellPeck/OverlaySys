"use client";

import { defaultServerUrl } from "./wsClient";
import { isCloudMode } from "./mode";
import { resolveAssetUrlCloud, uploadAssetCloud } from "./cloudData";

/**
 * Derive the HTTP base for asset uploads from the WS URL the operator is
 * already using to talk to the server. `ws://host:port/ws` → `http://host:port`,
 * `wss://...` → `https://...`. Same origin == same machine in every supported
 * deployment (dev, packaged Electron, LAN).
 */
function httpBase(): string {
  const ws = defaultServerUrl();
  try {
    const u = new URL(ws);
    const proto = u.protocol === "wss:" ? "https:" : "http:";
    return `${proto}//${u.host}`;
  } catch {
    // If defaultServerUrl returned something unparseable, fall back to the
    // page's own origin. The Fastify server in dev sits at :4000 not :3000,
    // so this is a last resort that probably won't work — but better than
    // throwing.
    return typeof window !== "undefined" ? window.location.origin : "";
  }
}

export type UploadResult = {
  url: string;
  sha256: string;
  size: number;
  mime: string;
};

/**
 * Upload a binary file to the content-addressed asset store. In local
 * mode that's the Fastify server's `/api/assets` endpoint; in cloud mode
 * it's Supabase Storage's `overlaysys-assets` bucket. Returns the same
 * shape either way: a relative URL like `/assets/<sha256>.<ext>` that's
 * safe to embed in template payloads. `resolveAssetUrl` rewrites that
 * relative path to whatever host actually serves the bytes.
 *
 * Throws on network failure or non-2xx responses; the caller is responsible
 * for surfacing the error to the user.
 */
export async function uploadAsset(file: File): Promise<UploadResult> {
  if (isCloudMode()) {
    return uploadAssetCloud(file);
  }

  const fd = new FormData();
  fd.append("file", file, file.name);

  const base = httpBase();
  const res = await fetch(`${base}/api/assets`, {
    method: "POST",
    body: fd,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`asset upload failed (${res.status}): ${text || res.statusText}`);
  }

  const data = (await res.json()) as Partial<UploadResult>;
  if (!data.url || !data.sha256) {
    throw new Error("asset upload returned malformed response");
  }
  return data as UploadResult;
}

/**
 * Resolve a stored asset URL for browser-level fetching. The server now
 * returns and persists relative `/assets/<filename>` paths (see
 * `server/src/assets.ts` and `bundleApply.normalizeAssetUrlsInTemplate`) —
 * relative URLs are essential for packaged Electron, where the server
 * binds to an OS-assigned ephemeral port that differs between launches.
 *
 * In Electron production the operator is served by the same origin as the
 * asset endpoint, so relative URLs would resolve naturally even without
 * this helper. In dev (`pnpm dev`) the operator runs on :3000 while the
 * asset server is on :4000, so we have to prepend the WS server's HTTP
 * origin for previews and direct `<img src>` rendering to work.
 *
 * Already-absolute URLs are returned unchanged so legacy data still loads
 * until the server's boot migration rewrites it.
 */
export function resolveAssetUrl(stored: string): string {
  if (!stored) return stored;
  if (isCloudMode()) {
    return resolveAssetUrlCloud(stored);
  }
  if (stored.startsWith("/assets/")) return `${httpBase()}${stored}`;
  return stored;
}
