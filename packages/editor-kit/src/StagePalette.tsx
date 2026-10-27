import { STAGE_WIDGET_LABELS, type StageWidgetKind } from "@overlaysys/core";

export const STAGE_WIDGET_DRAG_TYPE = "application/x-stage-widget";

type Props = { onAdd: (kind: StageWidgetKind) => void };

/** One button per widget kind. Click adds; dragging onto the canvas drops at the pointer. */
export function StagePalette({ onAdd }: Props) {
  const kinds = Object.keys(STAGE_WIDGET_LABELS) as StageWidgetKind[];
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {kinds.map((kind) => (
        <button
          key={kind}
          type="button"
          draggable
          onClick={() => onAdd(kind)}
          onDragStart={(e) => {
            e.dataTransfer.setData(STAGE_WIDGET_DRAG_TYPE, kind);
            e.dataTransfer.effectAllowed = "copy";
          }}
          style={{ cursor: "grab", fontSize: 12, padding: "4px 8px" }}
        >
          + {STAGE_WIDGET_LABELS[kind]}
        </button>
      ))}
    </div>
  );
}
