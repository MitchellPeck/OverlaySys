"use client";

import { useState } from "react";
import { HelpCircle } from "lucide-react";
import { IconButton, Kbd, Tooltip, colors, fontSize } from "@overlaysys/ui";
import { AnchoredPopover } from "@/app/components/AnchoredPopover";

type Hint = { keys: string; text: string };

const SECTIONS: { title: string; hints: Hint[] }[] = [
  {
    title: "Canvas",
    hints: [
      { keys: "Space + drag", text: "Pan" },
      { keys: "Alt", text: "Drag without snapping" },
      { keys: "Arrows", text: "Nudge (Shift = 10 px)" },
      { keys: "Double-click", text: "Enter a group" },
    ],
  },
  {
    title: "Layers",
    hints: [
      { keys: "Drag", text: "Reorder" },
      { keys: "⇧-click", text: "Select several" },
      { keys: "⌘D", text: "Duplicate" },
      { keys: "⌘] / ⌘[", text: "Forward / backward" },
    ],
  },
  {
    title: "Timeline",
    hints: [
      { keys: "Space", text: "Play / pause" },
      { keys: "Home / End", text: "Jump to start / end" },
      { keys: "Alt + ← / →", text: "Step one frame" },
    ],
  },
];

/** "?" in the designer header: the canvas, layers and timeline hints that used to sit inline. */
export function HelpPopover() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const open = anchor !== null;
  return (
    <>
      <Tooltip content="Designer shortcuts">
        <IconButton
          aria-label="Designer shortcuts"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={(e) => setAnchor(open ? null : e.currentTarget)}
        >
          <HelpCircle size={16} aria-hidden />
        </IconButton>
      </Tooltip>
      {open && (
        <AnchoredPopover anchorEl={anchor} onClose={() => setAnchor(null)} width={300}>
          <div aria-label="Designer shortcuts" style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: fontSize.sm }}>
            {SECTIONS.map((s) => (
              <section key={s.title}>
                <div
                  style={{
                    fontSize: fontSize.xs,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: "0.04em",
                    color: colors.textMuted,
                    marginBottom: 4,
                  }}
                >
                  {s.title}
                </div>
                <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "112px 1fr", gap: "4px 10px", alignItems: "center" }}>
                  {s.hints.map((h) => (
                    <div key={h.keys} style={{ display: "contents" }}>
                      <dt style={{ margin: 0 }}>
                        <Kbd>{h.keys}</Kbd>
                      </dt>
                      <dd style={{ margin: 0, color: colors.textDim }}>{h.text}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        </AnchoredPopover>
      )}
    </>
  );
}
