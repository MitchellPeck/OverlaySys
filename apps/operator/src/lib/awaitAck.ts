import type { ClientMessage, ServerMessage } from "@overlaysys/ws-protocol";
import type { WsStatus } from "./wsClient";

export type AckClient = {
  send(m: ClientMessage): void;
  on(l: (m: ServerMessage) => void): () => void;
  onStatus(l: (s: WsStatus) => void): () => void;
  getStatus(): WsStatus;
};

export type AckErrorCode = "not_connected" | "timeout" | "disconnected" | "server_error";

const DEFAULT_TEXT: Record<AckErrorCode, string> = {
  not_connected: "Not connected to the server.",
  timeout: "The server didn't confirm in time.",
  disconnected: "Disconnected before the server confirmed.",
  server_error: "The server reported an error.",
};

export class AckError extends Error {
  code: AckErrorCode;
  constructor(code: AckErrorCode, message?: string) {
    super(message ?? DEFAULT_TEXT[code]);
    this.name = "AckError";
    this.code = code;
  }
}

export function ackErrorText(e: unknown): string {
  if (e instanceof Error && e.message) return e.message;
  return "Something went wrong.";
}

const ERROR_CODES = new Set(["handler_error", "bad_message", "not_found"]);

/** Send `message` and resolve once `accept` returns a value; reject on timeout, disconnect or server error. */
function run<T>(
  client: AckClient,
  message: ClientMessage,
  timeoutMs: number,
  accept: (m: ServerMessage) => T | undefined,
  watchErrors: boolean,
): Promise<T> {
  if (client.getStatus() !== "open") return Promise.reject(new AckError("not_connected"));
  return new Promise<T>((resolve, reject) => {
    const cleanups: Array<() => void> = [];
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      for (const c of cleanups) c();
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new AckError("timeout"))), timeoutMs);
    cleanups.push(
      client.on((m) => {
        if (watchErrors && m.type === "error" && ERROR_CODES.has(m.code)) {
          finish(() => reject(new AckError("server_error", m.message)));
          return;
        }
        const v = accept(m);
        if (v !== undefined) finish(() => resolve(v));
      }),
    );
    cleanups.push(
      client.onStatus((s) => {
        if (s !== "open") finish(() => reject(new AckError("disconnected")));
      }),
    );
    try {
      client.send(message);
    } catch {
      finish(() => reject(new AckError("not_connected")));
    }
  });
}

export function sendAndAwaitAck(
  client: AckClient,
  message: ClientMessage,
  match: { op: string; id?: string },
  o?: { timeoutMs?: number },
): Promise<void> {
  return run<true>(
    client,
    message,
    o?.timeoutMs ?? 8000,
    (m) => (m.type === "ack" && m.op === match.op && (match.id === undefined || m.id === match.id) ? true : undefined),
    true,
  ).then(() => undefined);
}

export function requestOne<T>(
  client: AckClient,
  message: ClientMessage,
  pick: (m: ServerMessage) => T | undefined,
  o?: { timeoutMs?: number },
): Promise<T> {
  return run<T>(client, message, o?.timeoutMs ?? 5000, pick, false);
}
