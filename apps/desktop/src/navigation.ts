// Which pages the operator's windows may load, and which links may leave the
// app for the system browser. Kept free of Electron imports so it can be
// unit-tested.

/**
 * True when `url`'s origin is exactly one of `origins`. A prefix test would
 * let `http://127.0.0.1:4000@evil.com` through; parsing doesn't.
 */
export function isAllowedOrigin(url: string, origins: readonly string[]): boolean {
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return false;
  }
  // file:, data: and friends all share the opaque origin "null".
  return origin !== "null" && origins.includes(origin);
}

const EXTERNAL_SCHEMES = new Set(["https:", "http:", "mailto:"]);

/**
 * True when `url` is safe to hand to the system's opener: web and mail links
 * only, never file:, smb: or an app's custom scheme.
 */
export function isSafeExternalUrl(url: string): boolean {
  try {
    return EXTERNAL_SCHEMES.has(new URL(url).protocol);
  } catch {
    return false;
  }
}
