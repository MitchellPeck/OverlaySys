import { z } from "zod";

export const TransformSchema = z.object({
  x: z.number().default(0),
  y: z.number().default(0),
  w: z.number().optional(),
  h: z.number().optional(),
  rotation: z.number().default(0),
  scaleX: z.number().default(1),
  scaleY: z.number().default(1),
  opacity: z.number().min(0).max(1).default(1),
  anchorX: z.number().default(0),
  anchorY: z.number().default(0),
});
export type Transform = z.infer<typeof TransformSchema>;

export const FieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(["text", "image", "color", "number", "video"]),
  default: z.string().optional(),
});
export type Field = z.infer<typeof FieldSchema>;

export const FieldRefSchema = z.object({ fieldKey: z.string() });
export type FieldRef = z.infer<typeof FieldRefSchema>;

/**
 * A value that can be either a literal string OR a binding to a declared field.
 * Used for properties that should be editable per-row at show time (text content,
 * image src, colors).
 */
export const ColorValueSchema = z.union([z.string(), FieldRefSchema]);
export type ColorValue = z.infer<typeof ColorValueSchema>;

export const TextStyleSchema = z.object({
  fontFamily: z.string().default("Inter"),
  fontSize: z.number().default(48),
  fontWeight: z.union([z.string(), z.number()]).default(600),
  italic: z.boolean().default(false),
  underline: z.boolean().default(false),
  color: ColorValueSchema.default("#ffffff"),
  letterSpacing: z.number().default(0),
  lineHeight: z.number().default(1.1),
  align: z.enum(["left", "center", "right"]).default("left"),
  verticalAlign: z.enum(["top", "middle", "bottom"]).default("top"),
});
export type TextStyle = z.infer<typeof TextStyleSchema>;

export const FillSchema = z.union([
  z.object({ kind: z.literal("solid"), color: ColorValueSchema }),
  z.object({
    kind: z.literal("linear-gradient"),
    angle: z.number().default(0),
    stops: z.array(z.object({ at: z.number(), color: ColorValueSchema })),
  }),
]);
export type Fill = z.infer<typeof FillSchema>;

/**
 * Reveal-edge / intersect clip: when set, the layer is wrapped in a
 * clipping container whose visible region is defined relative to the
 * referenced layer's bounding box.
 *
 * `hide` modes:
 * - `inside`  — hide where this layer overlaps the reference's bbox.
 *               The reference acts as a "mask region". Default for new
 *               clipBys.
 * - `outside` — inverse of inside; show only what's inside the
 *               reference's bbox.
 * - `above` / `below` / `left` / `right` — half-plane through the
 *               reference's far edge. Useful for "text emerges from a
 *               horizontal line" effects where the reference is thin.
 *
 * The reference layer can be invisible (`visible: false`) and still
 * drive the clip, making it a positional marker rather than visible art.
 */
export const ClipBySchema = z.object({
  layerId: z.string(),
  hide: z.enum(["inside", "outside", "above", "below", "left", "right"]),
});
export type ClipBy = z.infer<typeof ClipBySchema>;

const BaseLayer = {
  id: z.string(),
  name: z.string(),
  visible: z.boolean().default(true),
  transform: TransformSchema,
  clipBy: ClipBySchema.optional(),
};

const TextLayerSchema = z.object({
  ...BaseLayer,
  type: z.literal("text"),
  content: z.union([z.string(), FieldRefSchema]),
  style: TextStyleSchema,
});

const ImageLayerSchema = z.object({
  ...BaseLayer,
  type: z.literal("image"),
  src: z.union([z.string(), FieldRefSchema]),
  fit: z.enum(["contain", "cover", "fill"]).default("cover"),
});

/**
 * `crop` defines an inset window into the source video, expressed as
 * fractions of the source frame (0..1). The renderer clips to this region
 * via CSS `clip-path` on a sized-up `<video>` element so the visible area
 * fills the layer box. Useful for stripping vendor logos, sub-titles, or
 * widening a 16:9 source into a 21:9 layer without letterboxing.
 *
 * left=0, top=0, right=1, bottom=1 means "no crop" (full source visible).
 */
export const VideoCropSchema = z.object({
  left: z.number().min(0).max(1).default(0),
  top: z.number().min(0).max(1).default(0),
  right: z.number().min(0).max(1).default(1),
  bottom: z.number().min(0).max(1).default(1),
});
export type VideoCrop = z.infer<typeof VideoCropSchema>;

const VideoLayerSchema = z.object({
  ...BaseLayer,
  type: z.literal("video"),
  src: z.union([z.string(), FieldRefSchema]),
  /** How the video frame fits within the layer box. */
  fit: z.enum(["contain", "cover", "fill"]).default("cover"),
  /** Loop back to start when playback reaches end (or `trimEnd`). */
  loop: z.boolean().default(true),
  /** Start playing as soon as the layer mounts. */
  autoplay: z.boolean().default(true),
  /** Mute the video. Defaults true because browsers block unmuted autoplay. */
  muted: z.boolean().default(true),
  /** Playback rate (1 = normal). Useful for slowing down idle/ambient loops. */
  playbackRate: z.number().min(0.25).max(4).default(1),
  /** Trim points in seconds. `trimEnd` 0 means "play to natural end". */
  trimStart: z.number().min(0).default(0),
  trimEnd: z.number().min(0).default(0),
  /** Source-frame crop window. */
  crop: VideoCropSchema.default({ left: 0, top: 0, right: 1, bottom: 1 }),
});

