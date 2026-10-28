// Pure config builders for next.config.mjs (imported there directly, so keep
// this file free of non-erasable TS syntax and of imports).
export interface DevProxyEnv {
  NEXT_BUILD_STATIC?: string;
  OVERLAYSYS_SERVER_URL?: string;
}

export function assetRewrites(
  env: DevProxyEnv,
): { source: string; destination: string }[] {
  if (env.NEXT_BUILD_STATIC === "1") return [];
  const server = (env.OVERLAYSYS_SERVER_URL || "http://localhost:4000").replace(/\/+$/, "");
  return [{ source: "/assets/:p*", destination: `${server}/assets/:p*` }];
}
