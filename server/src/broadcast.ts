import type { ServerMessage } from "@overlaysys/ws-protocol";

type Sender = (msg: ServerMessage) => void;

const senders = new Set<Sender>();

export function registerSender(send: Sender): () => void {
  senders.add(send);
  return () => {
    senders.delete(send);
  };
}

export function broadcast(msg: ServerMessage): void {
  for (const send of senders) {
    try {
      send(msg);
    } catch {
      // Each sender is wrapped in handleConnection's send(); errors there
      // already log. Don't let one bad client break the broadcast.
    }
  }
}
