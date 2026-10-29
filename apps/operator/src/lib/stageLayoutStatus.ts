"use client";

import { useSyncExternalStore } from "react";
import type { StageLayoutReason, StageLayoutStatus } from "@overlaysys/core";
import type { ClientMessage, ServerMessage } from "@overlaysys/ws-protocol";

const EMPTY: StageLayoutStatus[] = [];
let cache: StageLayoutStatus[] = EMPTY;
const listeners = new Set<() => void>();
let attachedTo: unknown = null;

type Feedable = { on(l: (m: ServerMessage) => void): () => void };

/** Feeds the module cache from `stage_layout_status`; idempotent per client. */
export function attachStageLayoutStatusFeed(client: Feedable): void {
  if (attachedTo === client) return;
  attachedTo = client;
  client.on((msg) => {
    if (msg.type !== "stage_layout_status") return;
    cache = msg.screens as StageLayoutStatus[];
    listeners.forEach((l) => l());
  });
}

export function getStageLayoutStatuses(): StageLayoutStatus[] {
  return cache;
}

export function subscribeStageLayoutStatus(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** Forget the last status (disconnect/reconnect); the server sends a fresh one on connect. */
export function resetStageLayoutStatus(): void {
  if (cache === EMPTY) return;
  cache = EMPTY;
  listeners.forEach((l) => l());
}

export function resetStageLayoutStatusForTests(): void {
  cache = EMPTY;
  attachedTo = null;
  listeners.clear();
}

/** Latest per-screen layout status; the feed is attached at WS bootstrap (useWs.ts). */
export function useStageLayoutStatus(): StageLayoutStatus[] {
  return useSyncExternalStore(subscribeStageLayoutStatus, getStageLayoutStatuses, () => EMPTY);
}

export function reasonLabel(reason: StageLayoutReason): string {
  if (reason === "manual") return "Manual";
  if (reason === "item") return "This item";
  if (reason === "default") return "Default";
  return `Rule: ${reason.slice("rule:".length)}`;
}

export function setStageLayoutMessage(channel: string, layoutId: string | null): ClientMessage {
  return { type: "set_stage_layout", channel, layoutId };
}
