import { useEffect, useState, type ReactNode } from "react";
import type { StageLayout, StageWidget } from "@overlaysys/core";
import { ColorInput } from "./ColorInput";
import { FontInput } from "./FontInput";
import { MIN_WIDGET_SIZE, type AlignMode } from "./stageGeometry";
import {
  decodeTimerSource,
  encodeTimerSource,
  parseNumberDraft,
  timerSourceOptions,
  type StageWidgetPatch,
  type StageWidgetPropsPatch,
} from "./stageInspectorLogic";

type Props = {
  layout: StageLayout;
  selectedIds: string[];
  onPatch: (id: string, patch: StageWidgetPatch) => void;
  onAlign: (mode: AlignMode) => void;
  onDistribute: (axis: "x" | "y") => void;
  timerChoices: { id: string; label: string }[];
  channelChoices: { id: string; name: string }[];
};

const ALIGN_BUTTONS: { mode: AlignMode; label: string }[] = [
  { mode: "left", label: "Align left" },
  { mode: "hcenter", label: "Align center" },
  { mode: "right", label: "Align right" },
  { mode: "top", label: "Align top" },
  { mode: "vcenter", label: "Align middle" },
  { mode: "bottom", label: "Align bottom" },
];

const NO_FONTS: { family: string; src: string }[] = [];
const noop = () => {};

/** `group` renders a div, for rows of buttons (a <label> would forward clicks to the first button). */
function Row({ label, children, group }: { label: string; children: ReactNode; group?: boolean }) {
  const Tag = group ? "div" : "label";
  return (
    <Tag style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 12, margin: "4px 0" }}>
      <span style={{ color: "var(--text-dim, #9099a8)" }}>{label}</span>
      {children}
    </Tag>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset style={{ border: "1px solid var(--border, #2a2e36)", borderRadius: 4, margin: "8px 0", padding: "4px 8px" }}>
      <legend style={{ fontSize: 11, textTransform: "uppercase", color: "var(--text-dim, #9099a8)" }}>{title}</legend>
      {children}
    </fieldset>
  );
}

/** Edits a local draft string; commits (parsed + clamped) on blur or Enter. */
function NumberField(props: { value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number; int?: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => setDraft(null), [props.value]);
  function commit() {
    if (draft === null) return;
    const n = parseNumberDraft(draft, { min: props.min, max: props.max, step: props.step, int: props.int });
    setDraft(null);
    if (n !== null && n !== props.value) props.onChange(n);
  }
  return (
    <input
      type="number"
      value={draft ?? (Number.isFinite(props.value) ? String(props.value) : "0")}
      min={props.min}
      max={props.max}
      step={props.step}
      style={{ width: 80 }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        else if (e.key === "Escape") setDraft(null);
      }}
    />
  );
}

function Check(props: { value: boolean; onChange: (b: boolean) => void }) {
  return <input type="checkbox" checked={props.value} onChange={(e) => props.onChange(e.target.checked)} />;
}

function Slider(props: { value: number; onChange: (n: number) => void; min: number; max: number; step: number }) {
  return (
    <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(e.target.valueAsNumber)}
      />
      <span style={{ width: 32, textAlign: "right", fontSize: 11 }}>{props.value}</span>
    </span>
  );
}

function Segmented<T extends string>(props: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <span style={{ display: "flex", gap: 2 }}>
      {props.options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => props.onChange(o.value)}
          style={{ fontWeight: o.value === props.value ? 700 : 400, opacity: o.value === props.value ? 1 : 0.7 }}
        >
          {o.label}
        </button>
      ))}
    </span>
  );
}

