import {
  defaultMediaFit,
  resolveMediaPlacement,
  type MediaFit,
  type MediaPlacement,
  type MediaPosition,
  type PartialMediaPlacement,
} from "@overlaysys/core";

/** The four sizes, in plain language. */
export const MEDIA_FIT_OPTIONS: { value: MediaFit; label: string; title: string }[] = [
  { value: "cover", label: "Fill screen", title: "Fill the frame; edges may be cropped" },
  { value: "contain", label: "Fit inside", title: "Show the whole picture" },
  { value: "scale-down", label: "Shrink to fit", title: "Never enlarged; shrunk only if it's bigger than the frame" },
  { value: "fill", label: "Stretch", title: "Stretch to the frame" },
];

export const mediaFitLabel = (fit: MediaFit): string => MEDIA_FIT_OPTIONS.find((o) => o.value === fit)?.label ?? fit;

/** An edit: a key given sets it; a key given as `undefined` clears it (back to the default). */
export type PlacementPatch = { fit?: MediaFit | undefined; position?: MediaPosition | undefined };

/**
 * `target` with `patch` applied to its size/position keys (by default `fit`
 * and `position`; a deck stores its default as `mediaFit` / `mediaPosition`).
 */
export function applyPlacement<T extends object>(
  target: T,
  patch: PlacementPatch,
  keys: { fit: string; position: string } = { fit: "fit", position: "position" },
): T {
  const out: Record<string, unknown> = { ...(target as Record<string, unknown>) };
  for (const k of ["fit", "position"] as const) {
    if (!(k in patch)) continue;
    const v = patch[k];
    if (v === undefined) delete out[keys[k]];
    else out[keys[k]] = v;
  }
  return out as T;
}

/** Only the size/position an item (or pick) sets, for copying onto a new use. */
export function ownPlacement(p: PartialMediaPlacement | undefined): PartialMediaPlacement {
  return { ...(p?.fit ? { fit: p.fit } : {}), ...(p?.position ? { position: p.position } : {}) };
}

/** Where a new use starts: the item's own size/position, else what plays today. */
export const startPlacement = (mediaType: "image" | "video", item: PartialMediaPlacement | undefined): MediaPlacement =>
  resolveMediaPlacement(mediaType, item);

/**
 * What a Media row stores for a chosen size/position. A photo always keeps
 * its size; anything that matches what plays today (centred; a video's Fit
 * inside) is left off so rows stay as they were.
 */
export function rowPlacement(mediaType: "image" | "video", p: MediaPlacement): PartialMediaPlacement {
  return {
    ...(mediaType === "image" || p.fit !== defaultMediaFit(mediaType) ? { fit: p.fit } : {}),
    ...(p.position !== "center" ? { position: p.position } : {}),
  };
}

/** What a library item stores as its own size/position: only what differs from what plays today. */
export function itemPlacement(mediaType: "image" | "video", p: MediaPlacement): PartialMediaPlacement {
  return {
    ...(p.fit !== defaultMediaFit(mediaType) ? { fit: p.fit } : {}),
    ...(p.position !== "center" ? { position: p.position } : {}),
  };
}
