"use client";

import type {
  ItemPreview,
  PcoPlan,
  PcoPlanItem,
  PcoServiceType,
  Song,
} from "@overlaysys/core";
import { defaultServerUrl } from "./wsClient";

/**
 * Operator-side client for the embedded server's Planning Center routes.
 * Derives the HTTP base from the WS URL (like scriptureClient), so it talks to
 * the same local server that owns the in-memory PCO token.
 */
export function httpBase(): string {
  const ws = defaultServerUrl();
  try {
    const u = new URL(ws);
    const proto = u.protocol === "wss:" ? "https:" : "http:";
    return `${proto}//${u.host}`;
  } catch {
    return typeof window !== "undefined" ? window.location.origin : "";
  }
}

export class PcoNotConnectedError extends Error {
  constructor(message = "Not connected to Planning Center.") {
    super(message);
    this.name = "PcoNotConnectedError";
  }
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${httpBase()}${path}`);
  if (res.status === 401) throw new PcoNotConnectedError();
  if (!res.ok) throw new Error(`PCO request failed (${res.status})`);
  return (await res.json()) as T;
}

export interface ImportTarget {
  mode: "new" | "existing";
  showId?: string;
  name?: string;
  projectId?: string;
}

export interface ImportItemConfig {
  itemId: string;
  kind: "song" | "graphic" | "scripture";
  songAction?: "link" | "create";
  songId?: string;
  song?: Song;
  templateId?: string;
  data?: Record<string, string>;
  notes?: string;
  /** Scripture kind. */
  reference?: string;
  translation?: string;
  slideMaxChars?: number;
}

export interface ImportPlanRequest {
  serviceTypeId: string;
  planId: string;
  planTitle?: string;
  /** PCO plan `sort_date`; the server dates the show from it. */
  planDate?: string;
  target: ImportTarget;
  items: ImportItemConfig[];
  defaultLyricTemplateId?: string;
  defaultGraphicTemplateId?: string;
  /** Existing-show target: move this plan's rows into plan order. */
  reorderToPlan?: boolean;
}

export interface ImportPlanResult {
  ok: boolean;
  showId?: string;
  counts: { rows: number; songsCreated: number; songsLinked: number; songsUpdated: number };
  /** Rows from this plan whose PCO item has been removed (left in the show). Absent on older servers. */
  removedRows?: { rowId: string; itemId: string; label?: string }[];
  reordered?: boolean;
  warnings: string[];
  errors: { itemId: string; message: string }[];
}

export async function getPcoStatus(): Promise<{ connected: boolean }> {
  return get<{ connected: boolean }>("/api/pco/status");
}

/**
 * Supply a Planning Center credential directly — either an OAuth access token
 * or a Personal Access Token (App ID + Secret). Posts to the same endpoint the
 * desktop OAuth flow uses, so the server stores it in memory identically.
 */
export async function setPcoCredentials(
  input: { accessToken: string } | { appId: string; secret: string },
): Promise<void> {
  const res = await fetch(`${httpBase()}/api/pco/tokens`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Failed to set token (${res.status})`);
  }
}

/** Forget the in-memory Planning Center credential (PAT or OAuth) on the server. */
export async function clearPcoCredentials(): Promise<void> {
  const res = await fetch(`${httpBase()}/api/pco/tokens`, { method: "DELETE" });
  if (!res.ok) throw new Error(`Failed to disconnect (${res.status})`);
}

export async function listServiceTypes(): Promise<PcoServiceType[]> {
  const { serviceTypes } = await get<{ serviceTypes: PcoServiceType[] }>(
    "/api/pco/service-types",
  );
  return serviceTypes;
}

export async function listPlans(serviceTypeId: string): Promise<PcoPlan[]> {
  const { plans } = await get<{ plans: PcoPlan[] }>(
    `/api/pco/plans?serviceTypeId=${encodeURIComponent(serviceTypeId)}`,
  );
  return plans;
}

export async function getPlanItems(
  serviceTypeId: string,
  planId: string,
): Promise<{
  items: PcoPlanItem[];
  previews: ItemPreview[];
  /** itemId → shows already holding a row imported from that item. Absent on older servers. */
  imported?: Record<string, { showId: string; showName: string }[]>;
}> {
  return get(
    `/api/pco/plans/${encodeURIComponent(planId)}/items?serviceTypeId=${encodeURIComponent(serviceTypeId)}`,
  );
}

export async function importPlan(req: ImportPlanRequest): Promise<ImportPlanResult> {
  const res = await fetch(`${httpBase()}/api/pco/import`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
  });
  if (res.status === 401) throw new PcoNotConnectedError();
  if (!res.ok) throw new Error(`PCO import failed (${res.status})`);
  return (await res.json()) as ImportPlanResult;
}
