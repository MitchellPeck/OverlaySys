// LAN control-surface protection.
//
// The server binds 0.0.0.0 so renderers, Companion and operator laptops on
// the LAN can reach it. Before this, any web page open in any browser on
// the LAN (or on this machine) could drive it — a cross-site page can open
// a WebSocket to ws://<host>:4000 or POST to the HTTP API, and nothing
// checked. The rules here:
//
//   1. Origin allow-list (WebSocket upgrades and HTTP). Browsers always
//      send Origin on cross-origin requests and WS upgrades, so a page from
//      elsewhere is refused. Allowed: loopback hosts on any port, this
//      machine's own LAN addresses / hostname on any port, and anything in
//      OVERLAYSYS_ALLOWED_ORIGINS. No Origin header = a non-browser client
//      (Companion, OBS, curl, the desktop host) and is allowed.
//   2. Optional LAN token (OVERLAYSYS_TOKEN, or `token` in
//      data/security/config.json). Off unless set. When on, connections
//      from other machines must present it as `?token=`, `Authorization:
//      Bearer`, or the `overlaysys_token` cookie (set the first time a page
//      is opened with `?token=`, so browsers keep working after navigation).
//      Connections from this machine never need it.
//   3. Machine-admin operations (cloud/PCO credentials, STT binary install,
//      model downloads, STT shell config) are refused unless the connection
//      comes from this machine.

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import { lanAddresses } from "./networkInfo";
import { dataRoot } from "./storage";

export const TOKEN_COOKIE = "overlaysys_token";

export interface SecurityContext {
  /** LAN token; null = token checks off. */
  token: string | null;
  /** This machine's non-loopback addresses (refreshed periodically). */
  ownAddresses: string[];
  /** This machine's hostnames (`studio-mac`, `studio-mac.local`). */
  ownHostnames: string[];
  /** Extra allowed origins, exact `scheme://host[:port]` strings. */
  extraOrigins: string[];
}

export interface RequestLike {
  url?: string | undefined;
  headers: IncomingHttpHeaders;
  remoteAddress?: string | undefined;
}

export type CheckResult =
  | { ok: true; local: boolean; authorized: boolean; tokenFromQuery: boolean }
  | { ok: false; status: 401 | 403; reason: string };

function stripV4Mapped(addr: string): string {
  return addr.startsWith("::ffff:") ? addr.slice(7) : addr;
}

export function isLoopbackAddress(addr: string | undefined): boolean {
  if (!addr) return false;
  const a = stripV4Mapped(addr.trim().toLowerCase());
  return a === "::1" || a.startsWith("127.") || a === "localhost";
}

/** True when the peer is this machine (loopback or one of our own addresses). */
export function isLocalAddress(addr: string | undefined, ownAddresses: string[]): boolean {
  if (!addr) return false;
  if (isLoopbackAddress(addr)) return true;
  return ownAddresses.includes(stripV4Mapped(addr));
}

function isLoopbackHostname(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, "").toLowerCase();
  return h === "localhost" || h.endsWith(".localhost") || isLoopbackAddress(h);
}

