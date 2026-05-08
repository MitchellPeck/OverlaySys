import type { Draft } from "immer";
import { useState } from "react";
import type { Layer, Template } from "@overlaysys/core";
import { flattenLayersForDisplay, moveLayer } from "./utils";

type Props = {
  template: Template;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Mutate draft + history. */
  onCommit: (recipe: (d: Draft<Template>) => void) => void;
};

const ICON_BY_TYPE: Record<string, string> = {
  text: "T",
  image: "🖼",
  shape: "▭",
  group: "📁",
};

type DropZone = "before" | "into" | "after";

export function LayerTree({ template, selectedId, onSelect, onCommit }: Props) {
  // Photoshop ordering: top of panel = on top of z-stack, with group children
  // expanding beneath their header. flattenLayersForDisplay handles both.
  const flat = flattenLayersForDisplay(template.layers);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; zone: DropZone } | null>(null);

  function computeZone(e: React.DragEvent, isGroup: boolean): DropZone {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = e.clientY - r.top;
    const h = r.height;
    if (!isGroup) {
      return y < h / 2 ? "before" : "after";
    }
    // Groups get a 3-band: top quarter = before, middle half = into, bottom quarter = after.
    if (y < h * 0.25) return "before";
    if (y > h * 0.75) return "after";
    return "into";
  }

  return (
    <div>
      <Toolbar selectedId={selectedId} onCommit={onCommit} onSelect={onSelect} />

      {flat.length === 0 ? (
        <p style={{ color: "var(--text-dim, #9099a8)", fontSize: 12, padding: 8 }}>
          Empty template. Use the toolbar to add a layer.
        </p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {flat.map(({ layer, depth }) => {
            const selected = layer.id === selectedId;
            const isDragging = dragId === layer.id;
            const dt = dropTarget?.id === layer.id ? dropTarget.zone : null;
            return (
              <li
                key={layer.id}
                draggable
                onClick={() => onSelect(layer.id)}
                onDragStart={(e) => {
                  setDragId(layer.id);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", layer.id);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (dragId === layer.id) return;
                  setDropTarget({ id: layer.id, zone: computeZone(e, layer.type === "group") });
                }}
                onDragLeave={() => {
                  setDropTarget((cur) => (cur?.id === layer.id ? null : cur));
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const sourceId = e.dataTransfer.getData("text/plain") || dragId;
                  const target = dropTarget;
                  setDragId(null);
                  setDropTarget(null);
                  if (!sourceId || !target) return;
                  if (sourceId === target.id) return;
                  // The visual list is reversed (top of panel = last in array,
                  // matching Photoshop z-order). moveLayer operates on the
                  // underlying array, so a "drop above X visually" means
                  // "insert AFTER X in the array" and vice versa. `into` is
                  // unaffected by reversal.
                  const actualWhere =
                    target.zone === "before"
                      ? "after"
                      : target.zone === "after"
                        ? "before"
                        : "into";
                  onCommit((d) => {
                    moveLayer(d.layers, sourceId, target.id, actualWhere);
                  });
                }}
                onDragEnd={() => {
                  setDragId(null);
                  setDropTarget(null);
                }}
                style={{
                  position: "relative",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 8px",
                  paddingLeft: 8 + depth * 16,
                  cursor: "pointer",
                  fontSize: 13,
                  background:
                    dt === "into"
                      ? "rgba(74,222,128,0.18)"
                      : selected
                        ? "rgba(74, 222, 128, 0.10)"
                        : "transparent",
                  borderLeft: selected ? "2px solid #4ade80" : "2px solid transparent",
                  color: layer.visible === false ? "var(--text-dim, #9099a8)" : "inherit",
                  opacity: isDragging ? 0.5 : 1,
                }}
              >
                {dt === "before" && <DropLine position="top" />}
                {dt === "after" && <DropLine position="bottom" />}
                <button
                  title={layer.visible ? "Hide" : "Show"}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCommit((d) => {
                      const l = findInDraft(d.layers, layer.id);
                      if (l) l.visible = !l.visible;
                    });
                  }}
                  style={visBtn}
                >
                  {layer.visible ? "👁" : "—"}
                </button>
                <span style={{ width: 16, fontSize: 11, color: "var(--text-dim, #9099a8)", textAlign: "center" }}>
                  {ICON_BY_TYPE[layer.type] ?? "?"}
                </span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {layer.name}
                </span>
                <span style={{ fontSize: 10, color: "var(--text-dim, #9099a8)" }}>{layer.type}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function DropLine({ position }: { position: "top" | "bottom" }) {
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        [position]: -1,
        height: 2,
        background: "#4ade80",
        boxShadow: "0 0 6px rgba(74,222,128,0.8)",
        pointerEvents: "none",
      }}
    />
  );
}

function Toolbar({
  selectedId,
  onCommit,
  onSelect,
}: {
  selectedId: string | null;
  onCommit: (recipe: (d: Draft<Template>) => void) => void;
  onSelect: (id: string | null) => void;
}) {
  function add(type: Layer["type"]) {
    const id = `${type}-${Math.random().toString(36).slice(2, 8)}`;
    onCommit((d) => {
      const layer: Layer = makeLayer(type, id);
      d.layers.push(layer);
    });
    onSelect(id);
  }

  function duplicate() {
    if (!selectedId) return;
    onCommit((d) => {
      const idx = topLevelIndex(d.layers, selectedId);
      if (idx === -1) {
        // Selected layer is nested — duplicate inside its parent group.
        duplicateInTree(d.layers, selectedId);
        return;
      }
      const original = d.layers[idx]!;
      const copy = JSON.parse(JSON.stringify(original)) as Layer;
      reassignIds(copy);
      d.layers.splice(idx + 1, 0, copy);
    });
  }

  function remove() {
    if (!selectedId) return;
    onCommit((d) => {
      // Collect every id in the deleted subtree (the layer + all descendants
      // for groups) so the timeline cleanup catches nested layers too.
      const removedIds = new Set<string>();
      collectLayerIds(d.layers, selectedId, removedIds);
      removeLayerById(d.layers, selectedId);
      if (removedIds.size > 0) {
        d.timelines.in.tracks = d.timelines.in.tracks.filter(
          (t) => !removedIds.has(t.layerId),
        );
        d.timelines.out.tracks = d.timelines.out.tracks.filter(
          (t) => !removedIds.has(t.layerId),
        );
        if (d.timelines.loop) {
          d.timelines.loop.tracks = d.timelines.loop.tracks.filter(
            (t) => !removedIds.has(t.layerId),
          );
        }
      }
    });
    onSelect(null);
  }

  return (
    <div style={{ display: "flex", gap: 4, marginBottom: 8, flexWrap: "wrap" }}>
      <ToolBtn onClick={() => add("text")}>+ Text</ToolBtn>
      <ToolBtn onClick={() => add("shape")}>+ Shape</ToolBtn>
      <ToolBtn onClick={() => add("image")}>+ Image</ToolBtn>
      <ToolBtn onClick={() => add("video")}>+ Video</ToolBtn>
      <ToolBtn onClick={() => add("group")}>+ Group</ToolBtn>
      <div style={{ width: 1, background: "var(--border, #2a2e36)", margin: "0 4px" }} />
      <ToolBtn onClick={duplicate} disabled={!selectedId}>Dup</ToolBtn>
      <ToolBtn onClick={remove} disabled={!selectedId} kind="danger">Del</ToolBtn>
    </div>
  );
}

function ToolBtn({
  children,
  onClick,
  disabled,
  kind,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  kind?: "danger";
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "4px 8px",
        background: kind === "danger" ? "transparent" : "var(--panel-2, #1c1f25)",
        color: kind === "danger" ? "var(--red, #f87171)" : "var(--text, #e9eaee)",
        border:
          kind === "danger"
            ? "1px solid var(--red, #f87171)"
            : "1px solid var(--border, #2a2e36)",
        borderRadius: 3,
        fontSize: 11,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
      }}
    >
      {children}
    </button>
  );
}

