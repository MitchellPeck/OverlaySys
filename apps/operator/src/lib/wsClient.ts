"use client";

import {
  ServerMessageSchema,
  encode,
  type ClientMessage,
  type ServerMessage,
} from "@overlaysys/ws-protocol";

type Listener = (msg: ServerMessage) => void;
type Status = "connecting" | "open" | "closed";
type StatusListener = (status: Status) => void;

/**
 * A reconnecting WebSocket client. Lives as a module-scoped singleton so it
 * persists across client-side route changes. `connect()` is idempotent —
 * calling it on an already-OPEN/CONNECTING socket is a no-op (and re-emits
 * the current status to any listeners that just attached).
 *
 * Each underlying WebSocket only fires its close handler if it's still the
 * current `this.ws`; orphaned sockets (replaced by a reconnect) are ignored.
 */
export class WsClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private statusListeners = new Set<StatusListener>();
  private status: Status = "connecting";
  private retry = 0;
  private closedByUser = false;
  private url: string;
  private keepalive: ReturnType<typeof setInterval> | null = null;

  constructor(url: string) {
    this.url = url;
  }

  getUrl(): string {
    return this.url;
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

  private openSocket(): void {
    this.notifyStatus("connecting");
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.addEventListener("open", () => {
      if (this.ws !== ws) return; // orphaned
      this.retry = 0;
      this.notifyStatus("open");
      // Application-level keepalive. The browser doesn't ping idle WS
      // connections, and during a bulk import the WS sits cold while
      // HTTP asset uploads run for tens of seconds. Without traffic,
      // some network paths (Electron NAT, certain proxies) GC the
      // connection — sends afterwards succeed locally but the server
      // never sees them. A ping every 20s keeps the path warm.
      if (this.keepalive) clearInterval(this.keepalive);
      this.keepalive = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          try {
            this.ws.send(encode({ type: "ping", t: Date.now() }));
          } catch {
            // ws.send can throw if the socket was just closed; let the
            // close handler trigger reconnect.
          }
        }
      }, 20_000);
    });
    ws.addEventListener("message", (ev) => {
      if (this.ws !== ws) return;
      try {
        const msg = ServerMessageSchema.parse(JSON.parse(ev.data));
        for (const l of this.listeners) l(msg);
      } catch (e) {
        console.warn("[ws] decode failed", e);
      }
    });
    ws.addEventListener("close", () => {
      if (this.ws !== ws) return; // orphaned socket closing — ignore
      if (this.keepalive) {
        clearInterval(this.keepalive);
        this.keepalive = null;
      }
      this.notifyStatus("closed");
      if (!this.closedByUser) this.scheduleReconnect();
    });
    ws.addEventListener("error", () => {
      // Errors are typically followed by a close; reconnect logic handles it.
    });
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(encode(msg));
    }
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
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

const SERVER_STORAGE_KEY = "overlaysys:server-url";

export function defaultServerUrl(): string {
  if (typeof window === "undefined") return "ws://localhost:4000/ws";
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
