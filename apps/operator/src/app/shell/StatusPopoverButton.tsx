"use client";

import { useRef, useState, type ReactNode } from "react";
import { Pill, StatusDot, colors, fontSize, radius } from "@overlaysys/ui";
import { AnchoredPopover } from "@/app/components/AnchoredPopover";
import type { Tone } from "./shellStatus";

/**
 * A status pill/dot in the top bar that is a real, keyboard-reachable button
 * and opens a details popover. Warn/bad states render as a bordered Pill so
 * they stand out; healthy states as a quiet dot + label.
 */
export function StatusPopoverButton({
  tone,
  label,
  ariaLabel,
  width = 280,
  children,
}: {
  tone: Tone;
  label: ReactNode;
  /** Full accessible name, e.g. "Server: connected — details". */
  ariaLabel: string;
  width?: number;
  children: (close: () => void) => ReactNode;
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
            {children(() => setOpen(false))}
          </div>
        </AnchoredPopover>
      )}
    </>
  );
}

/** Small "key: value" line used inside status popovers. */
export function DetailLine({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
      <span style={{ color: colors.textDim, minWidth: 64 }}>{label}</span>
      <span style={{ color: colors.text, wordBreak: "break-all" }}>{children}</span>
    </div>
  );
}