const visBtn: React.CSSProperties = {
  background: "transparent",
  border: "none",
  color: "var(--text-dim, #9099a8)",
  fontSize: 12,
  padding: 0,
  width: 14,
  cursor: "pointer",
};

// ───── Layer factories & tree mutations (work on Immer drafts) ──────────────

function makeLayer(type: Layer["type"], id: string): Layer {
  const base = {
    id,
    name: capitalize(type),
    visible: true,
    transform: {
      x: 100,
      y: 100,
      w: 400,
      h: 100,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: 1,
      anchorX: 0,
      anchorY: 0,
    },
  };
  switch (type) {
    case "text":
      return {
        ...base,
        type: "text",
        content: "Hello",
        style: {
          fontFamily: "Inter, system-ui, sans-serif",
          fontSize: 48,
          fontWeight: 600,
          italic: false,
          underline: false,
          color: "#ffffff",
          letterSpacing: 0,
          lineHeight: 1.1,
          align: "left",
          verticalAlign: "top",
        },
      };
    case "shape":
      return {
        ...base,
        type: "shape",
        shape: "rect",
        fill: { kind: "solid", color: "#ff3a3a" },
        cornerRadius: 0,
        sides: 6,
        starPoints: 5,
        starInnerRatio: 0.5,
        blur: 0,
      };
    case "image":
      return { ...base, type: "image", src: "", fit: "cover" };
    case "video":
      return {
        ...base,
        type: "video",
        src: "",
        fit: "cover",
        loop: true,
        autoplay: true,
        muted: true,
        playbackRate: 1,
        trimStart: 0,
        trimEnd: 0,
        crop: { left: 0, top: 0, right: 1, bottom: 1 },
      };
    case "group":
      return { ...base, type: "group", children: [] };
  }
}

