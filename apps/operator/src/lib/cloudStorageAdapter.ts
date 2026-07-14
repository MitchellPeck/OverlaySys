"use client";

// Operator-side factory: thin wrapper that wires the operator's existing
// Supabase client (from cloudAuth.ts) into the platform-agnostic
// CloudStorageAdapter shipped from @overlaysys/supabase. Kept as a
// separate module so callers don't have to know about the dependency
// injection — they just import `getCloudStorageAdapter()` and go.

import { CloudStorageAdapter } from "@overlaysys/supabase";
import { getCloudClient } from "./cloudAuth";

let cached: CloudStorageAdapter | null = null;

/**
 * Singleton accessor. The adapter is stateless, so caching is only
 * about avoiding redundant construction. Resets are not needed when the
 * underlying client's session changes — the adapter holds a reference
 * to the client, not its session, and the client itself mutates
 * in-place when tokens are set/cleared.
 */
export function getCloudStorageAdapter(): CloudStorageAdapter {
  if (!cached) cached = new CloudStorageAdapter(getCloudClient());
  return cached;
}
