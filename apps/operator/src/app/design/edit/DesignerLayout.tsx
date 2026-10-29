"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { colors, fontSize } from "@overlaysys/ui";
import { TIMELINE_HEIGHT_KEY, clampTimelineHeight, defaultTimelineHeight, readStoredTimelineHeight } from "./timelineSize";

const HEADER_H = 40;
const HANDLE_H = 6;
const WIDE_MIN_W = 1440;
const KEY_STEP = 16;

/** Live window size (SSR: a 1280×800 guess, replaced on mount). */
function useViewport(): { w: number; h: number } {
  const [vp, setVp] = useState({ w: 1280, h: 800 });
  useEffect(() => {
    const read = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);
  return vp;
}

function readStored(): number | null {
  try {
    return readStoredTimelineHeight(localStorage.getItem(TIMELINE_HEIGHT_KEY));
  } catch {
    return null;
  }
}

function writeStored(h: number | null) {
  try {
    if (h === null) localStorage.removeItem(TIMELINE_HEIGHT_KEY);
    else localStorage.setItem(TIMELINE_HEIGHT_KEY, String(h));
  } catch {
    // Private mode / quota: the height just isn't remembered.
  }
}

/**
 * Header / layers · canvas · inspector / timeline. The timeline's height is
 * dragged with the separator above it and remembered across templates; until
 * then it fits the active timeline's tracks.
 */
export function DesignerLayout({
  header,
  layers,
  canvas,
  inspector,
  timeline,
  trackCount,
  banner,
}: {
  header: ReactNode;
  layers: ReactNode;
  canvas: ReactNode;
  inspector: ReactNode;
  timeline: ReactNode;
  /** Tracks in the active timeline; sizes the timeline until the user drags it. */
  trackCount: number;
  /** Error strip over the top of the canvas. */
  banner?: ReactNode;
}) {
  const vp = useViewport();
  const [stored, setStored] = useState<number | null>(null);
  useEffect(() => setStored(readStored()), []);
  const timelineH = stored !== null ? clampTimelineHeight(stored, vp.h) : defaultTimelineHeight(trackCount, vp.h);
  const inspectorW = vp.w >= WIDE_MIN_W ? 320 : 300;

  const dragRef = useRef<{ pointerId: number; startY: number; startH: number } | null>(null);
  function setHeight(h: number, persist: boolean) {
    const next = clampTimelineHeight(h, vp.h);
    setStored(next);
    if (persist) writeStored(next);
  }

  return (
    <div
      style={{
        height: "100%",
        display: "grid",
        gridTemplateColumns: `240px minmax(0, 1fr) ${inspectorW}px`,
        gridTemplateRows: `${HEADER_H}px minmax(0, 1fr) ${timelineH}px`,
        gap: 1,
        background: colors.border,
        overflow: "hidden",
      }}
    >
      <div style={{ gridColumn: "1 / -1", minWidth: 0, overflow: "hidden" }}>{header}</div>
      <div style={{ minWidth: 0, minHeight: 0, display: "flex" }}>{layers}</div>
      <div style={{ position: "relative", background: colors.bg, minWidth: 0, minHeight: 0, overflow: "hidden" }}>
        {canvas}
        {banner && <div style={{ position: "absolute", top: 0, left: 0, right: 0, zIndex: 2 }}>{banner}</div>}
      </div>
      <div style={{ minWidth: 0, minHeight: 0, display: "flex" }}>{inspector}</div>
      <div
        style={{
          gridColumn: "1 / -1",
          display: "grid",
          gridTemplateRows: `${HANDLE_H}px minmax(0, 1fr)`,
          minHeight: 0,
          overflow: "hidden",
          background: colors.surface,
        }}
      >
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize timeline"
          aria-valuenow={timelineH}
          aria-valuemin={140}
          aria-valuemax={clampTimelineHeight(Number.MAX_SAFE_INTEGER, vp.h)}
          tabIndex={0}
          title="Drag to resize · double-click to fit the tracks"
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            dragRef.current = { pointerId: e.pointerId, startY: e.clientY, startH: timelineH };
          }}
          onPointerMove={(e) => {
            const d = dragRef.current;
            if (!d || d.pointerId !== e.pointerId) return;
            setHeight(d.startH - (e.clientY - d.startY), false);
          }}
          onPointerUp={(e) => {
            const d = dragRef.current;
            if (!d || d.pointerId !== e.pointerId) return;
            dragRef.current = null;
            setHeight(d.startH - (e.clientY - d.startY), true);
          }}
          onPointerCancel={() => {
            const d = dragRef.current;
            dragRef.current = null;
            if (d) setHeight(d.startH, true);
          }}
          onDoubleClick={() => {
            setStored(null);
            writeStored(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp" || e.key === "ArrowDown") {
              // Keep the designer's arrow-key nudge off while the handle has focus.
              e.preventDefault();
              e.stopPropagation();
              e.nativeEvent.stopImmediatePropagation();
              setHeight(timelineH + (e.key === "ArrowUp" ? KEY_STEP : -KEY_STEP), true);
            }
          }}
          style={{ cursor: "row-resize", touchAction: "none", display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <span aria-hidden style={{ width: 32, height: 2, borderRadius: 1, background: colors.borderStrong }} />
        </div>
        <div style={{ minHeight: 0, overflow: "hidden" }}>{timeline}</div>
      </div>
    </div>
  );
}

/**
 * A layers / inspector column: one header style (11 px / 600 uppercase,
 * muted) over a scrolling body.
 */
export function DesignerPanel({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section style={{ flex: 1, minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", background: colors.surface }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, padding: "10px 12px 6px", minWidth: 0 }}>
        <h3
          style={{
            margin: 0,
            fontSize: fontSize.xs,
            fontWeight: 600,
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            color: colors.textMuted,
            flexShrink: 0,
          }}
        >
          {title}
        </h3>
        {subtitle && (
          <span style={{ fontSize: fontSize.xs, color: colors.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            · {subtitle}
          </span>
        )}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "0 12px 12px" }}>{children}</div>
    </section>
  );
}
