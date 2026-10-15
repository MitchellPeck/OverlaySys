// Env plumbing for the embedded server child.
//
// The server's cloud-sync module (server/src/cloudSync.ts) reads
// OVERLAYSYS_SUPABASE_URL / OVERLAYSYS_SUPABASE_ANON_KEY, but the only
// Supabase values the desktop ever has are the operator's build-time
// NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY (from
// apps/desktop/.env, baked into dist/baked-env.json at package time).
// Nothing bridged the two names, so every packaged build spawned a server
// that refused tokens with "OVERLAYSYS_SUPABASE_URL ... not set" — the
// sync engine never ran, and because getCloudSyncStatus().paired stayed
// false the operator's SyncStatusPill rendered nothing at all.
//
// Kept as a pure function so the mapping is unit-testable without
// Electron.

export const SERVER_SUPABASE_URL_KEY = "OVERLAYSYS_SUPABASE_URL";
export const SERVER_SUPABASE_ANON_KEY = "OVERLAYSYS_SUPABASE_ANON_KEY";

/**
 * Return the Supabase env pair the server expects, derived from whatever
 * the host has. An explicit OVERLAYSYS_* value always wins; otherwise the
 * NEXT_PUBLIC_* pair is mirrored across. Empty strings count as unset so
 * a blank line in .env can't mask the fallback.
 */
export function resolveServerCloudEnv(
  env: Record<string, string | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  const url = firstSet(env[SERVER_SUPABASE_URL_KEY], env["NEXT_PUBLIC_SUPABASE_URL"]);
  const anon = firstSet(
    env[SERVER_SUPABASE_ANON_KEY],
    env["NEXT_PUBLIC_SUPABASE_ANON_KEY"],
  );
  if (url) out[SERVER_SUPABASE_URL_KEY] = url;
  if (anon) out[SERVER_SUPABASE_ANON_KEY] = anon;
  return out;
}

function firstSet(...values: (string | undefined)[]): string | undefined {
  for (const v of values) {
    if (typeof v === "string" && v.trim() !== "") return v;
  }
  return undefined;
}
