"use client";
import { useRef, type ReactNode } from "react";
import { colors, control, fontSize, radius } from "./tokens";
import { nextRovingIndex } from "./roving";

type Props<T extends string> = {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange(v: T): void;
  size?: "sm" | "md";
  "aria-label"?: string;
};

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  size = "md",
  "aria-label": ariaLabel,
}: Props<T>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = options.findIndex((o) => o.value === value);
  const tabIndexFor = (i: number) => (selected === -1 ? (i === 0 ? 0 : -1) : i === selected ? 0 : -1);
  const h = control[size].height;
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      style={{
        display: "inline-flex",
        gap: 2,
        padding: 2,
        background: colors.surface2,
        border: `1px solid ${colors.border}`,
        borderRadius: radius.md,
        boxSizing: "border-box",
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
            title={o.title}
            tabIndex={tabIndexFor(i)}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              const n = nextRovingIndex(options.length, i, e.key);
              if (n === null) return;
              e.preventDefault();
              refs.current[n]?.focus();
              const nxt = options[n];
              if (nxt) onChange(nxt.value);
            }}
            style={{
              height: h - 6,
              padding: "0 10px",
              border: "none",
              borderRadius: radius.sm,
              background: on ? colors.brandFill : colors.surface2,
              color: on ? "#fff" : colors.textDim,
              fontSize: fontSize.sm,
              fontFamily: "inherit",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
