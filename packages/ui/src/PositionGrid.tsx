"use client";
import { useRef } from "react";
import { colors, radius } from "./tokens";
import { nextGridIndex } from "./roving";

type Props<T extends string> = {
  value: T | null;
  /** The nine cells, top-left to bottom-right. */
  options: readonly { value: T; label: string }[];
  onChange(v: T): void;
  "aria-label"?: string;
};

/** A 3×3 picker for where something sits in its frame. `value` null = none chosen (e.g. following a default). */
export function PositionGrid<T extends string>({ value, options, onChange, "aria-label": ariaLabel }: Props<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = options.findIndex((o) => o.value === value);
  const focusable = selected === -1 ? 0 : selected;
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      style={{
        display: "inline-grid",
        gridTemplateColumns: "repeat(3, 22px)",
        gridAutoRows: 16,
        gap: 3,
        padding: 3,
        background: colors.surface2,
        border: `1px solid ${colors.border}`,
        borderRadius: radius.md,
      }}
    >
      {options.map((o, i) => {
        const on = i === selected;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={o.label}
            title={o.label}
            tabIndex={i === focusable ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              const n = nextGridIndex(options.length, 3, i, e.key);
              if (n === null) return;
              e.preventDefault();
              refs.current[n]?.focus();
              const nxt = options[n];
              if (nxt) onChange(nxt.value);
            }}
            style={{
              padding: 0,
              border: `1px solid ${on ? colors.brandFill : colors.border}`,
              borderRadius: radius.sm,
              background: on ? colors.brandFill : "transparent",
              cursor: "pointer",
            }}
          />
        );
      })}
    </div>
  );
}
