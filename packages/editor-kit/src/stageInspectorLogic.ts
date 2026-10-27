import type { StageRect, StageTimerSource, StageWidget, StageWidgetStyle } from "@overlaysys/core";
import { MIN_WIDGET_SIZE } from "./stageGeometry";

/**
 * Partial update for one widget. `rect` / `style` / `props` are shallow-merged
 * into the widget; a key whose value is `undefined` is removed (e.g.
 * `style: { background: undefined }` clears the background).
 */
export type StageWidgetPatch = {
  rect?: Partial<StageRect>;
  style?: { [K in keyof StageWidgetStyle]?: StageWidgetStyle[K] | undefined };
  /** Partial props of some widget kind; the caller patches a widget of that kind. */
  props?: StageWidgetPropsPatch;
};

/** Partial props of any one widget kind (distributes over the kinds, so unknown keys are rejected). */
export type StageWidgetPropsPatch = Partial<StageWidget["props"]>;

function mergeDefined<T extends object>(base: T, patch: object | undefined): T {
  if (!patch) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete out[k];
    else out[k] = v;
  }
  return out as T;
}

export function clampRectPatch(r: Partial<StageRect>): Partial<StageRect> {
  const out = { ...r };
  if (out.w !== undefined) out.w = Math.max(MIN_WIDGET_SIZE, out.w);
  if (out.h !== undefined) out.h = Math.max(MIN_WIDGET_SIZE, out.h);
  return out;
}

/** Pure merge of a patch into a widget. Rect w/h are clamped to the minimum size. */
export function applyStageWidgetPatch(w: StageWidget, patch: StageWidgetPatch): StageWidget {
  return {
    ...w,
    rect: patch.rect ? mergeDefined(w.rect, clampRectPatch(patch.rect)) : w.rect,
    style: mergeDefined(w.style, patch.style),
    props: mergeDefined(w.props, patch.props),
  } as StageWidget;
}

export type TimerSourceOption = { value: string; label: string };

/** Encode a timer source as a <select> value. */
export function encodeTimerSource(s: StageTimerSource): string {
  if (s === "firstActive" || s === "currentItem") return s;
  if ("channel" in s) return `channel:${s.channel}`;
  return `timer:${s.timerId}`;
}

/** Decode a <select> value back into a timer source. */
export function decodeTimerSource(v: string): StageTimerSource {
  if (v === "currentItem") return "currentItem";
  if (v.startsWith("channel:")) return { channel: v.slice("channel:".length) };
  if (v.startsWith("timer:")) return { timerId: v.slice("timer:".length) };
  return "firstActive";
}

/**
 * Select options for a timer source. A stored source that isn't in the
 * channel / timer lists is appended (flagged as missing) so it isn't silently lost.
 */
export function timerSourceOptions(
  current: StageTimerSource,
  channelChoices: { id: string; name: string }[],
  timerChoices: { id: string; label: string }[],
): TimerSourceOption[] {
  const opts: TimerSourceOption[] = [
    { value: "firstActive", label: "First active" },
    { value: "currentItem", label: "Current item" },
    ...channelChoices.map((c) => ({ value: `channel:${c.id}`, label: `Channel: ${c.name}` })),
    ...timerChoices.map((t) => ({ value: `timer:${t.id}`, label: `Timer: ${t.label}` })),
  ];
  const cur = encodeTimerSource(current);
  if (!opts.some((o) => o.value === cur)) {
    // Timer ids are runtime-only (gone after a restart); the widget then shows
    // the first active timer, so say that rather than print a raw id.
    const label =
      typeof current === "string"
        ? `(missing) ${current}`
        : "channel" in current
          ? `(missing) Channel: ${current.channel}`
          : "Missing timer (falls back to first active)";
    opts.push({ value: cur, label });
  }
  return opts;
}

/** Move item `id` to array index `to` (clamped). */
export function moveInOrder<T extends { id: string }>(items: T[], id: string, to: number): T[] {
  const from = items.findIndex((i) => i.id === id);
  if (from < 0) return items;
  const clamped = Math.max(0, Math.min(items.length - 1, to));
  const out = items.slice();
  const [it] = out.splice(from, 1);
  out.splice(clamped, 0, it!);
  return out;
}

export type NumberBounds = { min?: number; max?: number; int?: boolean; step?: number };

/**
 * Parse and clamp a typed number draft. Returns null when the text isn't a
 * finite number (caller reverts to the committed value).
 */
export function parseNumberDraft(text: string, b: NumberBounds = {}): number | null {
  if (text.trim() === "") return null;
  let n = Number(text);
  if (!Number.isFinite(n)) return null;
  if (b.step) n = Math.round(n / b.step) * b.step;
  else if (b.int) n = Math.round(n);
  if (b.min !== undefined) n = Math.max(b.min, n);
  if (b.max !== undefined) n = Math.min(b.max, n);
  return n;
}
