export interface ListenerInfo {
  audioSourceId: string;
  label?: string;
  online: boolean;
  lastSeen: number;
}

type Listener = (listeners: ListenerInfo[]) => void;

const registry = new Map<string, ListenerInfo>();
const subscribers = new Set<Listener>();

/**
 * A listener sends several hypotheses a second. Each used to re-broadcast
 * the whole listener list to every client (renderers and Companion
 * included) just to move `lastSeen`. Now only online/offline changes notify
 * immediately; `lastSeen` refreshes at most this often.
 */
export const LAST_SEEN_NOTIFY_MS = 5000;
let lastNotifyAt = 0;

function notify(now: number = Date.now()): void {
  lastNotifyAt = now;
  const snapshot = Array.from(registry.values()).map((l) => ({ ...l }));
  for (const fn of subscribers) {
    fn(snapshot);
  }
}

export function register(audioSourceId: string, label?: string): void {
  const existing = registry.get(audioSourceId);
  registry.set(audioSourceId, {
    audioSourceId,
    label,
    online: true,
    lastSeen: existing?.lastSeen ?? Date.now(),
  });
  notify();
}

export function markHypothesisReceived(audioSourceId: string, now: number = Date.now()): void {
  const existing = registry.get(audioSourceId);
  if (!existing) return;
  existing.lastSeen = now;
  const cameBack = !existing.online;
  existing.online = true;
  if (cameBack || now - lastNotifyAt >= LAST_SEEN_NOTIFY_MS) notify(now);
}

/** Most recent hypothesis time across online listeners (0 = never). */
export function lastHeardAt(): number {
  let t = 0;
  for (const l of registry.values()) if (l.online && l.lastSeen > t) t = l.lastSeen;
  return t;
}

export function disconnect(audioSourceId: string): void {
  const existing = registry.get(audioSourceId);
  if (!existing || !existing.online) return;
  existing.online = false;
  notify();
}

export function list(): ListenerInfo[] {
  return Array.from(registry.values());
}

export function subscribe(fn: Listener): () => void {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}
