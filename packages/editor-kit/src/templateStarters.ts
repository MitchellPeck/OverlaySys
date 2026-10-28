import type { Layer, Template, TextStyle, Timeline, Track } from "@overlaysys/core";
import { blankTemplate } from "./utils";

/** Canvas sizes offered for templates; anything else is "custom". */
export const TEMPLATE_SIZE_PRESETS: { w: number; h: number; label: string }[] = [
  { w: 1920, h: 1080, label: "1080p (1920×1080)" },
  { w: 3840, h: 2160, label: "4K (3840×2160)" },
  { w: 1280, h: 720, label: "720p (1280×720)" },
  { w: 1080, h: 1920, label: "Vertical (1080×1920)" },
  { w: 1080, h: 1080, label: "Square (1080×1080)" },
  { w: 1920, h: 360, label: "LED strip (1920×360)" },
  { w: 2560, h: 720, label: "LED wide (2560×720)" },
];

/** `"WxH"` for a matching preset, otherwise `"custom"`. */
export function templateSizePresetKey(size: { w: number; h: number }): string {
  const p = TEMPLATE_SIZE_PRESETS.find((s) => s.w === size.w && s.h === size.h);
  return p ? `${p.w}x${p.h}` : "custom";
}

const T0 = { rotation: 0, scaleX: 1, scaleY: 1, opacity: 1, anchorX: 0, anchorY: 0 };

function style(p: Partial<TextStyle>): TextStyle {
  return {
    fontFamily: "Inter, system-ui, sans-serif",
    fontSize: 48,
    fontWeight: 600,
    italic: false,
    underline: false,
    color: "#ffffff",
    letterSpacing: 0,
    lineHeight: 1.15,
    align: "left",
    verticalAlign: "top",
    ...p,
  };
}

function rect(id: string, name: string, x: number, y: number, w: number, h: number, color: string, radius = 0): Layer {
  return {
    id,
    name,
    visible: true,
    transform: { ...T0, x, y, w, h },
    type: "shape",
    shape: "rect",
    fill: { kind: "solid", color },
    cornerRadius: radius,
    sides: 6,
    starPoints: 5,
    starInnerRatio: 0.5,
    blur: 0,
  };
}

function text(
  id: string,
  name: string,
  box: { x: number; y: number; w: number; h: number },
  content: Extract<Layer, { type: "text" }>["content"],
  s: Partial<TextStyle>,
  fit?: "shrink" | "ellipsis",
  minFontSize?: number,
): Layer {
  return {
    id,
    name,
    visible: true,
    transform: { ...T0, ...box },
    type: "text",
    content,
    style: style(s),
    ...(fit ? { fit } : {}),
    ...(minFontSize ? { minFontSize } : {}),
  };
}

function kf(layerId: string, property: Track["property"], pts: [number, number][], easing = "power3.out"): Track {
  return { layerId, property, keyframes: pts.map(([t, value]) => ({ t, value, easing })) };
}

function tl(duration: number, tracks: Track[]): Timeline {
  return { duration, tracks };
}

export type TemplateStarter = {
  id: string;
  label: string;
  description: string;
  build(id: string, name: string): Template;
};

