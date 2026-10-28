import { Plus } from "lucide-react";
import { STAGE_WIDGET_LABELS, type StageWidgetKind } from "@overlaysys/core";
import { Button } from "@overlaysys/ui";

export const STAGE_WIDGET_DRAG_TYPE = "application/x-stage-widget";

type Props = { onAdd: (kind: StageWidgetKind) => void };

/** One button per widget kind. Click adds; dragging onto the canvas drops at the pointer. */
export function StagePalette({ onAdd }: Props) {
  const kinds = Object.keys(STAGE_WIDGET_LABELS) as StageWidgetKind[];
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {kinds.map((kind) => (
        <Button
          key={kind}
          size="sm"
          icon={<Plus size={12} aria-hidden />}
          draggable
          aria-label={`Add ${STAGE_WIDGET_LABELS[kind]}`}
          onClick={() => onAdd(kind)}
          onDragStart={(e) => {
            e.dataTransfer.setData(STAGE_WIDGET_DRAG_TYPE, kind);
            e.dataTransfer.effectAllowed = "copy";
          }}
          style={{ cursor: "grab" }}
        >
          {STAGE_WIDGET_LABELS[kind]}
        </Button>
      ))}
    </div>
  );
}
