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
  /** Caption (label) size in px; renderer default when absent. */
  captionSize: z.number().positive().optional(),
  captionColor: z.string().optional(),
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
  z.literal("currentItem"),
  z.object({ channel: z.string() }),
  z.object({ timerId: z.string() }),
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
    props: z
      .object({ showNext: z.boolean().default(true), prefer: z.enum(["rundown", "pco"]).default("rundown") })
      .default({}),
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
    props: z
      .object({
        source: StageTimerSourceSchema.default("firstActive"),
        warnBelowSec: z.number().min(0).default(60),
        warnColor: z.string().default("#ffb703"),
        overColor: z.string().default("#ef233c"),
        showLabel: z.boolean().default(false),
        /** How overtime is shown. Renderer treats undefined as "text" for stored layouts. */
        overtimeStyle: z.enum(["text", "fill", "flash"]).optional(),
      })
      .default({}),
  }),
  z.object({
    ...base,
    kind: z.literal("videoRemaining"),
    props: z
      .object({
        warnBelowSec: z.number().min(0).default(30),
        warnColor: z.string().optional(),
        overColor: z.string().optional(),
      })
      .default({}),
  }),
  z.object({
    ...base,
    kind: z.literal("sermonNotes"),
    props: z
      .object({
        highlightColor: z.string().default("#ffd166"),
        dimPast: z.boolean().default(true),
        showCounter: z.boolean().default(true),
        /** Where the active point's top sits, as a fraction of the widget height. */
        anchor: z.number().min(0).max(1).default(0.33),
        /** Hide the widget (and its caption) while there are no notes. */
        collapseWhenEmpty: z.boolean().optional(),
      })
      .default({}),
  }),
  z.object({
    ...base,
    kind: z.literal("message"),
    props: z.object({ flash: z.boolean().default(true) }).default({}),
  }),
  z.object({
    ...base,
    kind: z.literal("serviceProgress"),
    props: z
      .object({
        showPosition: z.boolean().default(true),
        showEnd: z.boolean().default(true),
        showDelta: z.boolean().default(true),
        /** Clock style for the planned end time ("Ends 10:20 AM" vs "Ends 10:20"). */
        clock: z.enum(["12h", "24h"]).default("12h"),
      })
      .default({}),
  }),
  z.object({
    ...base,
    kind: z.literal("text"),
    props: z.object({ text: z.string().default("") }).default({}),
  }),
]);
export type StageWidget = z.infer<typeof StageWidgetSchema>;
export type StageWidgetKind = StageWidget["kind"];

