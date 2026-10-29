import type { Layer, Template, Track } from "@overlaysys/core";
import { flattenLayersForDisplay } from "./utils";

/** Human name and unit for each animatable property. */
export const TRACK_PROPERTY_LABELS: Record<Track["property"], { label: string; unit: string }> = {
  x: { label: "X", unit: "px" },
  y: { label: "Y", unit: "px" },
  rotation: { label: "Rotation", unit: "°" },
  scaleX: { label: "Scale X", unit: "×" },
  scaleY: { label: "Scale Y", unit: "×" },
  opacity: { label: "Opacity", unit: "" },
  w: { label: "Width", unit: "px" },
  h: { label: "Height", unit: "px" },
  wipe: { label: "Wipe", unit: "" },
};

/**
 * Arrow step and shown/committed decimals for a keyframe value. Matches the
 * layer inspector: px and degrees keep 2 dp (22.5° stays 22.5), unitless and
 * × values keep 3.
 */
export function keyframeValueInput(property: Track["property"]): { step: number; precision: number } {
  const unit = TRACK_PROPERTY_LABELS[property].unit;
  return unit === "px" || unit === "°" ? { step: 1, precision: 2 } : { step: 0.01, precision: 3 };
}

/**
 * Layers with at least one `in` track and no `out` track, in Layers-panel
 * order (topmost first): the same order as the timeline's group headers.
 */
export function layersMissingOut(t: Template): { layerId: string; name: string }[] {
  const hasIn = new Set(t.timelines.in.tracks.map((tr) => tr.layerId));
  const hasOut = new Set(t.timelines.out.tracks.map((tr) => tr.layerId));
  return flattenLayersForDisplay(t.layers)
    .filter(({ layer }) => hasIn.has(layer.id) && !hasOut.has(layer.id))
    .map(({ layer }) => ({ layerId: layer.id, name: layer.name }));
}

export function missingOutMessage(name: string): string {
  return `${name} has no out animation: it will cut`;
}

export type TrackGroup = {
  layerId: string;
  name: string;
  /** `index` is the track's position in the timeline's `tracks` array. */
  tracks: { track: Track; index: number }[];
};

/**
 * Tracks grouped under their layer, in the order the Layers panel shows
 * (topmost first). Tracks whose layer no longer exists come last.
 */
export function groupTracksByLayer(layers: Layer[], tracks: Track[]): TrackGroup[] {
  const byLayer = new Map<string, TrackGroup["tracks"]>();
  tracks.forEach((track, index) => {
    const list = byLayer.get(track.layerId) ?? [];
    list.push({ track, index });
    byLayer.set(track.layerId, list);
  });
  const groups: TrackGroup[] = [];
  for (const { layer } of flattenLayersForDisplay(layers)) {
    const list = byLayer.get(layer.id);
    if (!list) continue;
    groups.push({ layerId: layer.id, name: layer.name, tracks: list });
    byLayer.delete(layer.id);
  }
  for (const [layerId, list] of byLayer) groups.push({ layerId, name: "Missing layer", tracks: list });
  return groups;
}
