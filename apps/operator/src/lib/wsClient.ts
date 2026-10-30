"use client";

import {
  PROTOCOL_VERSION,
  ServerMessageSchema,
  encode,
  protocolMismatch,
  type ClientMessage,
  type ServerMessage,
} from "@overlaysys/ws-protocol";

type Listener = (msg: ServerMessage) => void;
export type WsStatus = "connecting" | "open" | "closed";
type Status = WsStatus;
type StatusListener = (status: Status) => void;

/** Protocol ping cadence, and how long without any traffic before the socket is presumed dead. */
export const PING_INTERVAL_MS = 5_000;
export const DEAD_AFTER_MS = 10_000;
const RECONNECT_DELAYS_MS = [250, 500, 1000, 2000, 4000, 8000, 10_000];

/** Delay before reconnect attempt `attempt` (0-based): 250 ms first, backing off to 10 s. */
export function reconnectDelay(attempt: number): number {
  return RECONNECT_DELAYS_MS[Math.min(Math.max(0, attempt), RECONNECT_DELAYS_MS.length - 1)]!;
}

/** Heartbeat tick decision. Any inbound message counts as life. */
export function heartbeatAction(now: number, lastInboundAt: number, deadAfterMs: number = DEAD_AFTER_MS): "ping" | "reconnect" {
  return now - lastInboundAt > deadAfterMs ? "reconnect" : "ping";
}

/**
 * A reconnecting WebSocket client. Lives as a module-scoped singleton so it
 * persists across client-side route changes. `connect()` is idempotent —
 * calling it on an already-OPEN/CONNECTING socket is a no-op (and re-emits
 * the current status to any listeners that just attached).
 *
 * Each underlying WebSocket only fires its close handler if it's still the
 * current `this.ws`; orphaned sockets (replaced by a reconnect) are ignored.
 *
 * Liveness: a protocol ping every 5 s; if nothing at all has arrived from
 * the server for 10 s the socket is presumed dead (half-open TCP after a
 * server reboot or a Wi-Fi drop is invisible to the browser for minutes)
 * and replaced. Reconnects start at 250 ms and back off to 10 s.
 */
