import WebSocket from "ws";
import {
  decodeServer,
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
}

const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000];

export class Connection {
  private ws: WebSocket | null = null;
  private closed = false;
  private attempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;

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
    const url = `ws://${this.opts.host}:${this.opts.port}/ws`;
    this.cb.onLog("info", `connecting ${url}`);
    const ws = new WebSocket(url, { perMessageDeflate: false });
    this.ws = ws;

    ws.on("open", () => {
      this.attempt = 0;
      this.cb.onConnected();
    });

    ws.on("message", (raw) => {
      let msg: ServerMessage;
      try {
        msg = decodeServer(raw.toString());
      } catch (err) {
        this.cb.onLog("error", `decode failed: ${String(err)}`);
        return;
      }
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
      this.cb.onDisconnected();
      this.ws = null;
      if (!this.closed) this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    const delay = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)]!;
    this.attempt++;
    this.cb.onReconnecting();
    this.cb.onLog("info", `reconnect in ${delay}ms`);
    this.reconnectTimer = setTimeout(() => this.open(), delay);
  }
}
