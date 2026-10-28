import { useState } from "react";
import { ChevronDown, ChevronUp, Eye, EyeOff, Lock, Unlock } from "lucide-react";
import { STAGE_WIDGET_LABELS, type StageLayout, type StageWidget } from "@overlaysys/core";
import { IconButton, colors, fontSize, radius } from "@overlaysys/ui";

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

/** The custom label is the primary name; the kind is the muted secondary. */
function names(w: StageWidget): { primary: string; secondary?: string } {
  const kind = STAGE_WIDGET_LABELS[w.kind];
  return w.style.label ? { primary: w.style.label, secondary: kind } : { primary: kind };
}

function Row({
  w,
  index,
  last,
  selected,
  props,
}: {
  w: StageWidget;
  index: number;
  last: number;
  selected: boolean;
  props: Props;
}) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const { primary, secondary } = names(w);
  // The eye and lock show on hover, focus or selection; a hidden or locked widget keeps its icon visible.
  const showTools = hover || focus || selected;
  const tool = (always: boolean) => ({ opacity: always || showTools ? 1 : 0 });
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocusCapture={() => setFocus(true)}
      onBlurCapture={() => setFocus(false)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 2,
        borderRadius: radius.md,
        background: selected ? colors.surface2 : hover ? colors.surface : "transparent",
        boxShadow: selected ? `inset 2px 0 0 ${colors.accent}` : undefined,
        opacity: w.hidden ? 0.55 : 1,
      }}
    >
      <button
        type="button"
        aria-pressed={selected}
        onClick={(e) => props.onSelect(w.id, e.shiftKey)}
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 28,
          display: "flex",
          alignItems: "baseline",
          gap: 6,
          padding: "0 8px",
          background: "transparent",
          border: "none",
          borderRadius: radius.md,
          color: colors.text,
          fontFamily: "inherit",
          fontSize: fontSize.base,
          textAlign: "left",
          cursor: "pointer",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{primary}</span>
        {secondary && <span style={{ color: colors.textMuted, fontSize: fontSize.sm, whiteSpace: "nowrap" }}>{secondary}</span>}
      </button>
      <span style={{ display: "flex", gap: 2, paddingRight: 2 }}>
        <IconButton
          size={24}
          title={w.hidden ? "Show" : "Hide"}
          aria-label={`${w.hidden ? "Show" : "Hide"} ${primary}`}
          style={{ ...tool(w.hidden === true), border: "none" }}
          onClick={() => props.onToggleHidden(w.id)}
        >
          {w.hidden ? <EyeOff size={ICON} aria-hidden /> : <Eye size={ICON} aria-hidden />}
        </IconButton>
        <IconButton
          size={24}
          title={w.locked ? "Unlock" : "Lock"}
          aria-label={`${w.locked ? "Unlock" : "Lock"} ${primary}`}
          style={{ ...tool(w.locked === true), border: "none" }}
          onClick={() => props.onToggleLocked(w.id)}
        >
          {w.locked ? <Lock size={ICON} aria-hidden /> : <Unlock size={ICON} aria-hidden />}
        </IconButton>
        <IconButton
          size={24}
          title="Bring forward (⌘])"
          aria-label={`Bring ${primary} forward`}
          disabled={index === last}
          style={{ ...tool(false), border: "none" }}
          onClick={() => props.onReorder(w.id, index + 1)}
        >
          <ChevronUp size={ICON} aria-hidden />
        </IconButton>
        <IconButton
          size={24}
          title="Send backward (⌘[)"
          aria-label={`Send ${primary} backward`}
          disabled={index === 0}
          style={{ ...tool(false), border: "none" }}
          onClick={() => props.onReorder(w.id, index - 1)}
        >
          <ChevronDown size={ICON} aria-hidden />
        </IconButton>
      </span>
    </div>
  );
}

/** Widgets listed top-of-z-order first. */
export function StageWidgetList(props: Props) {
  const { layout, selectedIds } = props;
  const last = layout.widgets.length - 1;
  const rows = layout.widgets.map((w, index) => ({ w, index })).reverse();
  if (rows.length === 0) {
    return <p style={{ color: colors.textDim, fontSize: fontSize.sm, padding: 8 }}>No widgets. Add one from the palette.</p>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      {rows.map(({ w, index }) => (
        <Row key={w.id} w={w} index={index} last={last} selected={selectedIds.includes(w.id)} props={props} />
      ))}
    </div>
  );
}
