import type { Layer, Template } from "@overlaysys/core";

/** DFS lookup of a layer by id in a Template's layer tree. */
export function findLayer(layers: Layer[], id: string): Layer | null {
  for (const l of layers) {
    if (l.id === id) return l;
    if (l.type === "group") {
      const found = findLayer(l.children, id);
      if (found) return found;
    }
  }
  return null;
}

/** Immutable replace of a layer by id, returning a new layer tree. */
export function replaceLayer(layers: Layer[], id: string, next: Layer): Layer[] {
  return layers.map((l) => {
    if (l.id === id) return next;
    if (l.type === "group") return { ...l, children: replaceLayer(l.children, id, next) };
    return l;
  });
}

/** Apply a transform-property patch to a layer immutably. */
export function patchLayerTransform(
  layers: Layer[],
  id: string,
  patch: Partial<Layer["transform"]>,
): Layer[] {
  const cur = findLayer(layers, id);
  if (!cur) return layers;
  return replaceLayer(layers, id, {
    ...cur,
    transform: { ...cur.transform, ...patch },
  } as Layer);
}

/** Bounds of the canvas in screen space when scaled to fit. */
export function fitScale(canvasW: number, canvasH: number, hostW: number, hostH: number): number {
  const sw = hostW / canvasW;
  const sh = hostH / canvasH;
  return Math.min(sw, sh);
}

/** Quick blank template factory for "New template" button. */
export function blankTemplate(id: string, name = "Untitled"): Template {
  return {
    id,
    name,
    size: { w: 1920, h: 1080 },
    fonts: [],
    fields: [],
    layers: [],
    timelines: {
      in: { duration: 1, tracks: [] },
      out: { duration: 0.5, tracks: [] },
    },
  };
}

/** Flatten the layer tree into a depth-tagged list (for tree rendering). */
export type FlatLayer = { layer: Layer; depth: number; path: string[] };
export function flattenLayers(layers: Layer[], depth = 0, path: string[] = []): FlatLayer[] {
  const out: FlatLayer[] = [];
  for (const l of layers) {
    const myPath = [...path, l.id];
    out.push({ layer: l, depth, path: myPath });
    if (l.type === "group") {
      out.push(...flattenLayers(l.children, depth + 1, myPath));
    }
  }
  return out;
}

/**
 * Flatten for display in a layer panel: each level is iterated in REVERSE
 * (Photoshop convention — last in array = on top of z-stack = top of panel),
 * but the parent layer is emitted BEFORE its children so groups expand
 * downward beneath their header.
 */
export function flattenLayersForDisplay(
  layers: Layer[],
  depth = 0,
  path: string[] = [],
): FlatLayer[] {
  const out: FlatLayer[] = [];
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i]!;
    const myPath = [...path, l.id];
    out.push({ layer: l, depth, path: myPath });
    if (l.type === "group") {
      out.push(...flattenLayersForDisplay(l.children, depth + 1, myPath));
    }
  }
  return out;
}

/** True if `parentId`'s subtree contains `descendantId`. Prevents dropping a layer into itself. */
export function isAncestor(layers: Layer[], ancestorId: string, descendantId: string): boolean {
  const a = findLayer(layers, ancestorId);
  if (!a || a.type !== "group") return false;
  return findLayer(a.children, descendantId) !== null;
}

/**
 * Move a layer in a tree to a position relative to a target layer (or as the last
 * child of a target group). Removes the source from its old location, then inserts.
 *
 * `where`:
 *   - `before` / `after`: insert as a sibling of the target
 *   - `into`: append as the last child of the target (must be a group)
 */
export function moveLayer<T extends Layer>(
  layers: T[],
  sourceId: string,
  targetId: string,
  where: "before" | "after" | "into",
): void {
  if (sourceId === targetId) return;
  // Disallow dropping a group into its own subtree.
  if (where === "into" && (sourceId === targetId || isAncestor(layers, sourceId, targetId))) return;
  // Disallow making a group its own descendant via before/after on a child.
  if (isAncestor(layers, sourceId, targetId)) return;

  const removed = removeLayerByIdMutating(layers, sourceId);
  if (!removed) return;

  const inserted = insertRelative(layers, removed, targetId, where);
  if (!inserted) {
    // Safety: if the target wasn't found post-removal, append at top level.
    layers.push(removed);
  }
}

function removeLayerByIdMutating<T extends Layer>(layers: T[], id: string): T | null {
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i]!;
    if (l.id === id) {
      layers.splice(i, 1);
      return l;
    }
    if (l.type === "group") {
      const found = removeLayerByIdMutating(l.children as T[], id);
      if (found) return found;
    }
  }
  return null;
}

function insertRelative<T extends Layer>(
  layers: T[],
  source: T,
  targetId: string,
  where: "before" | "after" | "into",
): boolean {
  for (let i = 0; i < layers.length; i++) {
    const l = layers[i]!;
    if (l.id === targetId) {
      if (where === "into" && l.type === "group") {
        l.children.push(source as Layer);
        return true;
      }
      const idx = where === "before" ? i : i + 1;
      layers.splice(idx, 0, source);
      return true;
    }
    if (l.type === "group") {
      if (insertRelative(l.children as T[], source, targetId, where)) return true;
    }
  }
  return false;
}
