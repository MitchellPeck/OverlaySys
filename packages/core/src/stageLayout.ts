import { z } from "zod";

/**
 * A confidence-monitor layout: a canvas of freely positioned widgets, each
 * bound to one slice of the server's StageFeed (see stageFeed.ts). Separate
 * from Template on purpose — stage widgets scroll, tick and highlight, and
 * have no in/out timelines.
 */

export const StageRectSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number().positive(),
  h: z.number().positive(),
});
export type StageRect = z.infer<typeof StageRectSchema>;

export const StageWidgetStyleSchema = z.object({
  fontFamily: z.string().default("Inter, system-ui, sans-serif"),
  fontSize: z.number().positive().default(64),
  fontWeight: z.number().int().min(100).max(900).default(600),
  color: z.string().default("#ffffff"),
  background: z.string().optional(),
  padding: z.number().min(0).default(16),
  align: z.enum(["left", "center", "right"]).default("left"),
  vAlign: z.enum(["top", "middle", "bottom"]).default("top"),
  /** Shrink from fontSize until the content fits the box. */
  autoFit: z.boolean().default(true),
  /** Small caption drawn above the content, e.g. "NEXT". */
  label: z.string().optional(),
  border: z
    .object({ width: z.number().min(0), color: z.string(), radius: z.number().min(0) })
    .optional(),
});
export type StageWidgetStyle = z.infer<typeof StageWidgetStyleSchema>;

const base = {
  id: z.string(),
  rect: StageRectSchema,
  hidden: z.boolean().optional(),
  locked: z.boolean().optional(),
  style: StageWidgetStyleSchema.default({}),
};

export const StageTimerSourceSchema = z.union([
  z.literal("firstActive"),
  z.object({ channel: z.string() }),
]);
export type StageTimerSource = z.infer<typeof StageTimerSourceSchema>;

export const StageWidgetSchema = z.discriminatedUnion("kind", [
  z.object({
    ...base,
    kind: z.literal("currentSlide"),
    props: z.object({ showReference: z.boolean().default(true) }).default({}),
  }),
  z.object({
    ...base,
    kind: z.literal("nextSlide"),
    props: z
      .object({
        maxLines: z.number().int().positive().default(2),
        dimOpacity: z.number().min(0).max(1).default(0.6),
      })
      .default({}),
  }),
  z.object({
    ...base,
    kind: z.literal("rowTitle"),
    props: z.object({ showNext: z.boolean().default(true) }).default({}),
  }),
  z.object({
    ...base,
    kind: z.literal("rowCue"),
    props: z.object({ includeNextRow: z.boolean().default(false) }).default({}),
  }),
  z.object({
    ...base,
    kind: z.literal("clock"),
    props: z
      .object({ format: z.enum(["12h", "24h"]).default("12h"), seconds: z.boolean().default(false) })
      .default({}),
  }),
  z.object({
    ...base,
    kind: z.literal("timer"),
    props: z.object({ source: StageTimerSourceSchema.default("firstActive") }).default({}),
  }),
  z.object({
    ...base,
    kind: z.literal("videoRemaining"),
    props: z.object({ warnBelowSec: z.number().min(0).default(30) }).default({}),
  }),
  z.object({
    ...base,
    kind: z.literal("text"),
    props: z.object({ text: z.string().default("") }).default({}),
  }),
]);
export type StageWidget = z.infer<typeof StageWidgetSchema>;
export type StageWidgetKind = StageWidget["kind"];

export const StageLayoutSchema = z.object({
  id: z.string(),
  name: z.string(),
  size: z.object({ w: z.number().positive(), h: z.number().positive() }).default({ w: 1920, h: 1080 }),
  background: z.string().default("#000000"),
  /** Array order is z-order (later draws on top). */
  widgets: z.array(StageWidgetSchema),
  /** Shipped in code; read-only, duplicate to edit (phase 5). */
  builtIn: z.boolean().optional(),
  updatedAt: z.string().optional(),
  deletedAt: z.string().optional(),
});
export type StageLayout = z.infer<typeof StageLayoutSchema>;

export const DEFAULT_STAGE_LAYOUT_ID = "speaker";

/** Speaker: row title + clock across the top, live slide, then next / cue / timers. */
export const SPEAKER_LAYOUT: StageLayout = StageLayoutSchema.parse({
  id: "speaker",
  name: "Speaker",
  builtIn: true,
  size: { w: 1920, h: 1080 },
  background: "#000000",
  widgets: [
    {
      id: "row-title",
      kind: "rowTitle",
      rect: { x: 24, y: 24, w: 1472, h: 110 },
      style: { fontSize: 48, label: "NOW" },
    },
    {
      id: "clock",
      kind: "clock",
      rect: { x: 1520, y: 24, w: 376, h: 110 },
      style: { fontSize: 72, align: "right", vAlign: "middle", autoFit: false },
    },
    {
      id: "current",
      kind: "currentSlide",
      rect: { x: 24, y: 158, w: 1872, h: 520 },
      style: { fontSize: 72, label: "LIVE", border: { width: 2, color: "#333333", radius: 12 } },
    },
    {
      id: "next",
      kind: "nextSlide",
      rect: { x: 24, y: 702, w: 1180, h: 354 },
      style: { fontSize: 48, label: "NEXT", color: "#bbbbbb" },
    },
    {
      id: "cue",
      kind: "rowCue",
      rect: { x: 1228, y: 702, w: 668, h: 220 },
      style: { fontSize: 40, label: "CUE", color: "#ffd166" },
    },
    {
      id: "timer",
      kind: "timer",
      rect: { x: 1228, y: 946, w: 330, h: 110 },
      style: { fontSize: 56, label: "TIMER", autoFit: false },
    },
    {
      id: "video",
      kind: "videoRemaining",
      rect: { x: 1566, y: 946, w: 330, h: 110 },
      style: { fontSize: 56, label: "VIDEO", autoFit: false },
    },
  ],
});

export const BUILT_IN_STAGE_LAYOUTS: StageLayout[] = [SPEAKER_LAYOUT];

/** The built-in with this id, else the default. Phase 5 adds stored layouts. */
export function resolveStageLayout(id: string | undefined): StageLayout {
  return BUILT_IN_STAGE_LAYOUTS.find((l) => l.id === id) ?? SPEAKER_LAYOUT;
}
