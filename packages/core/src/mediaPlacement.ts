import { z } from "zod";

/**
 * How a photo or video is sized in its frame (CSS `object-fit`):
 * Fill screen (cover, crops) / Fit inside (contain) / Shrink to fit
 * (scale-down: never enlarges) / Stretch (fill).
 */
export const MediaFitSchema = z.enum(["cover", "contain", "scale-down", "fill"]);
export type MediaFit = z.infer<typeof MediaFitSchema>;

/** Where a photo or video sits in its frame: a 3×3 grid. */
export const MediaPositionSchema = z.enum([
  "top-left",
  "top",
  "top-right",
  "left",
  "center",
  "right",
  "bottom-left",
  "bottom",
  "bottom-right",
]);
export type MediaPosition = z.infer<typeof MediaPositionSchema>;

/** Plain-language names for each position (the 3×3 picker's labels). */
export const MEDIA_POSITION_LABELS: Record<MediaPosition, string> = {
  "top-left": "Top left",
  top: "Top",
  "top-right": "Top right",
  left: "Left",
  center: "Centre",
  right: "Right",
  "bottom-left": "Bottom left",
  bottom: "Bottom",
  "bottom-right": "Bottom right",
};

const OBJECT_POSITION: Record<MediaPosition, string> = {
  "top-left": "0% 0%",
  top: "50% 0%",
  "top-right": "100% 0%",
  left: "0% 50%",
  center: "50% 50%",
  right: "100% 50%",
  "bottom-left": "0% 100%",
  bottom: "50% 100%",
  "bottom-right": "100% 100%",
};

/** CSS `object-position` for a 3×3 position. */
export function mediaObjectPosition(p: MediaPosition): string {
  return OBJECT_POSITION[p];
}

export type MediaPlacement = { fit: MediaFit; position: MediaPosition };
/** A size/position that may leave either unset (falls through to the next layer). */
export type PartialMediaPlacement = { fit?: MediaFit; position?: MediaPosition };

/** What plays when nothing sets a size: photos fill the screen, videos fit inside (as before sizes existed). */
export const defaultMediaFit = (mediaType: "image" | "video"): MediaFit => (mediaType === "image" ? "cover" : "contain");

/**
 * The size and position to play with: for each field, the first layer that
 * sets it (e.g. slide override, then deck default), else the type's default, centred.
 */
export function resolveMediaPlacement(
  mediaType: "image" | "video",
  ...layers: (PartialMediaPlacement | undefined)[]
): MediaPlacement {
  let fit: MediaFit | undefined;
  let position: MediaPosition | undefined;
  for (const l of layers) {
    fit ??= l?.fit;
    position ??= l?.position;
  }
  return { fit: fit ?? defaultMediaFit(mediaType), position: position ?? "center" };
}
