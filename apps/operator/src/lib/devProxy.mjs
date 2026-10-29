// Pure config builders for next.config.mjs. Plain .mjs (JSDoc types) so the
// config loads on every supported Node version without TS stripping.

/**
 * @typedef {{ NODE_ENV?: string; NEXT_BUILD_STATIC?: string;
 *   NEXT_PUBLIC_OVERLAYSYS_CLOUD_MODE?: string; OVERLAYSYS_SERVER_URL?: string }} DevProxyEnv
 */

/**
 * True only for the local dev server: never for production, static
 * (Electron) or cloud builds, where /assets must not proxy to localhost.
 * @param {DevProxyEnv} env
 */
export function devProxyEnabled(env) {
  if (env.NODE_ENV === "production") return false;
  if (env.NEXT_BUILD_STATIC === "1") return false;
  if (env.NEXT_PUBLIC_OVERLAYSYS_CLOUD_MODE === "1" || env.NEXT_PUBLIC_OVERLAYSYS_CLOUD_MODE === "true") return false;
  return true;
}

/**
 * Dev-only rewrite of /assets to the OverlaySys server.
 * @param {DevProxyEnv} env
 * @returns {{ source: string; destination: string }[]}
 */
export function assetRewrites(env) {
  if (!devProxyEnabled(env)) return [];
  const server = (env.OVERLAYSYS_SERVER_URL || "http://localhost:4000").replace(/\/+$/, "");
  return [{ source: "/assets/:p*", destination: `${server}/assets/:p*` }];
}
