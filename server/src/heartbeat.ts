// Server-side WebSocket liveness sweep.
//
// A renderer PC that loses power or a laptop that sleeps doesn't close its
// TCP connection; without a ping the server keeps the dead socket (and its
// output presence) for minutes. Every interval each socket gets a WS-level
// ping; one that misses `maxMissed` pongs in a row is terminated, which
// runs the normal close path (unsubscribe, presence update).

export interface PingableSocket {
  ping(): void;
  terminate(): void;
  on(event: "pong", listener: () => void): unknown;
}

export const HEARTBEAT_INTERVAL_MS = 10_000;
export const HEARTBEAT_MAX_MISSED = 2;

const missed = new WeakMap<PingableSocket, number>();

/** Start tracking a socket. Any pong resets its missed count. */
export function trackSocket(ws: PingableSocket): void {
  missed.set(ws, 0);
  ws.on("pong", () => missed.set(ws, 0));
}

/** One sweep: terminate sockets past the limit, ping the rest. Returns terminated count. */
export function sweep(sockets: Iterable<PingableSocket>, maxMissed: number = HEARTBEAT_MAX_MISSED): number {
  let terminated = 0;
  for (const ws of sockets) {
    const n = missed.get(ws) ?? 0;
    if (n >= maxMissed) {
      terminated++;
      try {
        ws.terminate();
      } catch {
        /* already gone */
      }
      continue;
    }
    missed.set(ws, n + 1);
    try {
      ws.ping();
    } catch {
      /* socket closing; the next sweep terminates it */
    }
  }
  return terminated;
}

export function startHeartbeat(
  clients: () => Iterable<PingableSocket>,
  intervalMs: number = HEARTBEAT_INTERVAL_MS,
): () => void {
  const id = setInterval(() => sweep(clients()), intervalMs);
  id.unref?.();
  return () => clearInterval(id);
}
