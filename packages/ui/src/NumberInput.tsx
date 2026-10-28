"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { colors, control, fontSize, radius } from "./tokens";
import { decimalsFor, formatNumber, parseDraft, stepValue, draftChanged } from "./numberDraft";

type Props = {
  value: number;
  onCommit(v: number): void;
  min?: number;
  max?: number;
  step?: number;
  int?: boolean;
  precision?: number;
  suffix?: string;
  "aria-label"?: string;
  id?: string;
  size?: "sm" | "md";
  disabled?: boolean;
};

export function NumberInput({
  value,
  onCommit,
  min,
  max,
  step,
  int,
  precision,
  suffix,
  size = "md",
  disabled,
  id,
  "aria-label": ariaLabel,
}: Props) {
  const dp = decimalsFor(step, int, precision);
  const shown = formatNumber(value, dp);
  const [draft, setDraft] = useState(shown);
  const focused = useRef(false);
  const opts = { min, max, int, step, precision };

  // Follow external value changes while not editing.
  useEffect(() => {
    if (!focused.current) setDraft(shown);
  }, [shown]);

  function commit(text: string) {
    if (!draftChanged(text, shown)) return;
    const n = parseDraft(text, opts);
    if (n === null) {
      setDraft(shown);
      return;
    }
    setDraft(formatNumber(n, dp));
    if (n !== value) onCommit(n);
  }

  const c = control[size];
  const wrap: CSSProperties = { position: "relative", display: "inline-block", width: "100%" };
  const input: CSSProperties = {
    width: "100%",
    height: c.height,
    padding: `0 ${suffix ? c.padX + 18 : c.padX - 2}px 0 ${c.padX - 2}px`,
    background: colors.surface2,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
    color: colors.text,
    fontSize: c.fontSize,
    fontFamily: "inherit",
    fontVariantNumeric: "tabular-nums",
    outline: "none",
    boxSizing: "border-box",
    opacity: disabled ? 0.6 : 1,
  };
  return (
    <span style={wrap}>
      <input
        id={id}
        aria-label={ariaLabel}
        type="text"
        inputMode={int ? "numeric" : "decimal"}
        disabled={disabled}
        value={draft}
        style={input}
        onFocus={() => {
          focused.current = true;
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          focused.current = false;
          commit(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit(draft);
          } else if (e.key === "Escape") {
            setDraft(shown);
          } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const base = parseDraft(draft, opts) ?? value;
            const next = stepValue(base, e.key === "ArrowUp" ? 1 : -1, { ...opts, big: e.shiftKey });
            setDraft(formatNumber(next, dp));
            if (next !== value) onCommit(next);
          }
        }}
      />
      {suffix && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            right: 8,
            top: 0,
            height: c.height,
            display: "flex",
            alignItems: "center",
            color: colors.textMuted,
            fontSize: fontSize.xs,
            pointerEvents: "none",
          }}
        >
          {suffix}
        </span>
      )}
    </span>
  );
}
