import { useRef, useState } from "react";
import type { EasingSpec } from "@overlaysys/core";

const PRESETS = [
  "linear",
  "power1.in", "power1.out", "power1.inOut",
  "power2.in", "power2.out", "power2.inOut",
  "power3.in", "power3.out", "power3.inOut",
  "power4.in", "power4.out", "power4.inOut",
  "back.in", "back.out", "back.inOut",
  "bounce.in", "bounce.out", "bounce.inOut",
  "elastic.in", "elastic.out", "elastic.inOut",
  "expo.in", "expo.out", "expo.inOut",
  "sine.in", "sine.out", "sine.inOut",
];

type Props = {
  value: EasingSpec;
  onChange: (e: EasingSpec) => void;
};

const SIZE = 160;

export function EasingPicker({ value, onChange }: Props) {
  const isCustom = Array.isArray(value);
  const bezier: [number, number, number, number] = isCustom
    ? (value as [number, number, number, number])
    : namedToBezier(value as string);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<"p1" | "p2" | null>(null);
  const [, setTick] = useState(0);

  function startDrag(which: "p1" | "p2") {
    return (e: React.PointerEvent) => {
      (e.target as Element).setPointerCapture(e.pointerId);
      dragRef.current = which;
    };
  }
  function onMove(e: React.PointerEvent) {
    if (!dragRef.current || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = 1 - (e.clientY - rect.top) / rect.height;
    const next: [number, number, number, number] = [...bezier];
    if (dragRef.current === "p1") {
      next[0] = clamp(x, 0, 1);
      next[1] = clamp(y, -1, 2);
    } else {
      next[2] = clamp(x, 0, 1);
      next[3] = clamp(y, -1, 2);
    }
    onChange(next);
    setTick((t) => t + 1);
  }
  function endDrag() {
    dragRef.current = null;
  }

  function pickPreset(name: string) {
    onChange(name);
  }

  return (
    <div style={{ background: "var(--panel-2, #1c1f25)", padding: 10, borderRadius: 4 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <svg
          ref={svgRef}
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          onPointerMove={onMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          style={{
            background: "#0f1014",
            border: "1px solid var(--border, #2a2e36)",
            borderRadius: 4,
            cursor: "default",
          }}
        >
          {/* Frame */}
          <rect x={0.5} y={0.5} width={SIZE - 1} height={SIZE - 1} fill="none" stroke="#2a2e36" />
          {/* Diagonal reference */}
          <line x1={0} y1={SIZE} x2={SIZE} y2={0} stroke="#2a2e36" strokeDasharray="2 4" />
          {/* Handles */}
          <line
            x1={0}
            y1={SIZE}
            x2={bezier[0] * SIZE}
            y2={SIZE - bezier[1] * SIZE}
            stroke="#4ade80"
            strokeWidth={1}
          />
          <line
            x1={SIZE}
            y1={0}
            x2={bezier[2] * SIZE}
            y2={SIZE - bezier[3] * SIZE}
            stroke="#4ade80"
            strokeWidth={1}
          />
          {/* Curve */}
          <path d={`M 0 ${SIZE} C ${bezier[0] * SIZE} ${SIZE - bezier[1] * SIZE}, ${bezier[2] * SIZE} ${SIZE - bezier[3] * SIZE}, ${SIZE} 0`} fill="none" stroke="#ffb13a" strokeWidth={2} />
          {/* Points */}
          <circle
            cx={bezier[0] * SIZE}
            cy={SIZE - bezier[1] * SIZE}
            r={6}
            fill="#4ade80"
            onPointerDown={startDrag("p1")}
            style={{ cursor: "grab" }}
          />
          <circle
            cx={bezier[2] * SIZE}
            cy={SIZE - bezier[3] * SIZE}
            r={6}
            fill="#4ade80"
            onPointerDown={startDrag("p2")}
            style={{ cursor: "grab" }}
          />
          {/* Anchors (read-only) */}
          <circle cx={0} cy={SIZE} r={3} fill="#9099a8" />
          <circle cx={SIZE} cy={0} r={3} fill="#9099a8" />
        </svg>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 11, color: "var(--text-dim, #9099a8)" }}>
            {isCustom ? `cubic-bezier(${bezier.map((n) => n.toFixed(2)).join(", ")})` : value}
          </div>
          <select
            value={isCustom ? "" : (value as string)}
            onChange={(e) => pickPreset(e.target.value)}
            style={{
              width: "100%",
              padding: "4px 6px",
              background: "var(--panel, #14161a)",
              border: "1px solid var(--border, #2a2e36)",
              color: "var(--text, #e9eaee)",
              borderRadius: 3,
              fontSize: 12,
            }}
          >
            <option value="">— preset —</option>
            {PRESETS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <button
            onClick={() => onChange([0.4, 0, 0.2, 1])}
            style={{
              padding: "4px 6px",
              background: "var(--panel, #14161a)",
              border: "1px solid var(--border, #2a2e36)",
              color: "var(--text-dim, #9099a8)",
              borderRadius: 3,
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            Reset bezier
          </button>
        </div>
      </div>
    </div>
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

// Approximate GSAP named easings as cubic-bezier so the picker has
// a sensible starting curve when switching from preset to custom mode.
function namedToBezier(name: string): [number, number, number, number] {
  switch (name) {
    case "linear": return [0, 0, 1, 1];
    case "power1.out": return [0.0, 0.0, 0.55, 1.0];
    case "power1.in": return [0.55, 0.0, 1.0, 1.0];
    case "power1.inOut": return [0.45, 0.0, 0.55, 1.0];
    case "power2.out": return [0.0, 0.0, 0.4, 1.0];
    case "power2.in": return [0.7, 0.0, 1.0, 1.0];
    case "power2.inOut": return [0.45, 0.05, 0.55, 0.95];
    case "power3.out": return [0.0, 0.0, 0.3, 1.0];
    case "power3.in": return [0.8, 0.0, 1.0, 1.0];
    case "power4.out": return [0.0, 0.0, 0.2, 1.0];
    case "back.out": return [0.34, 1.56, 0.64, 1.0];
    case "expo.out": return [0.16, 1, 0.3, 1];
    default: return [0.4, 0.0, 0.2, 1.0];
  }
}