export function StageInspector({ layout, selectedIds, onPatch, onAlign, onDistribute, timerChoices, channelChoices }: Props) {
  const selected = layout.widgets.filter((w) => selectedIds.includes(w.id));

  if (selected.length === 0) {
    return <p style={{ color: "var(--text-dim, #9099a8)", fontSize: 12, padding: 8 }}>Select a widget to edit it.</p>;
  }

  if (selected.length >= 2) {
    return (
      <div style={{ padding: 8 }}>
        <Section title={`${selected.length} widgets`}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {ALIGN_BUTTONS.map((b) => (
              <button key={b.mode} type="button" onClick={() => onAlign(b.mode)}>
                {b.label}
              </button>
            ))}
          </div>
          {selected.length >= 3 && (
            <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
              <button type="button" onClick={() => onDistribute("x")}>Distribute horizontally</button>
              <button type="button" onClick={() => onDistribute("y")}>Distribute vertically</button>
            </div>
          )}
        </Section>
        <p style={{ fontSize: 11, color: "var(--text-dim, #9099a8)" }}>Press Delete to remove the selected widgets.</p>
      </div>
    );
  }

  const w = selected[0]!;
  const patch = (p: StageWidgetPatch) => onPatch(w.id, p);
  const setStyle = (style: NonNullable<StageWidgetPatch["style"]>) => patch({ style });
  const setProps = (props: StageWidgetPropsPatch) => patch({ props });
  const s = w.style;

  return (
    <div style={{ padding: 8 }}>
      <Section title="Rect">
        <Row label="x"><NumberField value={w.rect.x} onChange={(x) => patch({ rect: { x } })} /></Row>
        <Row label="y"><NumberField value={w.rect.y} onChange={(y) => patch({ rect: { y } })} /></Row>
        <Row label="w"><NumberField value={w.rect.w} min={MIN_WIDGET_SIZE} onChange={(v) => patch({ rect: { w: v } })} /></Row>
        <Row label="h"><NumberField value={w.rect.h} min={MIN_WIDGET_SIZE} onChange={(v) => patch({ rect: { h: v } })} /></Row>
      </Section>

      <Section title="Style">
        <Row label="Font">
          <FontInput value={s.fontFamily} templateFonts={NO_FONTS} onChange={(fontFamily) => setStyle({ fontFamily })} onAddFont={noop} />
        </Row>
        <Row label="Size"><NumberField value={s.fontSize} min={1} onChange={(fontSize) => setStyle({ fontSize })} /></Row>
        <Row label="Weight">
          <NumberField value={s.fontWeight} min={100} max={900} step={100} onChange={(fontWeight) => setStyle({ fontWeight })} />
        </Row>
        <Row label="Color"><ColorInput value={s.color} onChange={(color) => setStyle({ color })} /></Row>
        <Row group label="Background">
          <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {s.background !== undefined ? (
              <>
                <ColorInput value={s.background} onChange={(background) => setStyle({ background })} />
                <button type="button" onClick={() => setStyle({ background: undefined })}>Remove</button>
              </>
            ) : (
              <button type="button" onClick={() => setStyle({ background: "#000000" })}>Add background</button>
            )}
          </span>
        </Row>
        <Row label="Padding"><NumberField value={s.padding} min={0} onChange={(padding) => setStyle({ padding })} /></Row>
        <Row group label="Align">
          <Segmented
            value={s.align}
            options={[{ value: "left", label: "L" }, { value: "center", label: "C" }, { value: "right", label: "R" }]}
            onChange={(align) => setStyle({ align })}
          />
        </Row>
        <Row group label="Vertical">
          <Segmented
            value={s.vAlign}
            options={[{ value: "top", label: "T" }, { value: "middle", label: "M" }, { value: "bottom", label: "B" }]}
            onChange={(vAlign) => setStyle({ vAlign })}
          />
        </Row>
        <Row group label="Auto-fit"><Check value={s.autoFit} onChange={(autoFit) => setStyle({ autoFit })} /></Row>
        <Row label="Label">
          <input
            type="text"
            value={s.label ?? ""}
            onChange={(e) => setStyle({ label: e.target.value === "" ? undefined : e.target.value })}
          />
        </Row>
        <Row label="Border width">
          <NumberField
            value={s.border?.width ?? 0}
            min={0}
            onChange={(width) =>
              setStyle({ border: width === 0 ? undefined : { width, color: s.border?.color ?? "#ffffff", radius: s.border?.radius ?? 0 } })
            }
          />
        </Row>
        {s.border && (
          <>
            <Row label="Border color">
              <ColorInput value={s.border.color} onChange={(color) => setStyle({ border: { ...s.border!, color } })} />
            </Row>
            <Row label="Border radius">
              <NumberField value={s.border.radius} min={0} onChange={(radius) => setStyle({ border: { ...s.border!, radius } })} />
            </Row>
          </>
        )}
      </Section>

      <Section title="Props">
        {renderProps(w, setProps, timerChoices, channelChoices)}
      </Section>
    </div>
  );
}

