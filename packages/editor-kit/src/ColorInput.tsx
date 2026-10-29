import { useEffect, useRef, useState } from "react";
import { Input, NumberInput, colors, fontFamily, radius } from "@overlaysys/ui";

type Props = {
  /** Any CSS color string the layer schema can hold: hex, hex+alpha, rgb(), rgba(), named. */
  value: string;
  onChange: (next: string) => void;
  /** Id for the hex field, so a FieldRow label focuses it. */
  id?: string;
  /** Names the colour in the controls' accessible names ("Fill colour", "Fill opacity"). */
  label?: string;
};

type RGBA = { r: number; g: number; b: number; a: number };

/**
 * Swatch and hex on the first line, opacity (0–100 %) on the second, so the
 * control fits a 300 px inspector column without scrolling sideways.
 */
export function ColorInput({ value, onChange, id, label = "Color" }: Props) {
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
    <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", minWidth: 0 }}>
        <input
          type="color"
          aria-label={`${label} swatch`}
          value={hex}
          onChange={(e) => emit(e.target.value, alpha)}
          style={{
            flexShrink: 0,
            padding: 0,
            width: 28,
            height: 24,
            background: "transparent",
            border: `1px solid ${colors.border}`,
            borderRadius: radius.sm,
            cursor: "pointer",
          }}
        />
        <Input
          id={id}
          aria-label={`${label} hex`}
          value={hex}
          onChange={(e) => {
            const v = e.target.value.trim();
            if (/^#[0-9a-fA-F]{6}$/.test(v)) emit(v, alpha);
            else setHex(v);
          }}
          onBlur={() => {
            if (!/^#[0-9a-fA-F]{6}$/.test(hex)) setHex(toHex(parsed));
          }}
          style={{ flex: 1, minWidth: 0, fontFamily: fontFamily.mono }}
        />
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <span style={{ flexShrink: 0, fontSize: 11, color: colors.textMuted }} aria-hidden>
          Opacity
        </span>
        <div style={{ width: 72 }}>
          <NumberInput
            size="sm"
            int
            min={0}
            max={100}
            suffix="%"
            aria-label={`${label} opacity`}
            value={Math.round(alpha * 100)}
            onCommit={(v) => emit(hex, clamp(v, 0, 100) / 100)}
          />
        </div>
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
