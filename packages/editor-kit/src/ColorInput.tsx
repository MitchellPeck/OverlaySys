import { useEffect, useRef, useState } from "react";

type Props = {
  /** Any CSS color string the layer schema can hold: hex, hex+alpha, rgb(), rgba(), named. */
  value: string;
  onChange: (next: string) => void;
};

type RGBA = { r: number; g: number; b: number; a: number };

export function ColorInput({ value, onChange }: Props) {
  const parsed = parseColor(value);
  const [hex, setHex] = useState(toHex(parsed));
  const [alpha, setAlpha] = useState(parsed.a);

  // Keep local controls in sync when the prop changes outside (undo, file load).
  const lastValueRef = useRef(value);
  useEffect(() => {
    if (lastValueRef.current === value) return;
    lastValueRef.current = value;
    const p = parseColor(value);
    setHex(toHex(p));
    setAlpha(p.a);
  }, [value]);

  function emit(nextHex: string, nextAlpha: number) {
    setHex(nextHex);
    setAlpha(nextAlpha);
    const out = nextAlpha >= 0.999 ? nextHex : hexAndAlphaToRgba(nextHex, nextAlpha);
    lastValueRef.current = out;
    onChange(out);
  }

  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <input
        type="color"
        value={hex}
        onChange={(e) => emit(e.target.value, alpha)}
        style={{ padding: 0, width: 32, height: 24, background: "transparent", border: "1px solid var(--border, #2a2e36)", borderRadius: 3 }}
      />
      <input
        value={hex}
        onChange={(e) => {
          const v = e.target.value.trim();
          if (/^#[0-9a-fA-F]{6}$/.test(v)) emit(v, alpha);
          else setHex(v);
        }}
        onBlur={() => {
          if (!/^#[0-9a-fA-F]{6}$/.test(hex)) setHex(toHex(parsed));
        }}
        style={{
          flex: 1,
          padding: "2px 6px",
          background: "var(--panel-2, #1c1f25)",
          border: "1px solid var(--border, #2a2e36)",
          borderRadius: 3,
          color: "var(--text, #e9eaee)",
          fontFamily: "ui-monospace, monospace",
          fontSize: 11,
          minWidth: 0,
          width: 80,
        }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 4 }} title={`alpha: ${alpha.toFixed(2)}`}>
        <span style={{ fontSize: 10, color: "var(--text-dim, #9099a8)" }}>α</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={alpha}
          onChange={(e) => emit(hex, parseFloat(e.target.value))}
          style={{ width: 60 }}
        />
      </div>
    </div>
  );
}

// ─── parsing ──────────────────────────────────────────────────────────────

const NAMED: Record<string, string> = {
  black: "#000000",
  white: "#ffffff",
  red: "#ff0000",
  green: "#008000",
  blue: "#0000ff",
  transparent: "rgba(0,0,0,0)",
};

function parseColor(s: string): RGBA {
  const v = (s ?? "").trim().toLowerCase();
  if (!v) return { r: 0, g: 0, b: 0, a: 1 };
  if (NAMED[v]) return parseColor(NAMED[v]!);
  // #rgb / #rgba / #rrggbb / #rrggbbaa
  if (v.startsWith("#")) {
    const hex = v.slice(1);
    if (hex.length === 3) {
      return {
        r: parseInt(hex[0]! + hex[0]!, 16),
        g: parseInt(hex[1]! + hex[1]!, 16),
        b: parseInt(hex[2]! + hex[2]!, 16),
        a: 1,
      };
    }
    if (hex.length === 4) {
      return {
        r: parseInt(hex[0]! + hex[0]!, 16),
        g: parseInt(hex[1]! + hex[1]!, 16),
        b: parseInt(hex[2]! + hex[2]!, 16),
        a: parseInt(hex[3]! + hex[3]!, 16) / 255,
      };
    }
    if (hex.length === 6) {
      return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16), a: 1 };
    }
    if (hex.length === 8) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: parseInt(hex.slice(6, 8), 16) / 255,
      };
    }
  }
  // rgb(r,g,b) / rgba(r,g,b,a) — supports modern space-separated too via regex.
  const m = v.match(/rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)(?:\s*[,/ ]\s*([\d.]+))?\s*\)/);
  if (m) {
    return {
      r: clamp(Math.round(parseFloat(m[1]!)), 0, 255),
      g: clamp(Math.round(parseFloat(m[2]!)), 0, 255),
      b: clamp(Math.round(parseFloat(m[3]!)), 0, 255),
      a: m[4] ? clamp(parseFloat(m[4]!), 0, 1) : 1,
    };
  }
  return { r: 255, g: 255, b: 255, a: 1 };
}

function toHex({ r, g, b }: RGBA): string {
  return "#" + [r, g, b].map((n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0")).join("");
}

function hexAndAlphaToRgba(hex: string, alpha: number): string {
  const p = parseColor(hex);
  return `rgba(${p.r}, ${p.g}, ${p.b}, ${alpha.toFixed(3).replace(/\.?0+$/, "")})`;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
