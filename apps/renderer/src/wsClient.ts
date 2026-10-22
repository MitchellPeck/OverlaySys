import {
  ServerMessageSchema,
  encode,
  type ClientMessage,
  type ServerMessage,
} from "@overlaysys/ws-protocol";

type Listener = (msg: ServerMessage) => void;
type Status = "connecting" | "open" | "closed";
type StatusListener = (status: Status) => void;

export class WsClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private statusListeners = new Set<StatusListener>();
  private status: Status = "connecting";
  private retry = 0;
  private closedByUser = false;
  private url: string;

  constructor(url: string) {
    this.url = url;
  }

  connect(): void {
    this.closedByUser = false;
    if (this.ws) {
      const rs = this.ws.readyState;
      if (rs === WebSocket.OPEN) {
        this.notifyStatus("open");
        return;
      }
      if (rs === WebSocket.CONNECTING) {
        this.notifyStatus("connecting");
        return;
      }
    }
    this.openSocket();
  }

  private openSocket(): void {
    this.notifyStatus("connecting");
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.addEventListener("open", () => {
      if (this.ws !== ws) return;
      this.retry = 0;
      this.notifyStatus("open");
    });
    ws.addEventListener("message", (ev) => {
      if (this.ws !== ws) return;
      try {
        const msg = ServerMessageSchema.parse(JSON.parse(ev.data));
        for (const l of this.listeners) l(msg);
      } catch (e) {
        console.warn("[ws] failed to decode", e);
      }
    });
    ws.addEventListener("close", () => {
      if (this.ws !== ws) return;
      this.notifyStatus("closed");
      if (!this.closedByUser) this.scheduleReconnect();
    });
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(encode(msg));
    }
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  close(): void {
    this.closedByUser = true;
    this.ws?.close();
  }

  private notifyStatus(s: Status): void {
    this.status = s;
    for (const l of this.statusListeners) l(s);
  }

  private scheduleReconnect(): void {
    this.retry = Math.min(this.retry + 1, 6);
    const delay = Math.min(1000 * 2 ** this.retry, 10_000);
    setTimeout(() => {
      if (!this.closedByUser) this.openSocket();
    }, delay);
  }
}

export interface ServerUrlLocation {
  search: string;
  protocol: string;
  host: string;
  hostname: string;
  pathname: string;
}

/**
 * Pick the WS URL: an explicit `?server=` wins; when served by the OverlaySys
 * server itself (under /renderer) connect back to the same origin so it works
 * from other LAN devices on whatever port was actually bound; otherwise (Vite
 * dev) assume the server is on :4000 of the same hostname.
 */
export function resolveServerUrl(loc: ServerUrlLocation): string {
  const override = new URLSearchParams(loc.search).get("server");
  if (override) return override;
  if (loc.pathname === "/renderer" || loc.pathname.startsWith("/renderer/")) {
    return `${loc.protocol === "https:" ? "wss" : "ws"}://${loc.host}/ws`;
  }
  return `ws://${loc.hostname}:4000/ws`;
}

export function defaultServerUrl(): string {
  return resolveServerUrl(location);
}