/** Filename-safe: stored layouts are written to `<id>.json` under data/stage-layouts. */
export const STAGE_LAYOUT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export const StageLayoutSchema = z.object({
  id: z.string().regex(STAGE_LAYOUT_ID_PATTERN, "id must be 1-64 letters, digits, '_' or '-'"),
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

/** Speaker: row title + live slide + next + notes on the left, timer / clock / video / cue on the right. Sized to read at 10 m. */
export const SPEAKER_LAYOUT: StageLayout = StageLayoutSchema.parse({
  id: "speaker",
  name: "Speaker",
  builtIn: true,
  size: { w: 1920, h: 1080 },
  background: "#000000",
  widgets: [
    { id: "row-title", kind: "rowTitle", rect: { x: 24, y: 24, w: 1248, h: 96 }, style: { fontSize: 56, label: "NOW" } },
    { id: "current", kind: "currentSlide", rect: { x: 24, y: 136, w: 1248, h: 300 }, style: { fontSize: 64, label: "LIVE" } },
    { id: "next", kind: "nextSlide", rect: { x: 24, y: 452, w: 1248, h: 150 }, style: { fontSize: 48, label: "NEXT", color: "#bbbbbb" } },
    { id: "notes", kind: "sermonNotes", rect: { x: 24, y: 618, w: 1248, h: 334 }, props: { collapseWhenEmpty: true }, style: { fontSize: 48, label: "NOTES", border: { width: 2, color: "#333333", radius: 12 }, autoFit: false } },
    { id: "timer", kind: "timer", rect: { x: 1296, y: 24, w: 600, h: 300 }, props: { showLabel: true, overtimeStyle: "fill" }, style: { fontSize: 200, autoFit: false } },
    { id: "clock", kind: "clock", rect: { x: 1296, y: 340, w: 600, h: 140 }, style: { fontSize: 96, padding: 8, align: "center", vAlign: "middle", autoFit: false } },
    { id: "video", kind: "videoRemaining", rect: { x: 1296, y: 496, w: 600, h: 140 }, style: { fontSize: 72, padding: 8, label: "VIDEO", autoFit: false } },
    { id: "cue", kind: "rowCue", rect: { x: 1296, y: 652, w: 600, h: 300 }, style: { fontSize: 48, label: "CUE", color: "#ffd166" } },
    { id: "message", kind: "message", rect: { x: 24, y: 968, w: 1872, h: 88 }, style: { fontSize: 52, align: "center", vAlign: "middle", color: "#000000", background: "#ffd166", autoFit: true } },
  ],
});

const MESSAGE_BAR_STYLE = { align: "center", vAlign: "middle", color: "#000000", background: "#ffd166", autoFit: true } as const;

/** Lyrics: the live slide dominates; next slide, timer, clock and message bar below. */
export const LYRICS_LAYOUT: StageLayout = StageLayoutSchema.parse({
  id: "lyrics",
  name: "Lyrics",
  builtIn: true,
  size: { w: 1920, h: 1080 },
  background: "#000000",
  widgets: [
    { id: "current", kind: "currentSlide", rect: { x: 24, y: 24, w: 1872, h: 720 }, props: { showReference: false }, style: { fontSize: 96, align: "center", vAlign: "middle" } },
    { id: "next", kind: "nextSlide", rect: { x: 24, y: 760, w: 1100, h: 200 }, props: { maxLines: 2 }, style: { fontSize: 48, color: "#bbbbbb", label: "NEXT" } },
    { id: "timer", kind: "timer", rect: { x: 1148, y: 760, w: 360, h: 200 }, props: { overtimeStyle: "fill" }, style: { fontSize: 96, align: "center", vAlign: "middle", autoFit: false } },
    { id: "clock", kind: "clock", rect: { x: 1528, y: 760, w: 368, h: 200 }, style: { fontSize: 72, align: "right", vAlign: "middle", autoFit: false } },
    { id: "message", kind: "message", rect: { x: 24, y: 976, w: 1872, h: 80 }, style: { fontSize: 52, ...MESSAGE_BAR_STYLE } },
  ],
});

/** Scripture: reference + verse, the next verse, timer / clock, and a notes sidebar. */
export const SCRIPTURE_LAYOUT: StageLayout = StageLayoutSchema.parse({
  id: "scripture",
  name: "Scripture",
  builtIn: true,
  size: { w: 1920, h: 1080 },
  background: "#000000",
  widgets: [
    { id: "current", kind: "currentSlide", rect: { x: 24, y: 24, w: 1300, h: 780 }, props: { showReference: true }, style: { fontSize: 64, label: "SCRIPTURE" } },
    { id: "next", kind: "nextSlide", rect: { x: 24, y: 820, w: 1300, h: 140 }, style: { fontSize: 48, color: "#bbbbbb", label: "NEXT VERSE" } },
    { id: "timer", kind: "timer", rect: { x: 1348, y: 24, w: 548, h: 180 }, props: { overtimeStyle: "fill" }, style: { fontSize: 96, align: "center", vAlign: "middle", autoFit: false } },
    { id: "clock", kind: "clock", rect: { x: 1348, y: 220, w: 548, h: 120 }, style: { fontSize: 72, align: "center", vAlign: "middle", autoFit: false } },
    { id: "notes", kind: "sermonNotes", rect: { x: 1348, y: 356, w: 548, h: 604 }, props: { collapseWhenEmpty: true }, style: { fontSize: 48, label: "NOTES", border: { width: 2, color: "#333333", radius: 12 }, autoFit: false } },
    { id: "message", kind: "message", rect: { x: 24, y: 976, w: 1872, h: 80 }, style: { fontSize: 52, ...MESSAGE_BAR_STYLE } },
  ],
});

export const BUILT_IN_STAGE_LAYOUTS: StageLayout[] = [SPEAKER_LAYOUT, LYRICS_LAYOUT, SCRIPTURE_LAYOUT];

export const StageLayoutMetaSchema = z.object({
  id: z.string(),
  name: z.string(),
  size: z.object({ w: z.number().positive(), h: z.number().positive() }),
  builtIn: z.boolean(),
  updatedAt: z.string().optional(),
});
export type StageLayoutMeta = z.infer<typeof StageLayoutMetaSchema>;

export function stageLayoutMeta(l: StageLayout): StageLayoutMeta {
  return {
    id: l.id,
    name: l.name,
    size: { ...l.size },
    builtIn: l.builtIn === true,
    ...(l.updatedAt ? { updatedAt: l.updatedAt } : {}),
  };
}

export function isBuiltInStageLayoutId(id: string): boolean {
  return BUILT_IN_STAGE_LAYOUTS.some((l) => l.id === id);
}

/** A new widget of `kind` with every default taken from the schema. */
export function defaultStageWidget(kind: StageWidgetKind, id: string, rect: StageRect): StageWidget {
  return StageWidgetSchema.parse({ id, kind, rect });
}

/** Starting rect size / style / props for a widget added from the palette (applied over the schema defaults). */
export const NEW_WIDGET_DEFAULTS: Partial<
  Record<StageWidgetKind, { rect?: Partial<StageRect>; style?: Partial<StageWidgetStyle>; props?: object }>
> = {
  timer: {
    rect: { w: 600, h: 300 },
    style: { fontSize: 160, autoFit: false },
    props: { showLabel: true, overtimeStyle: "fill" },
  },
  message: {
    style: { align: "center", vAlign: "middle", color: "#000000", background: "#ffd166", autoFit: true, fontSize: 52 },
  },
  currentSlide: { rect: { w: 1200, h: 400 }, style: { fontSize: 72 } },
};

/** Palette names, one per widget kind. */
export const STAGE_WIDGET_LABELS: Record<StageWidgetKind, string> = {
  currentSlide: "Current slide",
  nextSlide: "Next slide",
  rowTitle: "Row title",
  rowCue: "Row cue",
  clock: "Clock",
  timer: "Timer",
  videoRemaining: "Video remaining",
  sermonNotes: "Sermon notes",
  message: "Message",
  serviceProgress: "Service progress",
  text: "Text",
};

/**
 * The built-in with this id, else the default Speaker layout. Built-ins only:
 * the server's stageLayouts.resolveStageLayout layers stored layouts on top.
 */
export function resolveBuiltInStageLayout(id: string | undefined): StageLayout {
  return BUILT_IN_STAGE_LAYOUTS.find((l) => l.id === id) ?? SPEAKER_LAYOUT;
}
