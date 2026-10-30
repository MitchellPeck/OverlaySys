import { z } from "zod";
import { MediaFitSchema, MediaPositionSchema } from "./mediaPlacement";

/** A library entry: an uploaded file or a live folder. A live folder's path is per machine and never stored here. */
export const MediaItemSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    kind: z.enum(["file", "live-folder"]),
    mediaType: z.enum(["image", "video"]).optional(),
    assetUrl: z.string().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
    durationSec: z.number().optional(),
    folder: z.string().optional(),
    /** The item's own size/position: where it's added, that use starts with these. */
    fit: MediaFitSchema.optional(),
    position: MediaPositionSchema.optional(),
    createdAt: z.string(),
    updatedAt: z.string().optional(),
    deletedAt: z.string().optional(),
  })
  .passthrough()
  .superRefine((item, ctx) => {
    if (item.kind !== "file") return;
    if (!item.assetUrl) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["assetUrl"], message: "assetUrl is required for a file item" });
    if (!item.mediaType) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["mediaType"], message: "mediaType is required for a file item" });
  });
export type MediaItem = z.infer<typeof MediaItemSchema>;
export type MediaItemMeta = MediaItem & { usedBy: number };

/** The photo file extensions OverlaySys plays (import, live folders, thumbnails). */
export const IMAGE_EXTENSIONS: ReadonlySet<string> = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp"]);
/** The video file extensions OverlaySys plays. */
export const VIDEO_EXTENSIONS: ReadonlySet<string> = new Set(["mp4", "webm", "mov", "m4v"]);

/** Photo or video by a file name's extension (any case); null for anything else. */
export function mediaTypeOfFileName(name: string): "image" | "video" | null {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  return IMAGE_EXTENSIONS.has(ext) ? "image" : VIDEO_EXTENSIONS.has(ext) ? "video" : null;
}
