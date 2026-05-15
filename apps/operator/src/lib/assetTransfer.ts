"use client";

import { defaultServerUrl } from "./wsClient";
import { isCloudMode } from "./mode";
import { resolveAssetUrlCloud } from "./cloudData";

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
  if (isCloudMode()) {
    return fetchAssetBase64Cloud(filename);
  }
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

/**
 * Cloud equivalent: fetch the asset's bytes from Supabase Storage (the
 * bucket is public, so a plain fetch works), then base64-encode for
 * inclusion in an export bundle. Exported so the publish/pull sync code
 * can call it directly regardless of operator mode — when pulling a
 * cloud project down to an Electron host, the operator is in local
 * mode but the bundle's assets still live in Supabase.
 */
export async function fetchAssetBase64Cloud(filename: string): Promise<RawAsset | null> {
  const url = resolveAssetUrlCloud(`/assets/${filename}`);
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`asset fetch failed (${res.status}) for ${filename}`);
  }
  const buf = await res.arrayBuffer();
  return {
    filename,
    size: buf.byteLength,
    base64: arrayBufferToBase64(buf),
  };
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  // Chunk to avoid blowing the call-stack limit on large videos.
  const CHUNK = 0x8000;
  let bin = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    bin += String.fromCharCode(...slice);
  }
  return btoa(bin);
}

