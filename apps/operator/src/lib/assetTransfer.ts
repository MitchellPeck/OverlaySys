"use client";

import { defaultServerUrl } from "./wsClient";

function httpBase(): string {
  const ws = defaultServerUrl();
  try {
    const u = new URL(ws);
    const proto = u.protocol === "wss:" ? "https:" : "http:";
    return `${proto}//${u.host}`;
  } catch {
    return typeof window !== "undefined" ? window.location.origin : "";
  }
}

export interface RawAsset {
  filename: string;
  size: number;
  base64: string;
}

/**
 * Read a stored asset's bytes from the server as base64. Returns null when
 * the asset isn't present — callers treat that as "not bundleable" rather
 * than aborting the whole export, since templates can outlive their assets.
 */
export async function fetchAssetBase64(filename: string): Promise<RawAsset | null> {
  const res = await fetch(`${httpBase()}/api/assets/raw/${encodeURIComponent(filename)}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`asset fetch failed (${res.status}) for ${filename}`);
  }
  const data = (await res.json()) as Partial<RawAsset>;
  if (typeof data.base64 !== "string" || typeof data.filename !== "string") {
    throw new Error(`asset fetch returned malformed response for ${filename}`);
  }
  return {
    filename: data.filename,
    size: typeof data.size === "number" ? data.size : 0,
    base64: data.base64,
  };
}

