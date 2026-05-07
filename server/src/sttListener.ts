export interface ListenerInfo {
  audioSourceId: string;
  label?: string;
  online: boolean;
  lastSeen: number;
}

type Listener = (listeners: ListenerInfo[]) => void;

const registry = new Map<string, ListenerInfo>();
const subscribers = new Set<Listener>();

function notify(): void {
  const snapshot = Array.from(registry.values());
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

export function markHypothesisReceived(audioSourceId: string): void {
  const existing = registry.get(audioSourceId);
  if (!existing) return;
  existing.lastSeen = Date.now();
  notify();
}

export function disconnect(audioSourceId: string): void {
  const existing = registry.get(audioSourceId);
  if (!existing) return;
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
