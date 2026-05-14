/**
 * Operator runtime mode detection.
 *
 * Two modes:
 *   - **local**: WebSocket to a Fastify server on localhost (or LAN). The
 *     default for the Electron-packaged operator and for `pnpm dev`.
 *   - **cloud**: Supabase queries against apps-portal's overlaysys schema.
 *     The web deploy at overlaysys.mitchellpeck.com runs in this mode.
 *
 * Mode is fixed at build time via `NEXT_PUBLIC_OVERLAYSYS_CLOUD_MODE=true`.
 * Inlined into the bundle by Next.js so the boolean is constant after
 * build — predictable dead-code elimination, no runtime ambiguity.
 */

const CLOUD_MODE_FLAG =
  process.env["NEXT_PUBLIC_OVERLAYSYS_CLOUD_MODE"] === "true";

export function isCloudMode(): boolean {
  return CLOUD_MODE_FLAG;
}

export function isLocalMode(): boolean {
  return !CLOUD_MODE_FLAG;
}
