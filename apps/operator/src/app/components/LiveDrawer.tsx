"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, MonitorSpeaker, Timer, Zap } from "lucide-react";
import { IconButton, Switch, colors, fontSize, fontWeight } from "@overlaysys/ui";
import { drawerSectionKey, readBool } from "@/lib/liveDrawerModel";
import { useLivePrefs } from "../hooks/useLivePrefs";
import { TimersRail } from "./TimersRail";
import { StagePanel } from "./StagePanel";
import { HotcardsPanel } from "./HotcardsPanel";

/** Keeps clicks from leaving focus on the control, so Space/Enter still reach the console shortcuts. */
const noFocus = (e: React.MouseEvent) => e.preventDefault();

type SectionId = "timers" | "stage" | "hotcards";

const SECTIONS: { id: SectionId; title: string; icon: typeof Timer; label: string; body: () => ReactNode }[] = [
  { id: "timers", title: "Timers", icon: Timer, label: "Show timers", body: () => <TimersRail /> },
  { id: "stage", title: "Stage", icon: MonitorSpeaker, label: "Show stage controls", body: () => <StagePanel /> },
  { id: "hotcards", title: "Hotcards", icon: Zap, label: "Show hotcards", body: () => <HotcardsPanel /> },
];

/**
 * The Live page's right drawer: timers, stage controls and hotcards as
 * collapsible sections. Collapsed it shrinks to a 40 px icon rail. Hotcard
 * F-keys are handled by useGlobalShortcuts, so they keep working either way.
 */
export function LiveDrawer() {
  const { drawerOpen, setDrawerOpen, doubleClickTakes, setDoubleClickTakes } = useLivePrefs();
  const [open, setOpen] = useState<Record<SectionId, boolean> | null>(null);
  const [pendingScroll, setPendingScroll] = useState<SectionId | null>(null);
  const refs = useRef<Partial<Record<SectionId, HTMLElement | null>>>({});

  useEffect(() => {
    const s = typeof window === "undefined" ? null : window.localStorage;
    setOpen({
      timers: readBool(s, drawerSectionKey("timers"), true),
      stage: readBool(s, drawerSectionKey("stage"), true),
      hotcards: readBool(s, drawerSectionKey("hotcards"), true),
    });
  }, []);

  function setSection(id: SectionId, value: boolean): void {
    setOpen((cur) => ({ timers: true, stage: true, hotcards: true, ...cur, [id]: value }));
    try {
      window.localStorage.setItem(drawerSectionKey(id), String(value));
    } catch {
      // Not persisted; still applies this session.
    }
  }

  useEffect(() => {
    if (!drawerOpen || !pendingScroll) return;
    refs.current[pendingScroll]?.scrollIntoView?.({ block: "start" });
    setPendingScroll(null);
  }, [drawerOpen, pendingScroll]);

  if (!drawerOpen) {
    return (
      <aside
        aria-label="Live drawer"
        style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, paddingTop: 8, height: "100%", background: colors.surface }}
      >
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          return (
            <IconButton
              key={s.id}
              aria-label={s.label}
              onMouseDown={noFocus}
              title={s.label}
              onClick={() => {
                setSection(s.id, true);
                setDrawerOpen(true);
                setPendingScroll(s.id);
              }}
            >
              <Icon size={16} aria-hidden />
            </IconButton>
          );
        })}
      </aside>
    );
  }

  return (
    <aside aria-label="Live drawer" style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, background: colors.surface }}>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden" }}>
        {SECTIONS.map((s) => {
          const isOpen = open?.[s.id] ?? false;
          const Chevron = isOpen ? ChevronDown : ChevronRight;
          return (
            <section key={s.id} ref={(el) => { refs.current[s.id] = el; }} style={{ borderBottom: `1px solid ${colors.border}` }}>
              <button
                type="button"
                onMouseDown={noFocus}
                aria-expanded={isOpen}
                onClick={() => setSection(s.id, !isOpen)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  width: "100%",
                  height: 28,
                  padding: "0 8px",
                  background: colors.surface2,
                  border: "none",
                  borderBottom: isOpen ? `1px solid ${colors.border}` : "none",
                  color: colors.textDim,
                  fontSize: fontSize.xs,
                  fontWeight: fontWeight.semibold,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <Chevron size={14} aria-hidden />
                {s.title}
              </button>
              {isOpen && s.body()}
            </section>
          );
        })}
      </div>
      <footer style={{ flexShrink: 0, padding: "6px 8px", borderTop: `1px solid ${colors.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span onMouseDown={noFocus}>
          <Switch
            checked={doubleClickTakes}
            onChange={setDoubleClickTakes}
            label="Double-click takes to program"
          />
        </span>
        <IconButton aria-label="Collapse drawer" title="Collapse drawer" size={28} onMouseDown={noFocus} onClick={() => setDrawerOpen(false)}>
          <ChevronRight size={14} aria-hidden />
        </IconButton>
      </footer>
    </aside>
  );
}
