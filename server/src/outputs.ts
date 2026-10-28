// Output presence: which renderer windows are connected to which channel.
//
// The server always knew which sockets subscribed as renderers but never
// told anyone, so an operator could take a graphic to a channel whose OBS
// browser source had died and see nothing wrong. Renderer subscriptions
// (role "renderer", not a mirror's source subscription) register here; the
// ws layer broadcasts `outputs_state` whenever the set changes.

export interface OutputPresence {
  count: number;
  /** Most recent sign of life from any of the channel's outputs (ms epoch). */
  lastSeen: number;
  labels: string[];
}

type Listener = () => void;

/** connId → channel → label */
const byConn = new Map<string, Map<string, string>>();
const lastSeenByConn = new Map<string, number>();
const listeners = new Set<Listener>();

function notify(): void {
  for (const l of [...listeners]) {
    try {
      l();
    } catch (err) {
      console.warn("[outputs] listener failed", err);
    }
  }
}

export function subscribeOutputs(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** A renderer socket subscribed to `channel`. Notifies only on a real change. */
export function addOutput(connId: string, channel: string, label: string, now: number = Date.now()): void {
  let chans = byConn.get(connId);
  if (!chans) {
    chans = new Map();
    byConn.set(connId, chans);
  }
  lastSeenByConn.set(connId, now);
  if (chans.get(channel) === label) return;
  chans.set(channel, label);
  notify();
}

/** Any traffic (ping, status report) from the socket. Never notifies. */
export function touchOutput(connId: string, now: number = Date.now()): void {
  if (byConn.has(connId)) lastSeenByConn.set(connId, now);
}

/** Socket closed (or was terminated by the heartbeat sweep). */
export function removeConnection(connId: string): void {
  const had = byConn.get(connId);
  byConn.delete(connId);
  lastSeenByConn.delete(connId);
  if (had && had.size > 0) notify();
}

export function outputsSnapshot(): Record<string, OutputPresence> {
  const out: Record<string, OutputPresence> = {};
  for (const [connId, chans] of byConn) {
    const seen = lastSeenByConn.get(connId) ?? 0;
    for (const [channel, label] of chans) {
      const e = (out[channel] ??= { count: 0, lastSeen: 0, labels: [] });
      e.count++;
      if (seen > e.lastSeen) e.lastSeen = seen;
      if (label && !e.labels.includes(label)) e.labels.push(label);
    }
  }
  return out;
}

export function outputCount(channel: string): number {
  return outputsSnapshot()[channel]?.count ?? 0;
}

export function _resetForTest(): void {
  byConn.clear();
  lastSeenByConn.clear();
  listeners.clear();
}
