import type { QueuedScripture, ScriptureRow, ScriptureSessionSummary } from "@overlaysys/core";
import { scriptureSlideData } from "@overlaysys/scripture";
import * as channels from "./channels";
import { reportViews } from "./apiBible/fums";

// Scripture equivalent of songSession: an intro queues its row on the channel;
// the next slide command (Next / go to slide) starts it. Channel state carries
// `scriptureSession` / `queuedScripture` so the operator and Companion agree.

interface Live {
  showId: string;
  row: ScriptureRow;
  slideIdx: number;
}
interface Queued {
  showId: string;
  row: ScriptureRow;
}

const live = new Map<string, Live>();
const queued = new Map<string, Queued>();

export function getLive(ch: string): Live | undefined {
  return live.get(ch);
}

export function getQueued(ch: string): Queued | undefined {
  return queued.get(ch);
}

export function dropLive(ch: string): boolean {
  return live.delete(ch);
}

export function dropQueued(ch: string): boolean {
  return queued.delete(ch);
}

export function dropAll(ch: string): void {
  live.delete(ch);
  queued.delete(ch);
}

export function resetAll(): void {
  live.clear();
  queued.clear();
}

const queuedSummary = (row: ScriptureRow): QueuedScripture => ({ rowId: row.id, reference: row.reference });

export function takeIntro(
  ch: string,
  showId: string,
  row: ScriptureRow,
  intro: { templateId: string; fieldValues: Record<string, string> },
): void {
  channels.take(ch, intro.templateId, intro.fieldValues, undefined, {
    context: { rowId: row.id, sub: "intro" },
    queued: queuedSummary(row),
  }, { showId, rowId: row.id });
  // Set AFTER take returns: take() drops every scripture map for the channel.
  queued.set(ch, { showId, row });
}

export function takeSlide(ch: string, showId: string, row: ScriptureRow, slideIdx: number): boolean {
  if (!Number.isInteger(slideIdx) || slideIdx < 0 || slideIdx >= row.slides.length) return false;
  const data = scriptureSlideData(row, slideIdx);
  const session: ScriptureSessionSummary = {
    rowId: row.id,
    reference: row.reference,
    slideIdx,
    slideCount: row.slides.length,
    slideReference: data.reference,
    text: data.text,
  };
  channels.take(ch, row.templateId, data, undefined, {
    context: { rowId: row.id, sub: "slide", slideIdx },
    session,
  }, { showId, rowId: row.id });
  live.set(ch, { showId, row, slideIdx });
  if (row.source?.provider === "api.bible") void reportViews(row.source.usageTokens);
  return true;
}

export function advance(ch: string, delta: -1 | 1): void {
  const l = live.get(ch);
  if (l) {
    takeSlide(ch, l.showId, l.row, l.slideIdx + delta);
    return;
  }
  const q = queued.get(ch);
  if (q && delta > 0) takeSlide(ch, q.showId, q.row, 0);
}

export function goTo(ch: string, slideIdx: number): void {
  const l = live.get(ch);
  if (l) {
    takeSlide(ch, l.showId, l.row, slideIdx);
    return;
  }
  const q = queued.get(ch);
  if (q) takeSlide(ch, q.showId, q.row, slideIdx);
}

export function end(ch: string): void {
  if (live.has(ch)) {
    channels.clear(ch);
    return;
  }
  if (queued.delete(ch)) channels.setQueuedScripture(ch, null);
}

/** Move a queue between channels without emitting (PVW→PGM of an intro). */
export function moveQueued(from: string, to: string): QueuedScripture | null {
  const entry = queued.get(from);
  queued.delete(to);
  if (!entry) return null;
  queued.delete(from);
  queued.set(to, entry);
  return queuedSummary(entry.row);
}
