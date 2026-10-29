"use client";

import { useRef, useState, type ReactNode } from "react";
import { Button, Pill, StatusDot, colors, fontSize, radius } from "@overlaysys/ui";
import { AnchoredPopover } from "@/app/components/AnchoredPopover";
import type { Tone } from "./shellStatus";
import type { StatusPopoverModel } from "./statusPopover";

/**
 * A status pill/dot in the top bar that is a real, keyboard-reachable button
 * and opens a details popover. Warn/bad states render as a bordered Pill so
 * they stand out; healthy states as a quiet dot + label. Every popover shares
 * one layout: a title row, detail lines, an action row (see statusPopover.ts).
 */
export function StatusPopoverButton({
  tone,
  label,
  ariaLabel,
  width = 280,
  model,
  onAction,
}: {
  tone: Tone;
  label: ReactNode;
  /** Full accessible name, e.g. "Server: connected — details". */
  ariaLabel: string;
  width?: number;
  model: StatusPopoverModel;
  /** Runs an action by id; the popover closes afterwards. */
  onAction?: (id: string) => void;
}) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const loud = tone === "warn" || tone === "bad";
  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          background: "transparent",
          border: "none",
          padding: loud ? 0 : "2px 4px",
          minHeight: 24,
          borderRadius: radius.pill,
          cursor: "pointer",
          display: "inline-flex",
          alignItems: "center",
        }}
      >
        {loud ? (
          <Pill tone={tone} style={{ pointerEvents: "none" }}>
            {label}
          </Pill>
        ) : (
          <StatusDot tone={tone} label={<span className="shell-status-label">{label}</span>} />
        )}
      </button>
      {open && (
        <AnchoredPopover anchorEl={ref.current} onClose={() => setOpen(false)} width={width}>
          <div aria-label={ariaLabel} style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: fontSize.sm }}>
            <div style={{ fontWeight: 600, color: colors.text }}>{model.title}</div>
            {model.lines.map((line, i) => (
              <div
                key={i}
                style={{ color: i === 0 ? colors.textDim : colors.text, wordBreak: "break-word", whiteSpace: "pre-wrap" }}
              >
                {line}
              </div>
            ))}
            {model.actions.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {model.actions.map((a, i) => (
                  <Button
                    key={a.id}
                    size="sm"
                    variant={i === 0 && (tone === "warn" || tone === "bad") ? "primary" : "secondary"}
                    disabled={!!a.disabled}
                    title={a.disabled}
                    onClick={() => {
                      setOpen(false);
                      onAction?.(a.id);
                    }}
                  >
                    {a.label}
                  </Button>
                ))}
              </div>
            )}
          </div>
        </AnchoredPopover>
      )}
    </>
  );
}
