"use client";

import type { ScriptureSettings } from "@overlaysys/core";
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
  /** Registered API.Bible translations (absent on older servers). */
  translations?: { id: string; bibleId: string; abbreviation: string; name: string }[];
  /** "default" = NIV only; "custom" = picked on the settings page. */
  selection?: "default" | "custom";
}

export interface ApiBibleSummary {
  bibleId: string;
  abbreviation: string;
  name: string;
  language: string;
  languageName?: string;
}

/** Every Bible the configured key licenses. */
export async function listApiBibles(): Promise<ApiBibleSummary[]> {
  const r = await fetch(`${httpBase()}/api/scripture/api-bible/bibles`);
  const body = (await r.json().catch(() => ({}))) as { bibles?: ApiBibleSummary[]; message?: string };
  if (!r.ok) throw new Error(body.message ?? `api-bible bibles: ${r.status}`);
  return body.bibles ?? [];
}

/** Replace the registered API.Bible translations with these Bibles. */
export async function saveApiBibleTranslations(bibleIds: string[]): Promise<ApiBibleStatus> {
  const r = await fetch(`${httpBase()}/api/scripture/api-bible/translations`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ bibleIds }),
  });
  const body = (await r.json().catch(() => ({}))) as ApiBibleStatus & { message?: string };
  if (!r.ok) throw new Error(body.message ?? `api-bible translations: ${r.status}`);
  return body;
}

/** Translations plus the install-wide default (listed first by the server). */
export async function getTranslationsWithDefault(): Promise<{
  translations: TranslationMeta[];
  defaultTranslation: string | null;
  storedDefault: string | null;
}> {
  const r = await fetch(`${httpBase()}/api/scripture/translations`);
  if (!r.ok) throw new Error(`translations: ${r.status}`);
  const body = (await r.json()) as {
    translations: TranslationMeta[];
    defaultTranslation?: string | null;
    storedDefault?: string | null;
  };
  return {
    translations: body.translations,
    defaultTranslation: body.defaultTranslation ?? null,
    storedDefault: body.storedDefault ?? null,
  };
}

export async function putDefaultTranslation(id: string | null): Promise<void> {
  const r = await fetch(`${httpBase()}/api/scripture/default-translation`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ defaultTranslation: id }),
  });
  if (!r.ok) {
    const body = (await r.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `default translation: ${r.status}`);
  }
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

export async function getScriptureSettings(): Promise<ScriptureSettings> {
  const r = await fetch(`${httpBase()}/api/scripture/settings`);
  if (!r.ok) throw new Error(`scripture settings: ${r.status}`);
  return r.json();
}

export async function putScriptureSettings(settings: ScriptureSettings): Promise<ScriptureSettings> {
  const r = await fetch(`${httpBase()}/api/scripture/settings`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(settings),
  });
  if (!r.ok) throw new Error(`scripture settings save: ${r.status}`);
  return r.json();
}