/**
 * A corner-radius can be a single number (uniform on all four corners — the
 * legacy form, also handy for circles via `borderRadius: 50%` semantics) or
 * a per-corner record. Per-corner is only meaningful for `rect`; other shape
 * kinds ignore it.
 */
export const CornerRadiusSchema = z.union([
  z.number(),
  z.object({
    tl: z.number().default(0),
    tr: z.number().default(0),
    br: z.number().default(0),
    bl: z.number().default(0),
  }),
]);
export type CornerRadius = z.infer<typeof CornerRadiusSchema>;

export const ShadowSchema = z.object({
  x: z.number().default(0),
  y: z.number().default(0),
  blur: z.number().default(0),
  color: ColorValueSchema.default("rgba(0,0,0,0.5)"),
});
export type Shadow = z.infer<typeof ShadowSchema>;

const ShapeLayerSchema = z.object({
  ...BaseLayer,
  type: z.literal("shape"),
  /**
   * Geometry kind. `rect` and `ellipse` use the layer's box; `triangle`,
   * `polygon`, and `star` are rendered via CSS clip-path on the same box.
   */
  shape: z.enum(["rect", "ellipse", "triangle", "polygon", "star"]),
  fill: FillSchema,
  cornerRadius: CornerRadiusSchema.default(0),
  /** Number of sides for `polygon`. Ignored otherwise. */
  sides: z.number().int().min(3).max(20).default(6),
  /** Number of points for `star`. Ignored otherwise. */
  starPoints: z.number().int().min(3).max(20).default(5),
  /** Inner-radius ratio for `star` (0..1). Lower = sharper points. */
  starInnerRatio: z.number().min(0.05).max(0.95).default(0.5),
  /** CSS filter blur in px. 0 = no blur. */
  blur: z.number().min(0).default(0),
  /** Optional drop shadow rendered via filter so it follows the clip-path. */
  shadow: ShadowSchema.optional(),
});

export const MaskShapeSchema = z.object({
  kind: z.enum(["rect", "ellipse"]),
  x: z.number().default(0),
  y: z.number().default(0),
  w: z.number(),
  h: z.number(),
  cornerRadius: z.number().default(0),
});
export type MaskShape = z.infer<typeof MaskShapeSchema>;

// Recursive group type — declared via z.lazy.
export type Layer =
  | (z.infer<typeof TextLayerSchema> & { type: "text" })
  | (z.infer<typeof ImageLayerSchema> & { type: "image" })
  | (z.infer<typeof VideoLayerSchema> & { type: "video" })
  | (z.infer<typeof ShapeLayerSchema> & { type: "shape" })
  | {
      type: "group";
      id: string;
      name: string;
      visible: boolean;
      transform: Transform;
      children: Layer[];
      mask?: MaskShape;
      clipBy?: ClipBy;
    };

export const LayerSchema: z.ZodType<Layer, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.discriminatedUnion("type", [
    TextLayerSchema,
    ImageLayerSchema,
    VideoLayerSchema,
    ShapeLayerSchema,
    z.object({
      ...BaseLayer,
      type: z.literal("group"),
      children: z.array(LayerSchema),
      mask: MaskShapeSchema.optional(),
    }),
  ]),
);

export const EasingSpecSchema = z.union([
  z.string(), // GSAP easing string e.g. "power2.out"
  z.tuple([z.number(), z.number(), z.number(), z.number()]), // cubic-bezier
]);
export type EasingSpec = z.infer<typeof EasingSpecSchema>;

export const KeyframeSchema = z.object({
  t: z.number(), // seconds within the timeline
  value: z.union([z.number(), z.string()]),
  easing: EasingSpecSchema.default("power2.out"),
});
export type Keyframe = z.infer<typeof KeyframeSchema>;

// A track targets one property of one layer.
export const TrackSchema = z.object({
  layerId: z.string(),
  property: z.enum([
    "x",
    "y",
    "rotation",
    "scaleX",
    "scaleY",
    "opacity",
    "w",
    "h",
  ]),
  keyframes: z.array(KeyframeSchema),
});
export type Track = z.infer<typeof TrackSchema>;

export const TimelineSchema = z.object({
  duration: z.number(),
  tracks: z.array(TrackSchema),
});
export type Timeline = z.infer<typeof TimelineSchema>;

export const TemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  size: z.object({ w: z.number(), h: z.number() }),
  fields: z.array(FieldSchema),
  layers: z.array(LayerSchema),
  timelines: z.object({
    in: TimelineSchema,
    out: TimelineSchema,
    loop: TimelineSchema.optional(),
  }),
  fonts: z
    .array(z.object({ family: z.string(), src: z.string() }))
    .default([]),
  /**
   * Auto-out duration in milliseconds. When set, a successful (non-internal)
   * take of this template schedules a server-side clear after this many ms,
   * which makes the renderer play the out animation. Useful for self-
   * clearing graphics like lower-thirds or stings. Cancelled if any new
   * take/clear/promote happens on the channel before the timer fires.
   * Internal takes (song slide advances) bypass this.
   */
  autoOutMs: z.number().positive().optional(),
});
export type Template = z.infer<typeof TemplateSchema>;

export type TemplateMeta = Pick<Template, "id" | "name" | "size">;
