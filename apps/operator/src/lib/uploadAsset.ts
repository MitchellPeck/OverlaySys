"use client";

import { defaultServerUrl } from "./wsClient";

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
 * Upload a binary file to the server's content-addressed asset store.
 * Returns a relative URL like `/assets/<sha256>.<ext>` that's safe to embed
 * in templates — the renderer/canvas resolves it against the same origin.
 *
 * Throws on network failure or non-2xx responses; the caller is responsible
 * for surfacing the error to the user.
 */
export async function uploadAsset(file: File): Promise<UploadResult> {
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
 * Hook left in place for the (rare) case a template was hand-edited with a
 * relative `/assets/...` URL. New uploads return absolute URLs from the
 * server, so the prefix branch usually doesn't fire.
 */
export function resolveAssetUrl(stored: string): string {
  if (!stored) return stored;
  if (stored.startsWith("/assets/")) return `${httpBase()}${stored}`;
  return stored;
}
