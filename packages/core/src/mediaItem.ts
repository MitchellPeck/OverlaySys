import { z } from "zod";

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
