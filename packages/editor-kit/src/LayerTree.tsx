import type { Draft } from "immer";
import { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Eye,
  EyeOff,
  Film,
  Folder,
  Image as ImageIcon,
  Lock,
  Square,
  Trash2,
  Type,
  Unlock,
  type LucideIcon,
} from "lucide-react";
import type { Layer, Template } from "@overlaysys/core";
import { flattenLayersForDisplay, moveLayer } from "./utils";
import { duplicateLayers, moveLayersZ, newLayerId, removeLayers, toggleLayerLocked, toggleLayerVisible } from "./templateOps";

type Props = {
  template: Template;
  selectedId: string | null;
  /** Every selected layer; defaults to the primary alone. */
  selectedIds?: string[];
  onSelect: (id: string | null) => void;
  /** Replace the selection, or toggle ids in/out of it (Shift / ⌘-click). Falls back to onSelect. */
  onSelectLayers?: (ids: string[], additive: boolean) => void;
  /** Mutate draft + history. */
  onCommit: (recipe: (d: Draft<Template>) => void) => void;
};

const ICON = 14;

const ICON_BY_TYPE: Record<Layer["type"], LucideIcon> = {
  text: Type,
  image: ImageIcon,
  video: Film,
  shape: Square,
  group: Folder,
};

type DropZone = "before" | "into" | "after";

export function LayerTree({ template, selectedId, selectedIds: selectedIdsProp, onSelect, onSelectLayers, onCommit }: Props) {
  // Photoshop ordering: top of panel = on top of z-stack, with group children
  // expanding beneath their header. flattenLayersForDisplay handles both.
  const flat = flattenLayersForDisplay(template.layers);
  const selectedIds = selectedIdsProp ?? (selectedId ? [selectedId] : []);
  const select = (ids: string[], additive: boolean) => {
    if (onSelectLayers) onSelectLayers(ids, additive);
    else onSelect(ids[ids.length - 1] ?? null);
  };
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
      <Toolbar selectedIds={selectedIds} onCommit={onCommit} onSelect={select} />

      {flat.length === 0 ? (
        <p style={{ color: "var(--text-dim, #9099a8)", fontSize: 12, padding: 8 }}>
          Empty template. Use the toolbar to add a layer.
        </p>
      ) : (
        <ul role="listbox" aria-label="Layers" aria-multiselectable style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {flat.map(({ layer, depth }) => {
            const selected = selectedIds.includes(layer.id);
            const TypeIcon = ICON_BY_TYPE[layer.type] ?? Square;
            const isDragging = dragId === layer.id;
            const dt = dropTarget?.id === layer.id ? dropTarget.zone : null;
            return (
              <li
                key={layer.id}
                role="option"
                aria-selected={selected}
                aria-label={`${layer.name} (${layer.type}${layer.visible ? "" : ", hidden"}${layer.locked ? ", locked" : ""})`}
                tabIndex={0}
                draggable
                onClick={(e) => select([layer.id], e.shiftKey || e.metaKey || e.ctrlKey)}
                onKeyDown={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.key === "Enter" || e.key === " ") {
                    // Keep Space from also reaching the page's play/pause shortcut.
                    e.preventDefault();
                    e.stopPropagation();
                    select([layer.id], e.shiftKey || e.metaKey || e.ctrlKey);
                  } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                    e.preventDefault();
                    e.stopPropagation();
                    const sib = (e.key === "ArrowDown"
                      ? e.currentTarget.nextElementSibling
                      : e.currentTarget.previousElementSibling) as HTMLElement | null;
                    sib?.focus();
                  }
                }}
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
                <TypeIcon size={ICON} aria-hidden style={{ flexShrink: 0, color: "var(--text-dim, #9099a8)" }} />
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {layer.name}
                </span>
                <button
                  type="button"
                  title={layer.visible ? "Hide" : "Show"}
                  aria-label={`${layer.visible ? "Hide" : "Show"} ${layer.name}`}
                  aria-pressed={!layer.visible}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCommit(toggleLayerVisible(layer.id));
                  }}
                  style={iconBtn}
                >
                  {layer.visible ? <Eye size={ICON} aria-hidden /> : <EyeOff size={ICON} aria-hidden />}
                </button>
                <button
                  type="button"
                  title={layer.locked ? "Unlock" : "Lock"}
                  aria-label={`${layer.locked ? "Unlock" : "Lock"} ${layer.name}`}
                  aria-pressed={!!layer.locked}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCommit(toggleLayerLocked(layer.id));
                  }}
                  style={{ ...iconBtn, opacity: layer.locked ? 1 : 0.45 }}
                >
                  {layer.locked ? <Lock size={ICON} aria-hidden /> : <Unlock size={ICON} aria-hidden />}
                </button>
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
  selectedIds,
  onCommit,
  onSelect,
}: {
  selectedIds: string[];
  onCommit: (recipe: (d: Draft<Template>) => void) => void;
  onSelect: (ids: string[], additive: boolean) => void;
}) {
  const none = selectedIds.length === 0;

  function add(type: Layer["type"]) {
    const id = newLayerId(type);
    onCommit((d) => {
      const layer: Layer = makeLayer(type, id);
      d.layers.push(layer);
    });
    onSelect([id], false);
  }

  // Copies keep their animation tracks and become the selection.
  function duplicate() {
    if (none) return;
    const created: string[] = [];
    onCommit(duplicateLayers(selectedIds, created));
    if (created.length > 0) onSelect(created, false);
  }

  // Also drops the layers' tracks and any clipBy that referenced them.
  function remove() {
    if (none) return;
    onCommit(removeLayers(selectedIds));
    onSelect([], false);
  }

  return (
    <div style={{ display: "flex", gap: 4, marginBottom: 8, flexWrap: "wrap" }}>
      <ToolBtn onClick={() => add("text")}>+ Text</ToolBtn>
      <ToolBtn onClick={() => add("shape")}>+ Shape</ToolBtn>
      <ToolBtn onClick={() => add("image")}>+ Image</ToolBtn>
      <ToolBtn onClick={() => add("video")}>+ Video</ToolBtn>
      <ToolBtn onClick={() => add("group")}>+ Group</ToolBtn>
      <div style={{ width: 1, background: "var(--border, #2a2e36)", margin: "0 4px" }} />
      <ToolBtn onClick={() => onCommit(moveLayersZ(selectedIds, "up"))} disabled={none} label="Bring forward (⌘])">
        <ChevronUp size={ICON} aria-hidden />
      </ToolBtn>
      <ToolBtn onClick={() => onCommit(moveLayersZ(selectedIds, "down"))} disabled={none} label="Send backward (⌘[)">
        <ChevronDown size={ICON} aria-hidden />
      </ToolBtn>
      <ToolBtn onClick={duplicate} disabled={none} label="Duplicate (⌘D)">
        <Copy size={ICON} aria-hidden />
      </ToolBtn>
      <ToolBtn onClick={remove} disabled={none} kind="danger" label="Delete (Del)">
        <Trash2 size={ICON} aria-hidden />
      </ToolBtn>
    </div>
  );
}

function ToolBtn({
  children,
  onClick,
  disabled,
  kind,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  kind?: "danger";
  /** Accessible name + tooltip for icon-only buttons. */
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      style={{
        display: "inline-flex",
        alignItems: "center",
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

const iconBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  background: "transparent",
  border: "none",
  color: "var(--text-dim, #9099a8)",
  padding: 2,
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

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
