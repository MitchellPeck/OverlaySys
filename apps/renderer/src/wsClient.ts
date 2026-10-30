import {
  PROTOCOL_VERSION,
  ServerMessageSchema,
  encode,
  protocolMismatch,
  type ClientMessage,
  type ServerMessage,
} from "@overlaysys/ws-protocol";

type Listener = (msg: ServerMessage) => void;
type Status = "connecting" | "open" | "closed";
type StatusListener = (status: Status) => void;

/** Protocol ping cadence, and how long without any traffic before the socket is presumed dead. */
export const PING_INTERVAL_MS = 5_000;
export const DEAD_AFTER_MS = 10_000;
const RECONNECT_DELAYS_MS = [250, 500, 1000, 2000, 4000, 8000, 10_000];

/** Delay before reconnect attempt `attempt` (0-based): 250 ms first, backing off to 10 s. */
export function reconnectDelay(attempt: number): number {
  return RECONNECT_DELAYS_MS[Math.min(Math.max(0, attempt), RECONNECT_DELAYS_MS.length - 1)]!;
}

/**
 * Heartbeat tick: ping, or give up on the socket. Browsers don't surface a
 * half-open TCP connection (server rebooted, Wi-Fi dropped) for minutes; an
 * output would sit "open" painting a frozen frame. Any inbound message counts
 * as life — the server answers ping immediately even when busy.
 */
export function heartbeatAction(now: number, lastInboundAt: number, deadAfterMs: number = DEAD_AFTER_MS): "ping" | "reconnect" {
  return now - lastInboundAt > deadAfterMs ? "reconnect" : "ping";
}

/**
 * Decode one server frame and hand it to every listener. A bad frame is a
 * decode failure; a throwing listener is its own failure and never keeps the
 * later listeners from seeing the message.
 */
export function dispatchServerMessage(raw: string, listeners: Iterable<Listener>): void {
  let msg: ServerMessage;
  try {
    msg = ServerMessageSchema.parse(JSON.parse(raw));
  } catch (e) {
    console.warn("[ws] failed to decode", e);
    return;
  }
  if (msg.type === "hello" && protocolMismatch(msg.protocolVersion)) {
    console.warn(
      `[ws] server protocol v${msg.protocolVersion}, renderer speaks v${PROTOCOL_VERSION} — update the older side`,
    );
  }
  for (const l of [...listeners]) {
    try {
      l(msg);
    } catch (e) {
      console.warn("[ws] listener failed", e);
    }
  }
}

export class WsClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private statusListeners = new Set<StatusListener>();
  private status: Status = "connecting";
  private retry = 0;
  private closedByUser = false;
  private url: string;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private lastInboundAt = 0;

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
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.notifyStatus("connecting");
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.addEventListener("open", () => {
      if (this.ws !== ws) return;
      this.retry = 0;
      this.lastInboundAt = Date.now();
      this.startHeartbeat();
      this.notifyStatus("open");
    });
    ws.addEventListener("message", (ev) => {
      if (this.ws !== ws) return;
      this.lastInboundAt = Date.now();
      dispatchServerMessage(ev.data, this.listeners);
    });
    ws.addEventListener("close", () => {
      if (this.ws !== ws) return;
      this.stopHeartbeat();
      this.notifyStatus("closed");
      if (!this.closedByUser) this.scheduleReconnect();
    });
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => {
      if (heartbeatAction(Date.now(), this.lastInboundAt) === "reconnect") {
        console.warn("[ws] no traffic from server for 10 s — reconnecting");
        this.reconnectNow();
        return;
      }
      this.send({ type: "ping", t: Date.now() });
    }, PING_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  /** Drop the current socket (dead or not) and dial again immediately. */
  reconnectNow(): void {
    if (this.closedByUser) return;
    const old = this.ws;
    this.ws = null;
    this.stopHeartbeat();
    if (old) {
      try {
        old.close();
      } catch {
        /* already closed */
      }
    }
    this.retry = 0;
    this.notifyStatus("closed");
    this.openSocket();
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(encode(msg));
      } catch {
        // Socket closing; the close handler reconnects.
      }
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
    this.stopHeartbeat();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.ws?.close();
  }

  private notifyStatus(s: Status): void {
    this.status = s;
    for (const l of this.statusListeners) l(s);
  }

  private scheduleReconnect(): void {
    const delay = reconnectDelay(this.retry);
    this.retry++;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
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
  const params = new URLSearchParams(loc.search);
  const override = params.get("server");
  let url: string;
  if (override) url = override;
  else if (loc.pathname === "/renderer" || loc.pathname.startsWith("/renderer/")) {
    url = `${loc.protocol === "https:" ? "wss" : "ws"}://${loc.host}/ws`;
  } else url = `ws://${loc.hostname}:4000/ws`;
  return withToken(url, params.get("token"));
}

/** Carry a LAN token (`?token=` on the page URL) onto the WS URL. */
export function withToken(url: string, token: string | null): string {
  if (!token || /[?&]token=/.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
}

export function defaultServerUrl(): string {
  return resolveServerUrl(location);
}