function renderProps(
  w: StageWidget,
  set: (props: StageWidgetPropsPatch) => void,
  timerChoices: { id: string; label: string }[],
  channelChoices: { id: string; name: string }[],
): ReactNode {
  switch (w.kind) {
    case "currentSlide":
      return <Row group label="Show reference"><Check value={w.props.showReference} onChange={(showReference) => set({ showReference })} /></Row>;
    case "nextSlide":
      return (
        <>
          <Row label="Max lines">
            <NumberField value={w.props.maxLines} min={1} max={10} int onChange={(maxLines) => set({ maxLines })} />
          </Row>
          <Row label="Dim opacity">
            <Slider value={w.props.dimOpacity} min={0} max={1} step={0.05} onChange={(dimOpacity) => set({ dimOpacity })} />
          </Row>
        </>
      );
    case "rowTitle":
      return (
        <>
          <Row group label="Show next"><Check value={w.props.showNext} onChange={(showNext) => set({ showNext })} /></Row>
          <Row group label="Prefer">
            <Segmented
              value={w.props.prefer}
              options={[{ value: "rundown", label: "Rundown" }, { value: "pco", label: "PCO" }]}
              onChange={(prefer) => set({ prefer })}
            />
          </Row>
        </>
      );
    case "rowCue":
      return <Row group label="Include next row"><Check value={w.props.includeNextRow} onChange={(includeNextRow) => set({ includeNextRow })} /></Row>;
    case "clock":
      return (
        <>
          <Row group label="Format">
            <Segmented
              value={w.props.format}
              options={[{ value: "12h", label: "12h" }, { value: "24h", label: "24h" }]}
              onChange={(format) => set({ format })}
            />
          </Row>
          <Row group label="Seconds"><Check value={w.props.seconds} onChange={(seconds) => set({ seconds })} /></Row>
        </>
      );
    case "timer":
      return (
        <>
          <Row label="Source">
            <select
              value={encodeTimerSource(w.props.source)}
              onChange={(e) => set({ source: decodeTimerSource(e.target.value) })}
            >
              {timerSourceOptions(w.props.source, channelChoices, timerChoices).map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </Row>
          <Row label="Warn below (s)"><NumberField value={w.props.warnBelowSec} min={0} onChange={(warnBelowSec) => set({ warnBelowSec })} /></Row>
          <Row label="Warn color"><ColorInput value={w.props.warnColor} onChange={(warnColor) => set({ warnColor })} /></Row>
          <Row label="Over color"><ColorInput value={w.props.overColor} onChange={(overColor) => set({ overColor })} /></Row>
          <Row group label="Show label"><Check value={w.props.showLabel} onChange={(showLabel) => set({ showLabel })} /></Row>
        </>
      );
    case "videoRemaining":
      return <Row label="Warn below (s)"><NumberField value={w.props.warnBelowSec} min={0} onChange={(warnBelowSec) => set({ warnBelowSec })} /></Row>;
    case "sermonNotes":
      return (
        <>
          <Row label="Highlight color"><ColorInput value={w.props.highlightColor} onChange={(highlightColor) => set({ highlightColor })} /></Row>
          <Row group label="Dim past"><Check value={w.props.dimPast} onChange={(dimPast) => set({ dimPast })} /></Row>
          <Row group label="Show counter"><Check value={w.props.showCounter} onChange={(showCounter) => set({ showCounter })} /></Row>
          <Row label="Anchor"><Slider value={w.props.anchor} min={0} max={1} step={0.01} onChange={(anchor) => set({ anchor })} /></Row>
        </>
      );
    case "message":
      return <Row group label="Flash"><Check value={w.props.flash} onChange={(flash) => set({ flash })} /></Row>;
    case "serviceProgress":
      return (
        <>
          <Row group label="Show position"><Check value={w.props.showPosition} onChange={(showPosition) => set({ showPosition })} /></Row>
          <Row group label="Show end"><Check value={w.props.showEnd} onChange={(showEnd) => set({ showEnd })} /></Row>
          <Row group label="Show delta"><Check value={w.props.showDelta} onChange={(showDelta) => set({ showDelta })} /></Row>
          <Row group label="End time">
            <Segmented
              value={w.props.clock}
              options={[{ value: "12h", label: "12h" }, { value: "24h", label: "24h" }]}
              onChange={(clock) => set({ clock })}
            />
          </Row>
        </>
      );
    case "text":
      return (
        <textarea
          value={w.props.text}
          rows={4}
          style={{ width: "100%" }}
          onChange={(e) => set({ text: e.target.value })}
        />
      );
    default: {
      const _exhaustive: never = w;
      return _exhaustive;
    }
  }
}
