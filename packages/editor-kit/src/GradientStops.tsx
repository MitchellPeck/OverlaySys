import { useRef, useState } from "react";
import type { ColorValue, Field } from "@overlaysys/core";
import { ColorInput } from "./ColorInput";

type Stop = { at: number; color: ColorValue };

type Props = {
  stops: Stop[];
  /** Color-compatible fields available for per-stop binding. */
  fields?: Field[];
  onChange: (next: Stop[]) => void;
  onPushHistory?: () => void;
};

const BAR_HEIGHT = 28;

export function GradientStops({ stops, fields = [], onChange, onPushHistory }: Props) {
  const barRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ index: number; pushed: boolean } | null>(null);
  const [selected, setSelected] = useState<number>(0);

  const sorted = [...stops]
    .map((s, i) => ({ s, i }))
    .sort((a, b) => a.s.at - b.s.at);

  // For the gradient preview we need a literal CSS color per stop. Bound stops
  // sample to a placeholder so the bar still renders something meaningful.
  const cssGradient = `linear-gradient(to right, ${sorted
    .map(({ s }) => `${literalForCss(s.color)} ${(s.at * 100).toFixed(1)}%`)
    .join(", ")})`;

  function startDrag(e: React.PointerEvent, index: number) {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setSelected(index);
    dragRef.current = { index, pushed: false };
  }
  function onMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d || !barRef.current) return;
    if (!d.pushed) {
      onPushHistory?.();
      d.pushed = true;
    }
    const r = barRef.current.getBoundingClientRect();
    const at = clamp((e.clientX - r.left) / r.width, 0, 1);
    const next = stops.map((s, i) => (i === d.index ? { ...s, at } : s));
    onChange(next);
  }
  function endDrag(e: React.PointerEvent) {
    if (!dragRef.current) return;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    dragRef.current = null;
  }

  function addStopAt(at: number) {
    onPushHistory?.();
    const sampled = sampleColorAt(stops, at);
    const next = [...stops, { at, color: sampled }];
    onChange(next);
    setSelected(next.length - 1);
  }
  function removeStop(index: number) {
    if (stops.length <= 2) return;
    onPushHistory?.();
    onChange(stops.filter((_, i) => i !== index));
    setSelected(0);
  }
  function setStopColor(index: number, color: ColorValue) {
    onChange(stops.map((s, i) => (i === index ? { ...s, color } : s)));
  }

  const sel = stops[selected];
  const selBound = sel && typeof sel.color !== "string";
  const colorFieldCandidates = fields.filter((f) => f.type === "color");

  return (
    <div>
      <div
        ref={barRef}
        onDoubleClick={(e) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          addStopAt(clamp((e.clientX - r.left) / r.width, 0, 1));
        }}
        onPointerMove={onMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{
          position: "relative",
          height: BAR_HEIGHT,
          borderRadius: 4,
          background:
            `${cssGradient}, linear-gradient(45deg, #1a1c20 25%, #0c0d10 25%, #0c0d10 50%, #1a1c20 50%, #1a1c20 75%, #0c0d10 75%, #0c0d10) 0 0 / 8px 8px`,
          border: "1px solid var(--border, #2a2e36)",
          cursor: "copy",
        }}
        title="Double-click to add a stop"
      >
        {stops.map((stop, i) => {
          const isSel = i === selected;
          const bound = typeof stop.color !== "string";
          return (
            <div
              key={i}
              onPointerDown={(e) => startDrag(e, i)}
              onClick={(e) => {
                e.stopPropagation();
                setSelected(i);
              }}
              style={{
                position: "absolute",
                left: `${stop.at * 100}%`,
                top: -4,
                bottom: -4,
                width: 12,
                marginLeft: -6,
                background: bound ? "var(--accent-2, #ffb13a)" : literalForCss(stop.color),
                border: `2px solid ${isSel ? "#4ade80" : "#ffffff"}`,
                borderRadius: 3,
                boxShadow: "0 0 0 1px rgba(0,0,0,0.6)",
                cursor: "grab",
              }}
              title={bound ? `bound to $${(stop.color as { fieldKey: string }).fieldKey}` : undefined}
            />
          );
        })}
      </div>

      <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 11, color: "var(--text-dim, #9099a8)" }}>
            stop {selected + 1}/{stops.length}
          </span>
          <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
            <button onClick={() => addStopAt(0.5)} style={miniBtn}>+ Stop</button>
            <button
              onClick={() => removeStop(selected)}
              disabled={stops.length <= 2}
              style={{ ...miniBtn, color: "var(--red, #f87171)", borderColor: "var(--red, #f87171)" }}
            >
              −
            </button>
          </span>
        </div>
        {sel && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "60px 1fr", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 11, color: "var(--text-dim, #9099a8)" }}>at (0–1)</span>
              <input
                type="number"
                step={0.01}
                min={0}
                max={1}
                value={sel.at}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (Number.isFinite(v)) {
                    onChange(stops.map((s, i) => (i === selected ? { ...s, at: clamp(v, 0, 1) } : s)));
                  }
                }}
                style={inputStyle}
              />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "60px 1fr", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 11, color: "var(--text-dim, #9099a8)" }}>source</span>
              <div style={{ display: "flex", gap: 4 }}>
                <button
                  onClick={() => {
                    if (!selBound) return;
                    setStopColor(selected, "#ffffff");
                  }}
                  disabled={!selBound}
                  style={tabBtn(!selBound)}
                >
                  Literal
                </button>
                <button
                  onClick={() => {
                    if (selBound) return;
                    const first = colorFieldCandidates[0];
                    setStopColor(selected, { fieldKey: first?.key ?? "" });
                  }}
                  disabled={selBound || colorFieldCandidates.length === 0}
                  style={tabBtn(!!selBound)}
                  title={
                    colorFieldCandidates.length === 0
                      ? "Declare a color or text field first to bind"
                      : ""
                  }
                >
                  Bound
                </button>
              </div>
            </div>
            {selBound ? (
              <div style={{ display: "grid", gridTemplateColumns: "60px 1fr", gap: 6, alignItems: "center" }}>
                <span style={{ fontSize: 11, color: "var(--text-dim, #9099a8)" }}>field</span>
                <select
                  value={(sel.color as { fieldKey: string }).fieldKey}
                  onChange={(e) => setStopColor(selected, { fieldKey: e.target.value })}
                  style={inputStyle}
                >
                  {colorFieldCandidates.length === 0 && (
                    <option value="">(no compatible fields)</option>
                  )}
                  {colorFieldCandidates.map((f) => (
                    <option key={f.key} value={f.key}>
                      ${f.key} — {f.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "60px 1fr", gap: 6, alignItems: "center" }}>
                <span style={{ fontSize: 11, color: "var(--text-dim, #9099a8)" }}>color</span>
                <ColorInput value={sel.color as string} onChange={(c) => setStopColor(selected, c)} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── helpers ──────────────────────────────────────────────────────────────

/** Pick a sensible CSS literal for the gradient bar, using a placeholder for bound stops. */
function literalForCss(c: ColorValue): string {
  return typeof c === "string" ? c : "rgba(255,177,58,0.4)";
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function sampleColorAt(stops: Stop[], at: number): ColorValue {
  if (stops.length === 0) return "#ffffff";
  const sorted = [...stops].sort((a, b) => a.at - b.at);
  if (at <= sorted[0]!.at) return sorted[0]!.color;
  if (at >= sorted[sorted.length - 1]!.at) return sorted[sorted.length - 1]!.color;
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]!;
    const b = sorted[i + 1]!;
    if (at >= a.at && at <= b.at) {
      // If either neighbour is bound, just adopt that one — interpolation
      // across a binding doesn't have a meaningful CSS result.
      if (typeof a.color !== "string") return a.color;
      if (typeof b.color !== "string") return b.color;
      const t = (at - a.at) / (b.at - a.at);
      return mix(a.color, b.color, t);
    }
  }
  return sorted[0]!.color;
}

function mix(c1: string, c2: string, t: number): string {
  const a = parseToRgba(c1);
  const b = parseToRgba(c2);
  const r = Math.round(a.r + (b.r - a.r) * t);
  const g = Math.round(a.g + (b.g - a.g) * t);
  const bl = Math.round(a.b + (b.b - a.b) * t);
  const al = a.a + (b.a - a.a) * t;
  return al >= 0.999
    ? "#" + [r, g, bl].map((n) => n.toString(16).padStart(2, "0")).join("")
    : `rgba(${r}, ${g}, ${bl}, ${al.toFixed(3).replace(/\.?0+$/, "")})`;
}

function parseToRgba(s: string): { r: number; g: number; b: number; a: number } {
  const v = s.trim().toLowerCase();
  if (v.startsWith("#")) {
    const hex = v.slice(1);
    if (hex.length === 6) return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16), a: 1 };
    if (hex.length === 8) return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16), a: parseInt(hex.slice(6, 8), 16) / 255 };
  }
  const m = v.match(/rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)(?:\s*[,/ ]\s*([\d.]+))?\s*\)/);
  if (m) {
    return {
      r: parseFloat(m[1]!),
      g: parseFloat(m[2]!),
      b: parseFloat(m[3]!),
      a: m[4] ? parseFloat(m[4]!) : 1,
    };
  }
  return { r: 255, g: 255, b: 255, a: 1 };
}

function tabBtn(active: boolean): React.CSSProperties {
  return {
    flex: 1,
    padding: "4px 8px",
    background: active ? "var(--accent, #ff3a3a)" : "var(--panel-2, #1c1f25)",
    color: active ? "#fff" : "var(--text, #e9eaee)",
    border: "1px solid var(--border, #2a2e36)",
    borderRadius: 3,
    fontSize: 11,
    cursor: "pointer",
  };
}

const miniBtn: React.CSSProperties = {
  padding: "2px 8px",
  background: "var(--panel-2, #1c1f25)",
  color: "var(--text, #e9eaee)",
  border: "1px solid var(--border, #2a2e36)",
  borderRadius: 3,
  fontSize: 11,
  cursor: "pointer",
};
const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "2px 6px",
  background: "var(--panel-2, #1c1f25)",
  border: "1px solid var(--border, #2a2e36)",
  borderRadius: 3,
  color: "var(--text, #e9eaee)",
  fontSize: 12,
};
