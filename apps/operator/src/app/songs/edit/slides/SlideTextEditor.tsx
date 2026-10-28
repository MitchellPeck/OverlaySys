"use client";
import { useLayoutEffect, useRef } from "react";
import type { SlideBudget } from "@overlaysys/scripture";
import { colors, fontFamily, Input, Textarea } from "@overlaysys/ui";
import { lyricSlideStats } from "@/lib/slideBreaks";
import type { SlideField } from "./slideFields";

const LINE_PX = 14 * 1.4;

/** Textarea sized to its content: 2 to 8 rows. */
function AutoTextarea(p: {
  value: string;
  onChange(v: string): void;
  invalid: boolean;
  label: string;
  describedBy?: string;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const min = 2 * LINE_PX + 14;
    const max = 8 * LINE_PX + 14;
    el.style.height = `${Math.min(max, Math.max(min, el.scrollHeight))}px`;
  }, [p.value]);
  return (
    <textarea
      ref={ref}
      value={p.value}
      onChange={(e) => p.onChange(e.target.value)}
      aria-label={p.label}
      aria-describedby={p.describedBy}
      aria-invalid={p.invalid || undefined}
      autoFocus={p.autoFocus}
      rows={2}
      style={{
        width: "100%",
        boxSizing: "border-box",
        padding: "6px 8px",
        background: colors.surface2,
        border: `1px solid ${p.invalid ? colors.warn : colors.border}`,
        borderRadius: 6,
        color: colors.text,
        outline: "none",
        fontFamily: fontFamily.sans,
        fontSize: 14,
        lineHeight: 1.4,
        resize: "none",
        overflowY: "auto",
      }}
    />
  );
}

export function SlideTextEditor(p: {
  heading: string;
  fields: SlideField[];
  value: Record<string, string>;
  onChange(next: Record<string, string>): void;
  budget?: SlideBudget;
  autoFocus?: boolean;
}) {
  const set = (key: string, v: string) => p.onChange({ ...p.value, [key]: v });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 12 }}>
      <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: colors.text }}>{p.heading}</h2>
      {p.fields.map((f, i) => {
        const v = p.value[f.key] ?? "";
        const stats = f.multiline && p.budget ? lyricSlideStats(v.split("\n"), p.budget) : null;
        const over = !!stats && (stats.overChars || stats.overLines);
        const metaId = `slide-meta-${f.key}`;
        const focus = p.autoFocus && i === 0;
        return (
          <div key={f.key} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, color: colors.textDim }}>{f.label}</span>
            {f.multiline ? (
              <AutoTextarea
                value={v}
                onChange={(nv) => set(f.key, nv)}
                invalid={over}
                label={f.label}
                describedBy={stats ? metaId : undefined}
                autoFocus={focus}
              />
            ) : (
              <Input value={v} onChange={(e) => set(f.key, e.target.value)} aria-label={f.label} autoFocus={focus} />
            )}
            {stats && (
              <div id={metaId} style={{ fontSize: 11, color: over ? colors.warn : colors.textMuted }}>
                {stats.lines} line{stats.lines === 1 ? "" : "s"} · {stats.chars} character{stats.chars === 1 ? "" : "s"}
                {over && " · over budget, may not fit the template"}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
