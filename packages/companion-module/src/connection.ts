import WebSocket from "ws";
import {
  decodeServerTolerant,
  encode,
  type ClientMessage,
  type ServerMessage,
} from "@overlaysys/ws-protocol";

export interface ConnectionCallbacks {
  onConnected: () => void;
  onDisconnected: () => void;
  onReconnecting: () => void;
  onMessage: (msg: ServerMessage) => void;
  onLog: (level: "info" | "warn" | "error", message: string) => void;
}

export interface ConnectionOptions {
  host: string;
  port: number;
  /** LAN token (server OVERLAYSYS_TOKEN); empty = none. */
  token?: string;
}

export function connectionUrl(opts: ConnectionOptions): string {
  const base = `ws://${opts.host}:${opts.port}/ws`;
  return opts.token ? `${base}?token=${encodeURIComponent(opts.token)}` : base;
}

const BACKOFF_MS = [250, 1000, 2000, 4000, 8000, 10_000];

/** Delay before reconnect attempt `attempt` (0-based): 250 ms first, then back off to 10 s. */
export function backoffMs(attempt: number): number {
  return BACKOFF_MS[Math.min(Math.max(0, attempt), BACKOFF_MS.length - 1)]!;
}

/** Protocol ping cadence; a socket silent for DEAD_AFTER_MS is dropped and redialled. */
export const PING_INTERVAL_MS = 5_000;
export const DEAD_AFTER_MS = 10_000;

export class Connection {
  private ws: WebSocket | null = null;
  private closed = false;
  private attempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private lastInboundAt = 0;

  constructor(
    private readonly opts: ConnectionOptions,
    private readonly cb: ConnectionCallbacks,
  ) {}

  start(): void {
    this.closed = false;
    this.open();
  }

  stop(): void {
    this.closed = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      this.cb.onLog("warn", `dropping ${msg.type}: socket not open`);
      return;
    }
    this.ws.send(encode(msg));
  }

  private open(): void {
    const url = connectionUrl(this.opts);
    this.cb.onLog("info", `connecting ws://${this.opts.host}:${this.opts.port}/ws`);
    const ws = new WebSocket(url, { perMessageDeflate: false });
    this.ws = ws;

    ws.on("open", () => {
      if (this.ws !== ws) return;
      this.attempt = 0;
      this.lastInboundAt = Date.now();
      this.startHeartbeat(ws);
      this.cb.onConnected();
    });

    ws.on("message", (raw) => {
      if (this.ws !== ws) return;
      this.lastInboundAt = Date.now();
      let msg: ServerMessage | null;
      try {
        msg = decodeServerTolerant(raw.toString());
      } catch (err) {
        this.cb.onLog("error", `decode failed: ${String(err)}`);
        return;
      }
      // A message type newer than this module — nothing to do with it.
      if (!msg) return;
      try {
        this.cb.onMessage(msg);
      } catch (err) {
        this.cb.onLog("error", `handler threw: ${String(err)}`);
      }
    });

    ws.on("error", (err) => {
      this.cb.onLog("warn", `socket error: ${String(err)}`);
    });

    ws.on("close", () => {
      if (this.ws !== ws) return;
      this.stopHeartbeat();
      this.cb.onDisconnected();
      this.ws = null;
      if (!this.closed) this.scheduleReconnect();
    });
  }

  /**
   * A server that rebooted or a dropped network leaves the TCP socket
   * half-open for minutes, with every button press silently going nowhere.
   * Ping every 5 s; nothing heard for 10 s → drop the socket (its close
   * handler schedules the reconnect).
   */
  private startHeartbeat(ws: WebSocket): void {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => {
      if (Date.now() - this.lastInboundAt > DEAD_AFTER_MS) {
        this.cb.onLog("warn", "no traffic from server for 10 s — reconnecting");
        ws.terminate();
        return;
      }
      if (ws.readyState === WebSocket.OPEN) ws.send(encode({ type: "ping", t: Date.now() }));
    }, PING_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  private scheduleReconnect(): void {
    const delay = backoffMs(this.attempt);
    this.attempt++;
    this.cb.onReconnecting();
    this.cb.onLog("info", `reconnect in ${delay}ms`);
    this.reconnectTimer = setTimeout(() => this.open(), delay);
  }
}
