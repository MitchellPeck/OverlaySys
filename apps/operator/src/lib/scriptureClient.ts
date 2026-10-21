"use client";

import type { TranslationMeta, ScriptureVerse } from "@overlaysys/scripture";
import { defaultServerUrl } from "./wsClient";

/**
 * Derive the HTTP base from the WS URL the operator is already using.
 * `ws://host:port/...` → `http://host:port`, `wss://...` → `https://...`.
 */
function httpBase(): string {
  const ws = defaultServerUrl();
  try {
    const u = new URL(ws);
    const proto = u.protocol === "wss:" ? "https:" : "http:";
    return `${proto}//${u.host}`;
  } catch {
    return typeof window !== "undefined" ? window.location.origin : "";
  }
}

export interface PassageResponse {
  reference: string;
  translation: string;
  verses: ScriptureVerse[];
  attribution: string;
  source?: PassageSource;
}

export interface ScriptureError {
  code: "parse_error" | "unknown_translation" | "out_of_range" | string;
  message: string;
  hint: string;
  position?: number | null;
}

export async function listTranslations(): Promise<TranslationMeta[]> {
  const r = await fetch(`${httpBase()}/api/scripture/translations`);
  if (!r.ok) throw new Error(`translations: ${r.status}`);
  const body = (await r.json()) as { translations: TranslationMeta[] };
  return body.translations;
}

export async function fetchPassage(
  ref: string,
  translation: string,
): Promise<PassageResponse> {
  const url = `${httpBase()}/api/scripture/passage?ref=${encodeURIComponent(ref)}&translation=${encodeURIComponent(translation)}`;
  const r = await fetch(url);
  if (!r.ok) {
    const err = (await r.json()) as ScriptureError;
    throw Object.assign(new Error(err.message), err);
  }
  return r.json();
}

export interface PassageSource {
  provider: "api.bible";
  bibleId: string;
  fetchedAt: string;
  usageTokens: string[];
}

export type ApiBibleState = "ok" | "no_key" | "rejected" | "no_niv" | "offline";

export interface ApiBibleStatus {
  configured: boolean;
  source: "env" | "file" | null;
  state: ApiBibleState;
  bibleId?: string;
  message?: string;
}

export async function getApiBibleStatus(): Promise<ApiBibleStatus> {
  const r = await fetch(`${httpBase()}/api/scripture/api-bible`);
  if (!r.ok) throw new Error(`api-bible status: ${r.status}`);
  return r.json();
}

/** Resolves with the server's status for 200/400/409 so the panel can show why. */
export async function saveApiBibleKey(apiKey: string): Promise<ApiBibleStatus> {
  const r = await fetch(`${httpBase()}/api/scripture/api-bible`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ apiKey }),
  });
  if (r.ok || r.status === 400 || r.status === 409) return r.json();
  throw new Error(`api-bible save: ${r.status}`);
}

export async function removeApiBibleKey(): Promise<ApiBibleStatus> {
  const r = await fetch(`${httpBase()}/api/scripture/api-bible`, { method: "DELETE" });
  if (r.ok || r.status === 409) return r.json();
  throw new Error(`api-bible remove: ${r.status}`);
}

/** API.Bible usage reporting (FUMS) — fire-and-forget, never blocks a take. */
export function reportScriptureUsage(tokens: string[]): void {
  if (tokens.length === 0) return;
  void fetch(`${httpBase()}/api/scripture/usage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tokens }),
  }).catch(() => undefined);
}
