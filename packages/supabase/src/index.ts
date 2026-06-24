import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

export type { Database } from "./database.types";
export type OverlaySysSupabaseClient = SupabaseClient<Database, "overlaysys">;
export { CloudStorageAdapter } from "./cloudStorageAdapter";

export const OVERLAYSYS_SCHEMA = "overlaysys" as const;
export const ASSETS_BUCKET = "overlaysys-assets" as const;

export interface SupabaseEnv {
  /** apps-portal's Supabase project URL (e.g. https://abc.supabase.co). */
  url: string;
  /** Anon (publishable) key. Safe to embed in browser bundles. */
  anonKey: string;
  /** Service-role key. NEVER ship to a browser; server-only. */
  serviceRoleKey?: string;
}

/**
 * Browser/anon client scoped to the `overlaysys` schema. Auth is opt-in:
 * the caller hydrates a session via `client.auth.setSession()` after
 * parsing the URL hash apps-portal redirects with. All reads/writes go
 * through RLS, so an unauthenticated client sees nothing.
 *
 * Schema scoping means `client.from('projects')` targets
 * `overlaysys.projects` automatically — no need to spell the schema in
 * every query.
 */
export function createBrowserClient(env: SupabaseEnv): OverlaySysSupabaseClient {
  return createClient<Database, "overlaysys">(env.url, env.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // Don't auto-detect tokens in the hash — we handle that explicitly in
      // lib/cloudAuth.ts so we can also read registry_org_id and call
      // /api/auth/bootstrap before the user does anything.
      detectSessionInUrl: false,
    },
    db: { schema: OVERLAYSYS_SCHEMA },
  });
}

/**
 * Anon client scoped for use from a Node host that doesn't own the
 * canonical token store — e.g. the desktop's embedded server, which
 * receives tokens pushed down from the Electron main process and must
 * not refresh them independently. Auto-refresh is disabled so the only
 * way new tokens land is via an explicit `setSession()` call from the
 * caller. persistSession is also off because localStorage isn't real
 * here.
 */
export function createNodeAnonClient(env: SupabaseEnv): OverlaySysSupabaseClient {
  return createClient<Database, "overlaysys">(env.url, env.anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    db: { schema: OVERLAYSYS_SCHEMA },
  });
}

/**
 * Service-role client. Used only from server-side code (Next.js API routes,
 * the publish ingest path). Bypasses RLS so do NOT pass it user-controlled
 * queries without validation.
 */
export function createServiceClient(env: SupabaseEnv): OverlaySysSupabaseClient {
  if (!env.serviceRoleKey) {
    throw new Error(
      "createServiceClient requires serviceRoleKey — server-side only",
    );
  }
  return createClient<Database, "overlaysys">(env.url, env.serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    db: { schema: OVERLAYSYS_SCHEMA },
  });
}

/**
 * Helper for `<org_id>/<sha256>.<ext>` object paths in the
 * overlaysys-assets bucket. Keeping the convention in one place so
 * server-side publish, browser asset previewers, and the GC job all
 * agree on layout.
 */
export function assetObjectPath(orgId: string, filename: string): string {
  return `${orgId}/${filename}`;
}
