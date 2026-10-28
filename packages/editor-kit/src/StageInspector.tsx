import { useEffect, useState, type ReactNode } from "react";
import type { StageLayout, StageWidget } from "@overlaysys/core";
import { Button, Input, NumberInput, SegmentedControl, Select, Switch, Textarea, colors, fontSize, radius } from "@overlaysys/ui";
import { ColorInput } from "./ColorInput";
import { FieldRow } from "./FieldRow";
import { FontInput } from "./FontInput";
import { FontWeightSelect } from "./FontWeightSelect";
import { MIN_WIDGET_SIZE, type AlignMode } from "./stageGeometry";
import {
  decodeTimerSource,
  encodeTimerSource,
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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset
      style={{ border: `1px solid ${colors.border}`, borderRadius: radius.md, margin: "8px 0", padding: "4px 8px 8px", minWidth: 0 }}
    >
      <legend style={{ fontSize: fontSize.sm, color: colors.textDim, padding: "0 4px" }}>{title}</legend>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>{children}</div>
    </fieldset>
  );
}

function Num(props: {
  id: string;
  label: string;
  value: number;
  onChange: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  return (
    <NumberInput
      id={props.id}
      aria-label={props.label}
      value={Number.isFinite(props.value) ? props.value : 0}
      min={props.min}
      max={props.max}
      step={props.step}
      suffix={props.suffix}
      int
      size="sm"
      onCommit={props.onChange}
    />
  );
}

/** Text that commits once, on blur or Enter, so a typing burst is a single undo step (see `coalescedLabelEdits`). */
function CommitText(props: { id: string; value: string; onCommit: (v: string) => void; multiline?: boolean; placeholder?: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => setDraft(null), [props.value]);
  function commit() {
    if (draft === null) return;
    setDraft(null);
    if (draft !== props.value) props.onCommit(draft);
  }
  if (props.multiline) {
    return (
      <Textarea
        id={props.id}
        rows={4}
        value={draft ?? props.value}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commit();
          else if (e.key === "Escape") setDraft(null);
        }}
      />
    );
  }
  return (
    <Input
      id={props.id}
      type="text"
      placeholder={props.placeholder}
      value={draft ?? props.value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        else if (e.key === "Escape") setDraft(null);
      }}
    />
  );
}

function Slider(props: { id: string; value: number; onChange: (n: number) => void; min: number; max: number; step: number; label: string }) {
  return (
    <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <input
        id={props.id}
        aria-label={props.label}
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        style={{ flex: 1, accentColor: colors.brandFill }}
        onChange={(e) => props.onChange(e.target.valueAsNumber)}
      />
      <span style={{ width: 32, textAlign: "right", fontSize: fontSize.sm, color: colors.textDim }}>{props.value}</span>
    </span>
  );
}

function Toggle(props: { label: string; value: boolean; onChange: (b: boolean) => void }) {
  return (
    <FieldRow label={props.label}>
      {() => <Switch checked={props.value} onChange={props.onChange} aria-label={props.label} />}
    </FieldRow>
  );
}

