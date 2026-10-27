"use client";

import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Button, PanelHeader } from "@overlaysys/ui";
import { AnchoredPopover } from "./AnchoredPopover";
import { ActiveTimersPanel } from "./ActiveTimersPanel";
import { StageTimersSection } from "./StageTimersSection";
import { TimerPanel } from "./TimerPanel";

export function TimersRail() {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <PanelHeader
        title="Timers"
        right={
          <span ref={anchorRef}>
            <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <Plus size={14} /> New
            </Button>
          </span>
        }
      />
      <div style={{ padding: 12, overflow: "auto", flex: 1, minHeight: 0 }}>
        <StageTimersSection />
        <ActiveTimersPanel />
      </div>
      {open && (
        <AnchoredPopover anchorEl={anchorRef.current} onClose={() => setOpen(false)} width={560}>
          <TimerPanel />
        </AnchoredPopover>
      )}
    </div>
  );
}
