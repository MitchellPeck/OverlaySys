import { Eye, EyeOff, Lock, Unlock } from "lucide-react";
import { STAGE_WIDGET_LABELS, type StageLayout } from "@overlaysys/core";

const ICON = 14;

type Props = {
  layout: StageLayout;
  selectedIds: string[];
  /** `additive` is true on Shift-click. */
  onSelect: (id: string, additive: boolean) => void;
  /** `to` is the target index in `layout.widgets` (array order = z-order). */
  onReorder: (id: string, to: number) => void;
  onToggleHidden: (id: string) => void;
  onToggleLocked: (id: string) => void;
};

/** Widgets listed top-of-z-order first. */
export function StageWidgetList({ layout, selectedIds, onSelect, onReorder, onToggleHidden, onToggleLocked }: Props) {
  const last = layout.widgets.length - 1;
  const rows = layout.widgets.map((w, index) => ({ w, index })).reverse();
  if (rows.length === 0) {
    return <p style={{ color: "var(--text-dim, #9099a8)", fontSize: 12, padding: 8 }}>No widgets. Add one from the palette.</p>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {rows.map(({ w, index }) => {
        const selected = selectedIds.includes(w.id);
        return (
          <div
            key={w.id}
            onClick={(e) => onSelect(w.id, e.shiftKey)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "3px 6px",
              fontSize: 12,
              cursor: "pointer",
              borderRadius: 3,
              background: selected ? "var(--accent-dim, #2a3f6a)" : "transparent",
              opacity: w.hidden ? 0.5 : 1,
            }}
          >
            <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {STAGE_WIDGET_LABELS[w.kind]}
              {w.style.label ? ` (${w.style.label})` : ""}
            </span>
            <button
              type="button"
              title={w.hidden ? "Show" : "Hide"}
              aria-label={w.hidden ? "Show" : "Hide"}
              onClick={(e) => { e.stopPropagation(); onToggleHidden(w.id); }}
            >
              {w.hidden ? <EyeOff size={ICON} aria-hidden /> : <Eye size={ICON} aria-hidden />}
            </button>
            <button
              type="button"
              title={w.locked ? "Unlock" : "Lock"}
              aria-label={w.locked ? "Unlock" : "Lock"}
              onClick={(e) => { e.stopPropagation(); onToggleLocked(w.id); }}
            >
              {w.locked ? <Lock size={ICON} aria-hidden /> : <Unlock size={ICON} aria-hidden />}
            </button>
            <button
              type="button"
              title="Bring forward"
              disabled={index === last}
              onClick={(e) => { e.stopPropagation(); onReorder(w.id, index + 1); }}
            >
              ↑
            </button>
            <button
              type="button"
              title="Send backward"
              disabled={index === 0}
              onClick={(e) => { e.stopPropagation(); onReorder(w.id, index - 1); }}
            >
              ↓
            </button>
          </div>
        );
      })}
    </div>
  );
}