export function StageInspector({ layout, selectedIds, onPatch, onAlign, onDistribute, timerChoices, channelChoices }: Props) {
  const selected = layout.widgets.filter((w) => selectedIds.includes(w.id));

  if (selected.length === 0) {
    return <p style={{ color: colors.textDim, fontSize: fontSize.sm, padding: 8 }}>Select a widget to edit it.</p>;
  }

  if (selected.length >= 2) {
    return (
      <div style={{ padding: 8 }}>
        <Section title={`${selected.length} widgets`}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {ALIGN_BUTTONS.map((b) => (
              <Button key={b.mode} size="sm" onClick={() => onAlign(b.mode)}>
                {b.label}
              </Button>
            ))}
          </div>
          {selected.length >= 3 && (
            <div style={{ display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap" }}>
              <Button size="sm" onClick={() => onDistribute("x")}>Distribute horizontally</Button>
              <Button size="sm" onClick={() => onDistribute("y")}>Distribute vertically</Button>
            </div>
          )}
        </Section>
        <p style={{ fontSize: fontSize.sm, color: colors.textDim }}>Press Delete to remove the selected widgets.</p>
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
      <Section title="Position & size">
        <FieldRow label="X">{(id) => <Num id={id} label="X" value={w.rect.x} onChange={(x) => patch({ rect: { x } })} />}</FieldRow>
        <FieldRow label="Y">{(id) => <Num id={id} label="Y" value={w.rect.y} onChange={(y) => patch({ rect: { y } })} />}</FieldRow>
        <FieldRow label="Width">
          {(id) => <Num id={id} label="Width" value={w.rect.w} min={MIN_WIDGET_SIZE} onChange={(v) => patch({ rect: { w: v } })} />}
        </FieldRow>
        <FieldRow label="Height">
          {(id) => <Num id={id} label="Height" value={w.rect.h} min={MIN_WIDGET_SIZE} onChange={(v) => patch({ rect: { h: v } })} />}
        </FieldRow>
        <FieldRow label="Padding">
          {(id) => <Num id={id} label="Padding" value={s.padding} min={0} onChange={(padding) => setStyle({ padding })} />}
        </FieldRow>
        <FieldRow label="Background">
          {() =>
            s.background !== undefined ? (
              <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <ColorInput value={s.background} onChange={(background) => setStyle({ background })} />
                <Button size="sm" onClick={() => setStyle({ background: undefined })}>Remove</Button>
              </span>
            ) : (
              <Button size="sm" onClick={() => setStyle({ background: "#000000" })}>Add background</Button>
            )
          }
        </FieldRow>
        <FieldRow label="Border">
          {(id) => (
            <Num
              id={id}
              label="Border width"
              value={s.border?.width ?? 0}
              min={0}
              suffix="px"
              onChange={(width) =>
                setStyle({ border: width === 0 ? undefined : { width, color: s.border?.color ?? "#ffffff", radius: s.border?.radius ?? 0 } })
              }
            />
          )}
        </FieldRow>
        {s.border && (
          <>
            <FieldRow label="Border color">
              {() => <ColorInput value={s.border!.color} onChange={(color) => setStyle({ border: { ...s.border!, color } })} />}
            </FieldRow>
            <FieldRow label="Radius">
              {(id) => (
                <Num id={id} label="Border radius" value={s.border!.radius} min={0} onChange={(radius) => setStyle({ border: { ...s.border!, radius } })} />
              )}
            </FieldRow>
          </>
        )}
      </Section>

      <Section title="Text">
        <FieldRow label="Font">
          {() => <FontInput value={s.fontFamily} templateFonts={NO_FONTS} onChange={(fontFamily) => setStyle({ fontFamily })} onAddFont={noop} />}
        </FieldRow>
        <FieldRow label="Size">
          {(id) => <Num id={id} label="Font size" value={s.fontSize} min={1} onChange={(fontSize) => setStyle({ fontSize })} />}
        </FieldRow>
        <FieldRow label="Weight">
          {(id) => <FontWeightSelect id={id} value={s.fontWeight} onChange={(fontWeight) => setStyle({ fontWeight })} />}
        </FieldRow>
        <FieldRow label="Color">{() => <ColorInput value={s.color} onChange={(color) => setStyle({ color })} />}</FieldRow>
        <FieldRow label="Align">
          {() => (
            <SegmentedControl
              size="sm"
              aria-label="Horizontal align"
              value={s.align}
              options={[{ value: "left", label: "Left" }, { value: "center", label: "Center" }, { value: "right", label: "Right" }]}
              onChange={(align) => setStyle({ align })}
            />
          )}
        </FieldRow>
        <FieldRow label="Vertical">
          {() => (
            <SegmentedControl
              size="sm"
              aria-label="Vertical align"
              value={s.vAlign}
              options={[{ value: "top", label: "Top" }, { value: "middle", label: "Middle" }, { value: "bottom", label: "Bottom" }]}
              onChange={(vAlign) => setStyle({ vAlign })}
            />
          )}
        </FieldRow>
        <Toggle label="Auto-fit" value={s.autoFit} onChange={(autoFit) => setStyle({ autoFit })} />
        <FieldRow label="Label">
          {(id) => <CommitText id={id} value={s.label ?? ""} onCommit={(v) => setStyle({ label: v === "" ? undefined : v })} />}
        </FieldRow>
        <FieldRow label="Label size">
          {(id) => (
            <Num
              id={id}
              label="Label size"
              value={s.captionSize ?? 0}
              min={0}
              suffix="px"
              onChange={(v) => setStyle({ captionSize: v === 0 ? undefined : v })}
            />
          )}
        </FieldRow>
        <FieldRow label="Label color">
          {() => <ColorInput value={s.captionColor ?? s.color} onChange={(captionColor) => setStyle({ captionColor })} />}
        </FieldRow>
        {w.kind === "text" && (
          <FieldRow label="Text">
            {(id) => <CommitText id={id} multiline value={w.props.text} onCommit={(text) => setProps({ text })} />}
          </FieldRow>
        )}
      </Section>

      {w.kind !== "text" && <Section title="Behaviour">{renderProps(w, setProps, timerChoices, channelChoices)}</Section>}
    </div>
  );
}

const OVERTIME_OPTIONS = [
  { value: "text", label: "Text" },
  { value: "fill", label: "Fill" },
  { value: "flash", label: "Flash" },
] as const;

function renderProps(
  w: StageWidget,
  set: (props: StageWidgetPropsPatch) => void,
  timerChoices: { id: string; label: string }[],
  channelChoices: { id: string; name: string }[],
): ReactNode {
  switch (w.kind) {
    case "currentSlide":
      return <Toggle label="Show reference" value={w.props.showReference} onChange={(showReference) => set({ showReference })} />;
    case "nextSlide":
      return (
        <>
          <FieldRow label="Max lines">
            {(id) => <Num id={id} label="Max lines" value={w.props.maxLines} min={1} max={10} onChange={(maxLines) => set({ maxLines })} />}
          </FieldRow>
          <FieldRow label="Dim opacity">
            {(id) => <Slider id={id} label="Dim opacity" value={w.props.dimOpacity} min={0} max={1} step={0.05} onChange={(dimOpacity) => set({ dimOpacity })} />}
          </FieldRow>
        </>
      );
    case "rowTitle":
      return (
        <>
          <Toggle label="Show next" value={w.props.showNext} onChange={(showNext) => set({ showNext })} />
          <FieldRow label="Prefer">
            {() => (
              <SegmentedControl
                size="sm"
                aria-label="Prefer"
                value={w.props.prefer}
                options={[{ value: "rundown", label: "Rundown" }, { value: "pco", label: "PCO" }]}
                onChange={(prefer) => set({ prefer })}
              />
            )}
          </FieldRow>
        </>
      );
    case "rowCue":
      return <Toggle label="Next row" value={w.props.includeNextRow} onChange={(includeNextRow) => set({ includeNextRow })} />;
    case "clock":
      return (
        <>
          <FieldRow label="Format">
            {() => (
              <SegmentedControl
                size="sm"
                aria-label="Clock format"
                value={w.props.format}
                options={[{ value: "12h", label: "12h" }, { value: "24h", label: "24h" }]}
                onChange={(format) => set({ format })}
              />
            )}
          </FieldRow>
          <Toggle label="Seconds" value={w.props.seconds} onChange={(seconds) => set({ seconds })} />
        </>
      );
    case "timer":
      return (
        <>
          <FieldRow label="Source">
            {(id) => (
              <Select id={id} value={encodeTimerSource(w.props.source)} onChange={(e) => set({ source: decodeTimerSource(e.target.value) })}>
                {timerSourceOptions(w.props.source, channelChoices, timerChoices).map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </Select>
            )}
          </FieldRow>
          <FieldRow label="Under (s)" hint="Warn when this many seconds or fewer remain">
            {(id) => <Num id={id} label="Under (s)" value={w.props.warnBelowSec} min={0} onChange={(warnBelowSec) => set({ warnBelowSec })} />}
          </FieldRow>
          <FieldRow label="Warn">{() => <ColorInput value={w.props.warnColor} onChange={(warnColor) => set({ warnColor })} />}</FieldRow>
          <FieldRow label="Overtime">{() => <ColorInput value={w.props.overColor} onChange={(overColor) => set({ overColor })} />}</FieldRow>
          <FieldRow label="Over style">
            {() => (
              <SegmentedControl
                size="sm"
                aria-label="Overtime style"
                value={w.props.overtimeStyle ?? "text"}
                options={OVERTIME_OPTIONS.map((o) => ({ ...o }))}
                onChange={(overtimeStyle) => set({ overtimeStyle })}
              />
            )}
          </FieldRow>
          <Toggle label="Show label" value={w.props.showLabel} onChange={(showLabel) => set({ showLabel })} />
        </>
      );
    case "videoRemaining":
      return (
        <>
          <FieldRow label="Under (s)" hint="Warn when this many seconds or fewer remain">
            {(id) => <Num id={id} label="Under (s)" value={w.props.warnBelowSec} min={0} onChange={(warnBelowSec) => set({ warnBelowSec })} />}
          </FieldRow>
          <FieldRow label="Warn">{() => <ColorInput value={w.props.warnColor ?? "#ffb703"} onChange={(warnColor) => set({ warnColor })} />}</FieldRow>
          <FieldRow label="Overtime">{() => <ColorInput value={w.props.overColor ?? "#ef233c"} onChange={(overColor) => set({ overColor })} />}</FieldRow>
        </>
      );
    case "sermonNotes":
      return (
        <>
          <FieldRow label="Highlight" hint="Highlight color">
            {() => <ColorInput value={w.props.highlightColor} onChange={(highlightColor) => set({ highlightColor })} />}
          </FieldRow>
          <Toggle label="Dim past" value={w.props.dimPast} onChange={(dimPast) => set({ dimPast })} />
          <Toggle label="Counter" value={w.props.showCounter} onChange={(showCounter) => set({ showCounter })} />
          <Toggle label="Hide if empty" value={w.props.collapseWhenEmpty ?? false} onChange={(collapseWhenEmpty) => set({ collapseWhenEmpty })} />
          <FieldRow label="Anchor" hint="Where the current point sits, from the top">
            {(id) => <Slider id={id} label="Anchor" value={w.props.anchor} min={0} max={1} step={0.01} onChange={(anchor) => set({ anchor })} />}
          </FieldRow>
          <p style={{ margin: "0 0 0 88px", fontSize: fontSize.sm, color: colors.textDim }}>Where the current point sits, from the top</p>
        </>
      );
    case "message":
      return <Toggle label="Flash" value={w.props.flash} onChange={(flash) => set({ flash })} />;
    case "serviceProgress":
      return (
        <>
          <Toggle label="Position" value={w.props.showPosition} onChange={(showPosition) => set({ showPosition })} />
          <Toggle label="End" value={w.props.showEnd} onChange={(showEnd) => set({ showEnd })} />
          <Toggle label="Delta" value={w.props.showDelta} onChange={(showDelta) => set({ showDelta })} />
          <FieldRow label="End time">
            {() => (
              <SegmentedControl
                size="sm"
                aria-label="End time format"
                value={w.props.clock}
                options={[{ value: "12h", label: "12h" }, { value: "24h", label: "24h" }]}
                onChange={(clock) => set({ clock })}
              />
            )}
          </FieldRow>
        </>
      );
    case "text":
      return null;
    default: {
      const _exhaustive: never = w;
      return _exhaustive;
    }
  }
}
