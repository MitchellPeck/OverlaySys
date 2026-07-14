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