export class WsClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private statusListeners = new Set<StatusListener>();
  private sendListeners = new Set<(msg: ClientMessage) => void>();
  private status: Status = "connecting";
  private retry = 0;
  private closedByUser = false;
  private url: string;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private lastInboundAt = 0;
  private lastRttMs: number | null = null;

  constructor(url: string) {
    this.url = url;
  }

  getUrl(): string {
    return this.url;
  }

  /** Current connection status (also pushed through onStatus). */
  getStatus(): Status {
    return this.status;
  }

  /** Round-trip time of the last answered ping, in ms (null before the first). */
  getRttMs(): number | null {
    return this.lastRttMs;
  }

  /** When anything was last received from the server (ms epoch; 0 = never). */
  getLastInboundAt(): number {
    return this.lastInboundAt;
  }

  connect(): void {
    this.closedByUser = false;
    if (this.ws) {
      const rs = this.ws.readyState;
      if (rs === WebSocket.OPEN) {
        // Re-emit so any listener that attached after the socket opened
        // sees the current state without waiting for a status change.
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

  /**
   * Drop the current socket (alive or not) and dial again right away,
   * skipping any pending backoff. For a "Reconnect" button and for the
   * heartbeat when the server goes silent.
   */
  reconnectNow(): void {
    this.closedByUser = false;
    const old = this.ws;
    this.ws = null; // its close event is now ignored
    this.stopHeartbeat();
    if (old) {
      try {
        old.close();
      } catch {
        // already closed
      }
    }
    this.retry = 0;
    this.notifyStatus("closed");
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
      if (this.ws !== ws) return; // orphaned
      this.retry = 0;
      this.lastInboundAt = Date.now();
      this.startHeartbeat();
      this.notifyStatus("open");
    });
    ws.addEventListener("message", (ev) => {
      if (this.ws !== ws) return;
      this.lastInboundAt = Date.now();
      try {
        const msg = ServerMessageSchema.parse(JSON.parse(ev.data));
        if (msg.type === "pong") this.lastRttMs = Math.max(0, Date.now() - msg.t);
        if (msg.type === "hello" && protocolMismatch(msg.protocolVersion)) {
          console.warn(
            `[ws] server protocol v${msg.protocolVersion}, operator speaks v${PROTOCOL_VERSION} — update the older side`,
          );
        }
        for (const l of this.listeners) l(msg);
      } catch (e) {
        console.warn("[ws] decode failed", e);
      }
    });
    ws.addEventListener("close", () => {
      if (this.ws !== ws) return; // orphaned socket closing — ignore
      this.stopHeartbeat();
      this.notifyStatus("closed");
      if (!this.closedByUser) this.scheduleReconnect();
    });
    ws.addEventListener("error", () => {
      // Errors are typically followed by a close; reconnect logic handles it.
    });
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    // Also keeps idle paths warm: during a bulk import the WS sits cold while
    // HTTP uploads run, and some network paths (Electron NAT, proxies) GC an
    // idle connection.
    this.heartbeat = setInterval(() => {
      if (heartbeatAction(Date.now(), this.lastInboundAt) === "reconnect") {
        console.warn("[ws] no traffic from server for 10 s — reconnecting");
        this.reconnectNow();
        return;
      }
      if (this.ws?.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(encode({ type: "ping", t: Date.now() }));
        } catch {
          // ws.send can throw if the socket was just closed; let the
          // close handler trigger reconnect.
        }
      }
    }, PING_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  send(msg: ClientMessage): void {
    for (const l of this.sendListeners) l(msg);
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(encode(msg));
      return;
    }
    // Silently dropping the message would manifest as ghost UI: the user
    // clicks Install, optimistic state shows progress, but nothing ever
    // happens server-side because the socket was mid-reconnect. Log it so
    // the issue surfaces in the console.
    console.warn(
      `[ws] dropping ${msg.type} — socket ${
        this.ws ? readyStateLabel(this.ws.readyState) : "null"
      }`,
    );
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Hear every message this tab sends (before it goes out), e.g. to notice a take. */
  onSend(listener: (msg: ClientMessage) => void): () => void {
    this.sendListeners.add(listener);
    return () => {
      this.sendListeners.delete(listener);
    };
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    // Immediately push the current status so the new subscriber doesn't
    // wait for the next change.
    listener(this.status);
    return () => {
      this.statusListeners.delete(listener);
    };
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

function readyStateLabel(rs: number): string {
  switch (rs) {
    case WebSocket.CONNECTING:
      return "CONNECTING";
    case WebSocket.OPEN:
      return "OPEN";
    case WebSocket.CLOSING:
      return "CLOSING";
    case WebSocket.CLOSED:
      return "CLOSED";
    default:
      return `state=${rs}`;
  }
}

const SERVER_STORAGE_KEY = "overlaysys:server-url";

const TOKEN_STORAGE_KEY = "overlaysys:lan-token";

/**
 * LAN token (`?token=` on the operator URL, remembered for the tab). Only
 * needed when the server has OVERLAYSYS_TOKEN set and this browser is on
 * another machine; the server also sets a cookie, this covers dev setups
 * where the operator is served from a different host than the server.
 */
function lanToken(): string | null {
  const fromUrl = new URLSearchParams(location.search).get("token");
  try {
    if (fromUrl) sessionStorage.setItem(TOKEN_STORAGE_KEY, fromUrl);
    return fromUrl ?? sessionStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return fromUrl;
  }
}

export function withToken(url: string, token: string | null): string {
  if (!token || /[?&]token=/.test(url)) return url;
  return `${url}${url.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
}

export function defaultServerUrl(): string {
  if (typeof window === "undefined") return "ws://localhost:4000/ws";
  return withToken(baseServerUrl(), lanToken());
}

function baseServerUrl(): string {
  // Priority 1 — `?server=` URL override (Electron host injects this on
  // initial window load). Persist it so subsequent in-app navigations
  // (which strip the query string) and page refreshes still find the
  // right server, even when the server is on a dynamic ephemeral port.
  const override = new URLSearchParams(location.search).get("server");
  if (override) {
    try {
      sessionStorage.setItem(SERVER_STORAGE_KEY, override);
    } catch {
      // sessionStorage may throw in private mode / with strict CSP — fine,
      // we'll just rely on the URL param surviving instead.
    }
    return override;
  }
  // Priority 2 — sessionStorage from an earlier tab session.
  try {
    const stored = sessionStorage.getItem(SERVER_STORAGE_KEY);
    if (stored) return stored;
  } catch {
    // ignore
  }
  // Priority 3 — same-host fallback. Works for browser-source dev
  // (operator on :3000, server on :4000).
  return `ws://${location.hostname}:4000/ws`;
}