export const TEMPLATE_STARTERS: TemplateStarter[] = [
  {
    id: "blank",
    label: "Blank",
    description: "Empty 1920×1080 canvas",
    build: (id, name) => blankTemplate(id, name),
  },
  {
    id: "lower-third",
    label: "Lower third",
    description: "Name and title on a plate, slides in from the left",
    build: (id, name) => ({
      ...blankTemplate(id, name),
      fields: [
        { key: "name", label: "Name", type: "text", default: "Jane Smith" },
        { key: "title", label: "Title", type: "text", default: "Worship Pastor" },
        { key: "accent", label: "Accent", type: "color", default: "#ff3a3a" },
      ],
      layers: [
        {
          id: "lt-group",
          name: "Lower third",
          visible: true,
          transform: { ...T0, x: 120, y: 820, w: 760, h: 140 },
          type: "group",
          children: [
            { ...rect("lt-bar", "Accent bar", 0, 0, 12, 140, "#ff3a3a"), fill: { kind: "solid", color: { fieldKey: "accent" } } } as Layer,
            rect("lt-plate", "Plate", 12, 0, 748, 140, "rgba(12,13,16,0.85)"),
            text("lt-name", "Name", { x: 36, y: 20, w: 700, h: 64 }, { fieldKey: "name" }, { fontSize: 52, fontWeight: 700 }, "shrink", 28),
            text("lt-title", "Title", { x: 36, y: 88, w: 700, h: 36 }, { fieldKey: "title" }, { fontSize: 28, fontWeight: 500, color: "#c9ced8" }, "ellipsis"),
          ],
        },
      ],
      timelines: {
        in: tl(0.8, [
          kf("lt-group", "x", [[0, -900], [0.6, 0]]),
          kf("lt-group", "opacity", [[0, 0], [0.3, 1]]),
        ]),
        out: tl(0.5, [
          kf("lt-group", "x", [[0, 0], [0.4, -900]], "power2.in"),
          kf("lt-group", "opacity", [[0.1, 1], [0.4, 0]], "power2.in"),
        ]),
      },
    }),
  },
  {
    id: "scripture",
    label: "Scripture",
    description: "Verse text that shrinks to fit, with its reference",
    build: (id, name) => ({
      ...blankTemplate(id, name),
      fields: [
        { key: "text", label: "Verse", type: "text", default: "For God so loved the world that he gave his one and only Son…" },
        { key: "reference", label: "Reference", type: "text", default: "John 3:16 NIV" },
      ],
      layers: [
        rect("sc-box", "Box", 160, 600, 1600, 400, "rgba(10,12,18,0.82)", 16),
        text("sc-text", "Verse", { x: 220, y: 640, w: 1480, h: 260 }, { fieldKey: "text" }, { fontSize: 56, fontWeight: 500, lineHeight: 1.25 }, "shrink", 28),
        text("sc-ref", "Reference", { x: 220, y: 920, w: 1480, h: 50 }, { fieldKey: "reference" }, { fontSize: 32, fontWeight: 700, color: "#ffd479", align: "right" }, "ellipsis"),
      ],
      timelines: {
        in: tl(0.6, [
          kf("sc-box", "opacity", [[0, 0], [0.4, 1]]),
          kf("sc-text", "opacity", [[0.15, 0], [0.6, 1]]),
          kf("sc-ref", "opacity", [[0.25, 0], [0.6, 1]]),
        ]),
        out: tl(0.4, [
          kf("sc-box", "opacity", [[0, 1], [0.4, 0]], "power2.in"),
          kf("sc-text", "opacity", [[0, 1], [0.3, 0]], "power2.in"),
          kf("sc-ref", "opacity", [[0, 1], [0.3, 0]], "power2.in"),
        ]),
      },
    }),
  },
  {
    id: "lyrics",
    label: "Lyrics",
    description: "Centred lyric lines on a lower band",
    build: (id, name) => ({
      ...blankTemplate(id, name),
      fields: [{ key: "text", label: "Lyrics", type: "text", default: "Amazing grace, how sweet the sound\nThat saved a wretch like me" }],
      layers: [
        {
          ...rect("ly-band", "Band", 0, 760, 1920, 320, "#000000"),
          fill: { kind: "linear-gradient", angle: 180, stops: [{ at: 0, color: "rgba(0,0,0,0)" }, { at: 1, color: "rgba(0,0,0,0.75)" }] },
        } as Layer,
        text("ly-text", "Lyrics", { x: 160, y: 820, w: 1600, h: 220 }, { fieldKey: "text" }, { fontSize: 64, fontWeight: 700, align: "center", verticalAlign: "middle", lineHeight: 1.2 }, "shrink", 32),
      ],
      timelines: {
        in: tl(0.4, [kf("ly-text", "opacity", [[0, 0], [0.4, 1]], "power2.out")]),
        out: tl(0.3, [kf("ly-text", "opacity", [[0, 1], [0.3, 0]], "power2.in")]),
      },
    }),
  },
  {
    id: "countdown",
    label: "Countdown",
    description: "Pre-service countdown clock",
    build: (id, name) => ({
      ...blankTemplate(id, name),
      fields: [
        { key: "until", label: "Ends at", type: "time", default: "", timeMode: "countdown", timeFormat: "M:SS" },
        { key: "label", label: "Label", type: "text", default: "Service begins in" },
      ],
      layers: [
        rect("cd-bg", "Backdrop", 0, 0, 1920, 1080, "#0b0d12"),
        text("cd-label", "Label", { x: 260, y: 330, w: 1400, h: 80 }, { fieldKey: "label" }, { fontSize: 56, fontWeight: 500, align: "center", color: "#c9ced8" }, "shrink", 24),
        text("cd-time", "Clock", { x: 260, y: 420, w: 1400, h: 300 }, { fieldKey: "until" }, { fontSize: 260, fontWeight: 800, align: "center", verticalAlign: "middle", lineHeight: 1 }),
      ],
      timelines: {
        in: tl(0.6, [kf("cd-time", "scaleX", [[0, 0.9], [0.6, 1]]), kf("cd-time", "scaleY", [[0, 0.9], [0.6, 1]]), kf("cd-time", "opacity", [[0, 0], [0.4, 1]])]),
        out: tl(0.4, [kf("cd-time", "opacity", [[0, 1], [0.4, 0]], "power2.in")]),
      },
    }),
  },
  {
    id: "bug",
    label: "Corner bug",
    description: "Small logo / label in the top-right corner",
    build: (id, name) => ({
      ...blankTemplate(id, name),
      fields: [
        { key: "logo", label: "Logo", type: "image", default: "" },
        { key: "label", label: "Label", type: "text", default: "LIVE" },
      ],
      layers: [
        {
          id: "bug-logo",
          name: "Logo",
          visible: true,
          transform: { ...T0, x: 1640, y: 60, w: 200, h: 80 },
          type: "image",
          src: { fieldKey: "logo" },
          fit: "contain",
        },
        rect("bug-pill", "Pill", 1700, 150, 140, 44, "#e11d48", 22),
        text("bug-label", "Label", { x: 1700, y: 150, w: 140, h: 44 }, { fieldKey: "label" }, { fontSize: 24, fontWeight: 800, align: "center", verticalAlign: "middle", letterSpacing: 2 }, "shrink", 12),
      ],
      timelines: {
        in: tl(0.5, [
          kf("bug-logo", "opacity", [[0, 0], [0.5, 1]], "power2.out"),
          kf("bug-pill", "opacity", [[0.1, 0], [0.5, 1]], "power2.out"),
          kf("bug-label", "opacity", [[0.1, 0], [0.5, 1]], "power2.out"),
        ]),
        out: tl(0.4, [
          kf("bug-logo", "opacity", [[0, 1], [0.4, 0]], "power2.in"),
          kf("bug-pill", "opacity", [[0, 1], [0.4, 0]], "power2.in"),
          kf("bug-label", "opacity", [[0, 1], [0.4, 0]], "power2.in"),
        ]),
      },
    }),
  },
];

/** Build a new template from starter `starterId` (unknown ids give a blank one). */
export function templateFromStarter(starterId: string, id: string, name: string): Template {
  const s = TEMPLATE_STARTERS.find((x) => x.id === starterId) ?? TEMPLATE_STARTERS[0]!;
  return { ...s.build(id, name), id, name };
}