export function originAllowed(origin: string | undefined, ctx: SecurityContext): boolean {
  // Non-browser clients (Companion, OBS's own fetches, curl, the Electron
  // main process) don't send Origin.
  if (origin === undefined || origin === "") return true;
  if (ctx.extraOrigins.includes(origin)) return true;
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    return false; // includes the opaque "null" origin (file://, sandboxed frames)
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  if (isLoopbackHostname(host)) return true;
  if (ctx.ownAddresses.includes(host)) return true;
  return ctx.ownHostnames.includes(host);
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** The token a request presents, and whether it came from the query string. */
export function presentedToken(req: RequestLike): { token: string | null; fromQuery: boolean } {
  if (req.url) {
    const q = req.url.indexOf("?");
    if (q >= 0) {
      const t = new URLSearchParams(req.url.slice(q + 1)).get("token");
      if (t) return { token: t, fromQuery: true };
    }
  }
  const auth = req.headers["authorization"];
  if (typeof auth === "string") {
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (m) return { token: m[1]!.trim(), fromQuery: false };
  }
  return { token: readCookie(req.headers["cookie"], TOKEN_COOKIE), fromQuery: false };
}

export function tokenMatches(expected: string, given: string | null): boolean {
  if (!given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Gate one HTTP request or WS upgrade. `ok` carries whether the peer is this
 * machine and whether it is authorized (local, token off, or token valid).
 */
export function checkRequest(req: RequestLike, ctx: SecurityContext): CheckResult {
  const origin = req.headers["origin"];
  if (!originAllowed(typeof origin === "string" ? origin : undefined, ctx)) {
    return { ok: false, status: 403, reason: `origin not allowed: ${String(origin)}` };
  }
  const local = isLocalAddress(req.remoteAddress, ctx.ownAddresses);
  const { token, fromQuery } = presentedToken(req);
  if (ctx.token === null || local) {
    return { ok: true, local, authorized: true, tokenFromQuery: false };
  }
  if (!tokenMatches(ctx.token, token)) {
    return { ok: false, status: 401, reason: "missing or invalid token" };
  }
  return { ok: true, local, authorized: true, tokenFromQuery: fromQuery };
}

// ── Runtime context ────────────────────────────────────────────────────────

const ADDRESS_TTL_MS = 30_000;
let cachedAddresses: { at: number; list: string[] } | null = null;
let configuredToken: string | null = null;

function ownAddresses(): string[] {
  const now = Date.now();
  if (!cachedAddresses || now - cachedAddresses.at > ADDRESS_TTL_MS) {
    let list: string[] = [];
    try {
      list = lanAddresses(os.networkInterfaces());
    } catch {
      list = [];
    }
    cachedAddresses = { at: now, list };
  }
  return cachedAddresses.list;
}

function ownHostnames(): string[] {
  const h = os.hostname().toLowerCase();
  const base = h.replace(/\.local$/, "");
  return [...new Set([h, base, `${base}.local`])];
}

function parseList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter((s) => s.length > 0);
}

export function securityContext(env: NodeJS.ProcessEnv = process.env): SecurityContext {
  const envToken = env["OVERLAYSYS_TOKEN"]?.trim();
  return {
    token: envToken ? envToken : configuredToken,
    ownAddresses: ownAddresses(),
    ownHostnames: ownHostnames(),
    extraOrigins: parseList(env["OVERLAYSYS_ALLOWED_ORIGINS"]),
  };
}

/** Reads `token` from data/security/config.json (env OVERLAYSYS_TOKEN wins). */
export async function loadSecuritySettings(): Promise<void> {
  try {
    const raw = await fs.readFile(path.join(dataRoot(), "security", "config.json"), "utf8");
    const obj = JSON.parse(raw) as { token?: unknown };
    configuredToken = typeof obj.token === "string" && obj.token.trim() ? obj.token.trim() : null;
  } catch {
    configuredToken = null;
  }
}

/** True when a LAN token is configured (env or file). */
export function tokenEnabled(): boolean {
  return securityContext().token !== null;
}

/** Peer of a raw Node request (WS upgrade or Fastify's req.raw). */
export function remoteAddressOf(req: { socket?: { remoteAddress?: string | undefined } | undefined }): string | undefined {
  return req.socket?.remoteAddress;
}

// ── STT model downloads ────────────────────────────────────────────────────

const MODEL_HOSTS = ["huggingface.co", "hf.co", "github.com", "githubusercontent.com"];

/**
 * Model downloads write a file to disk from a client-supplied URL. Only
 * HTTPS from the known model hosts (and their subdomains) is accepted;
 * OVERLAYSYS_STT_MODEL_HOSTS adds more.
 */
export function isAllowedModelUrl(raw: string, env: NodeJS.ProcessEnv = process.env): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  if (u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  const allowed = [...MODEL_HOSTS, ...parseList(env["OVERLAYSYS_STT_MODEL_HOSTS"]).map((h) => h.toLowerCase())];
  return allowed.some((h) => host === h || host.endsWith(`.${h}`));
}
