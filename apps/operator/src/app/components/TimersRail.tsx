"use client";

import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Button, colors, fontSize, fontWeight } from "@overlaysys/ui";
import { AnchoredPopover } from "./AnchoredPopover";
import { ActiveTimersPanel } from "./ActiveTimersPanel";
import { StageTimersSection } from "./StageTimersSection";
import { TimerPanel } from "./TimerPanel";

/** Drawer body for the Timers section: stage timers, then graphic timers on air. */
export function TimersRail() {
  const [graphicOpen, setGraphicOpen] = useState(false);
  const [stageFormOpen, setStageFormOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", gap: 6, padding: "8px 8px 0" }}>
        <Button
          size="sm"
          variant="ghost"
          icon={<Plus size={14} />}
          aria-expanded={stageFormOpen}
          onClick={() => setStageFormOpen((v) => !v)}
        >
          Stage timer
        </Button>
        <span ref={anchorRef} style={{ display: "inline-flex" }}>
          <Button size="sm" variant="ghost" icon={<Plus size={14} />} onClick={() => setGraphicOpen((v) => !v)}>
            Graphic timer
          </Button>
        </span>
      </div>
      <div style={{ padding: 8 }}>
        <StageTimersSection formOpen={stageFormOpen} onFormClose={() => setStageFormOpen(false)} />
        <ActiveTimersPanel />
      </div>
      {graphicOpen && (
        <AnchoredPopover anchorEl={anchorRef.current} onClose={() => setGraphicOpen(false)} width={340} placement="left" avoidSelector="[data-live-monitors]">
          <div style={{ fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.text, padding: "2px 2px 8px" }}>
            New graphic timer
          </div>
          <TimerPanel />
        </AnchoredPopover>
      )}
    </div>
  );
}
