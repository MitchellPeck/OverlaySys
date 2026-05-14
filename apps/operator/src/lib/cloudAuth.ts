"use client";

import {
  createBrowserClient,
  type OverlaySysSupabaseClient,
} from "@overlaysys/supabase";

const ORG_ID_STORAGE_KEY = "overlaysys:registry-org-id";

/**
 * Persisted registry org id from the most recent hash bootstrap. Survives
 * page reloads and tab restarts in the same browser. Cleared explicitly on
 * sign-out (Phase 4). Survives even when no hash is on the URL, so a hard
 * reload doesn't drop the org scope the user was working in.
 */
export function getStoredRegistryOrgId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ORG_ID_STORAGE_KEY);
}

function setStoredRegistryOrgId(id: string | null): void {
  if (typeof window === "undefined") return;
  if (id) window.localStorage.setItem(ORG_ID_STORAGE_KEY, id);
  else window.localStorage.removeItem(ORG_ID_STORAGE_KEY);
}

/**
 * Cloud auth bootstrap.
 *
 * When the user clicks "Open OverlaySys" on apps.mitchellpeck.com, the
 * registry redirects here with a URL hash carrying access_token, refresh_token,
 * expires_in, expires_at, token_type, type=magiclink, and our custom
 * `registry_org_id`. This module parses the hash, hydrates a Supabase
 * session, and (in Phase 3) pings the bootstrap endpoint to ensure the
 * user has an org_members row in OverlaySys's Supabase.
 *
 * This file is wired into the operator's Phase 3 cloud-mode entry; it's
 * inert in local-only mode.
 */

interface CloudSessionTokens {
  accessToken: string;
  refreshToken: string;
  /**
   * Present when apps-portal's open route includes it (after the
   * route's registry_org_id extension landed). Older apps-portal builds
   * omit it; we still set the session in that case, but the UI shows a
   * "no org context" state until the user re-launches from an updated
   * apps-portal.
   */
  registryOrgId: string | null;
}

/**
 * Parse the hash that apps-portal's /api/apps/[id]/open route emits.
 * Requires access_token + refresh_token. registry_org_id is best-effort
 * — its absence doesn't block the session, just the org-scoped queries.
 */
export function parseCloudHash(hash: string): CloudSessionTokens | null {
  const trimmed = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!trimmed) return null;
  const params = new URLSearchParams(trimmed);
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  const registryOrgId = params.get("registry_org_id");
  if (!accessToken || !refreshToken) return null;
  return { accessToken, refreshToken, registryOrgId };
}

/**
 * Strip the hash fragment from the URL without triggering a navigation.
 * Called after parseCloudHash has consumed the tokens; leaving them in the
 * address bar means a bookmark or accidental share leaks live credentials.
 */
export function clearHash(): void {
  if (typeof window === "undefined") return;
  const url = `${window.location.pathname}${window.location.search}`;
  window.history.replaceState(null, "", url);
}

let cachedClient: OverlaySysSupabaseClient | null = null;

/**
 * Lazy-init Supabase client from NEXT_PUBLIC_* env vars. Throws if the
 * operator is built without cloud env — caller code should only reach this
 * after detecting cloud-mode at runtime.
 */
export function getCloudClient(): OverlaySysSupabaseClient {
  if (cachedClient) return cachedClient;
  const url = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const anonKey = process.env["NEXT_PUBLIC_SUPABASE_ANON_KEY"];
  if (!url || !anonKey) {
    throw new Error(
      "Cloud mode requires NEXT_PUBLIC_SUPABASE_URL and " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY at build time",
    );
  }
  cachedClient = createBrowserClient({ url, anonKey });
  return cachedClient;
}

/**
 * Run the full bootstrap: hash → setSession → POST /api/auth/bootstrap.
 * Idempotent: safe to call on every page load. Returns true when the user
 * is signed in afterwards (including the case where a session was already
 * present from a prior load).
 */
export async function bootstrapFromHash(): Promise<{
  signedIn: boolean;
  registryOrgId: string | null;
}> {
  if (typeof window === "undefined") return { signedIn: false, registryOrgId: null };
  const tokens = parseCloudHash(window.location.hash);
  if (tokens) {
    const client = getCloudClient();
    const { error } = await client.auth.setSession({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
    });
    clearHash();
    if (error) {
      console.warn("[cloudAuth] setSession failed", error);
      return { signedIn: false, registryOrgId: tokens.registryOrgId };
    }
    // Persist so reloads don't lose org context — the hash is gone after
    // we strip it, but the Supabase session lives in localStorage and
    // outlives the URL.
    if (tokens.registryOrgId) setStoredRegistryOrgId(tokens.registryOrgId);
    // No bootstrap endpoint needed: with the shared-schema model,
    // membership lives in apps-portal's public.orgs.members and is
    // managed there. RLS reads it on every query.
    return { signedIn: true, registryOrgId: tokens.registryOrgId };
  }
  const client = getCloudClient();
  const { data } = await client.auth.getSession();
  // No hash this load — fall back to the previously persisted org id so
  // reloads inside an active session keep working.
  return {
    signedIn: !!data.session,
    registryOrgId: getStoredRegistryOrgId(),
  };
}
