import type { FastifyInstance } from "fastify";

/** True for a Node `listen` error whose port is already taken. */
export function isAddrInUse(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "EADDRINUSE"
  );
}

/**
 * Bind the server, falling back to an OS-assigned ephemeral port if the
 * preferred one is already in use.
 *
 * The desktop host reports whatever port we land on
 * (`OVERLAYSYS_PORT=<n>`) and builds every window URL from it, so a
 * fallback is transparent to the app's own windows. Only fixed-port
 * external integrations (Companion / Stream Deck on 4000) miss us on a
 * fallback — and that only happens when something already holds 4000,
 * where those integrations are talking to that other listener anyway.
 *
 * Previously a busy port surfaced as an unhandled EADDRINUSE, the server
 * exited code 1, and the Electron host treated that as fatal and quit —
 * so a single stale/leftover server on 4000 made the whole app
 * un-launchable. Falling back keeps the app usable.
 *
 * Returns the actually-bound port.
 */
export async function listenWithFallback(
  app: FastifyInstance,
  host: string,
  port: number,
): Promise<number> {
  try {
    await app.listen({ host, port });
  } catch (err) {
    // port 0 already means "any free port" — a failure there is real.
    if (port === 0 || !isAddrInUse(err)) throw err;
    app.log.warn(
      `[boot] port ${port} in use — falling back to an OS-assigned port`,
    );
    await app.listen({ host, port: 0 });
  }
  const addr = app.server.address();
  return typeof addr === "object" && addr ? addr.port : port;
}