function findInDraft(layers: Draft<Layer>[], id: string): Draft<Layer> | null {
  for (const l of layers) {
    if (l.id === id) return l;
    if (l.type === "group") {
      const f = findInDraft(l.children, id);
      if (f) return f;
    }
  }
  return null;
}

function topLevelIndex(layers: Layer[], id: string): number {
  return layers.findIndex((l) => l.id === id);
}

function removeLayerById(layers: Draft<Layer>[], id: string): boolean {
  for (let i = 0; i < layers.length; i++) {
    if (layers[i]!.id === id) {
      layers.splice(i, 1);
      return true;
    }
    const l = layers[i]!;
    if (l.type === "group" && removeLayerById(l.children, id)) return true;
  }
  return false;
}

/**
 * Walk the tree to find `targetId` and collect its id plus every
 * descendant id (for groups). Used to clean up timeline tracks for any
 * layer that's about to be removed.
 */
function collectLayerIds(layers: Draft<Layer>[], targetId: string, out: Set<string>): boolean {
  for (const l of layers) {
    if (l.id === targetId) {
      collectAllIds(l, out);
      return true;
    }
    if (l.type === "group") {
      if (collectLayerIds(l.children, targetId, out)) return true;
    }
  }
  return false;
}
function collectAllIds(layer: Draft<Layer>, out: Set<string>): void {
  out.add(layer.id);
  if (layer.type === "group") {
    for (const c of layer.children) collectAllIds(c, out);
  }
}

function duplicateInTree(layers: Draft<Layer>[], id: string): boolean {
  for (let i = 0; i < layers.length; i++) {
    if (layers[i]!.id === id) {
      const copy = JSON.parse(JSON.stringify(layers[i])) as Layer;
      reassignIds(copy);
      layers.splice(i + 1, 0, copy as Draft<Layer>);
      return true;
    }
    const l = layers[i]!;
    if (l.type === "group" && duplicateInTree(l.children, id)) return true;
  }
  return false;
}

function reassignIds(layer: Layer): void {
  layer.id = `${layer.type}-${Math.random().toString(36).slice(2, 8)}`;
  if (layer.type === "group") for (const c of layer.children) reassignIds(c);
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
