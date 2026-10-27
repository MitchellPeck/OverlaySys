import { useLayoutEffect, useRef, useState } from "react";
import type { Draft } from "immer";
import type { StageFeed, StageLayout, StageRect, StageWidget } from "@overlaysys/core";
import { StageWidgetView } from "@overlaysys/stage-widgets";
import { fitScale } from "./utils";
import { SNAP_SCREEN_PX, type Guide, type ResizeHandle } from "./stageGeometry";
import { dragMove, dragResize, normalizeMarquee, nudgeForKey, pastDragThreshold, widgetsInMarquee } from "./stageCanvasMath";

export type StageCanvasProps = {
  layout: StageLayout;
  /** Sample feed; its `.layout` is ignored, `layout` is drawn. */
  feed: StageFeed;
  nowMs: number;
  selectedIds: string[];
  onSelect(ids: string[], additive: boolean): void;
  onLive(recipe: (d: Draft<StageLayout>) => void): void;
  onCommit(recipe: (d: Draft<StageLayout>) => void): void;
  onPushHistory(): void;
  /** The page commits nudgeWidgets(selectedIds, dx, dy). */
  onNudge(dx: number, dy: number): void;
};

type Point = { x: number; y: number };

type DragBase = { pointerId: number; startClient: Point; scale: number; started: boolean };
type DragState =
  | (DragBase & { kind: "move"; primaryId: string; start: Record<string, StageRect>; others: StageRect[] })
  | (DragBase & { kind: "resize"; id: string; handle: ResizeHandle; start: StageRect; others: StageRect[] })
  | (DragBase & { kind: "marquee"; origin: Point; lastIds: string });

const HOST_PADDING = 32;
const SELECT_COLOR = "#4ade80";
const GUIDE_COLOR = "#ff00ff";

const HANDLES: { handle: ResizeHandle; fx: number; fy: number; cursor: string }[] = [
  { handle: "nw", fx: 0, fy: 0, cursor: "nwse-resize" },
  { handle: "n", fx: 0.5, fy: 0, cursor: "ns-resize" },
  { handle: "ne", fx: 1, fy: 0, cursor: "nesw-resize" },
  { handle: "e", fx: 1, fy: 0.5, cursor: "ew-resize" },
  { handle: "se", fx: 1, fy: 1, cursor: "nwse-resize" },
  { handle: "s", fx: 0.5, fy: 1, cursor: "ns-resize" },
  { handle: "sw", fx: 0, fy: 1, cursor: "nesw-resize" },
  { handle: "w", fx: 0, fy: 0.5, cursor: "ew-resize" },
];

function isEditable(el: Element | null): boolean {
  const ae = el as HTMLElement | null;
  if (!ae) return false;
  const tag = ae.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || ae.isContentEditable;
}

function applyRects(rects: Record<string, StageRect>) {
  return (d: Draft<StageLayout>) => {
    for (const w of d.widgets) {
      const r = rects[w.id];
      if (r) w.rect = r;
    }
  };
}

/** Interactive stage-layout canvas: select, marquee, move, resize, snap, nudge. */
export function StageCanvas(props: StageCanvasProps) {
  const { layout, feed, nowMs, selectedIds } = props;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [scale, setScale] = useState(1);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [marquee, setMarquee] = useState<StageRect | null>(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ro = new ResizeObserver(() => {
      const r = host.getBoundingClientRect();
      const next = fitScale(layout.size.w, layout.size.h, r.width - HOST_PADDING, r.height - HOST_PADDING);
      if (next > 0) setScale(next);
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, [layout.size.w, layout.size.h]);

  const selected = new Set(selectedIds);
  const single = selectedIds.length === 1 ? layout.widgets.find((w) => w.id === selectedIds[0]) : undefined;
  const resizable = single && !single.locked ? single : undefined;

  function toCanvas(clientX: number, clientY: number): Point {
    const r = stageRef.current!.getBoundingClientRect();
    return { x: (clientX - r.left) / scale, y: (clientY - r.top) / scale };
  }

  /** Snap targets: every visible widget outside the moving set. */
  function otherRects(moving: Set<string>): StageRect[] {
    return layout.widgets.filter((w) => !w.hidden && !moving.has(w.id)).map((w) => w.rect);
  }

  function begin(e: React.PointerEvent, state: DragState) {
    hostRef.current?.setPointerCapture(e.pointerId);
    hostRef.current?.focus({ preventScroll: true });
    dragRef.current = state;
  }

  function base(e: React.PointerEvent): DragBase {
    return { pointerId: e.pointerId, startClient: { x: e.clientX, y: e.clientY }, scale, started: false };
  }

  function onWidgetPointerDown(e: React.PointerEvent, w: StageWidget) {
    if (e.button !== 0) return;
    e.stopPropagation();
    hostRef.current?.focus({ preventScroll: true });
    if (e.shiftKey) {
      props.onSelect([w.id], true);
      return;
    }
    const ids = selected.has(w.id) ? selectedIds : [w.id];
    if (!selected.has(w.id)) props.onSelect([w.id], false);
    if (w.locked) return;
    const start: Record<string, StageRect> = {};
    for (const sw of layout.widgets) if (ids.includes(sw.id) && !sw.locked) start[sw.id] = sw.rect;
    begin(e, { ...base(e), kind: "move", primaryId: w.id, start, others: otherRects(new Set(ids)) });
  }

  function onHandlePointerDown(e: React.PointerEvent, handle: ResizeHandle) {
    if (e.button !== 0 || !resizable) return;
    e.stopPropagation();
    begin(e, {
      ...base(e),
      kind: "resize",
      id: resizable.id,
      handle,
      start: resizable.rect,
      others: otherRects(new Set([resizable.id])),
    });
  }

  function onBackgroundPointerDown(e: React.PointerEvent) {
    if (e.button !== 0 || !stageRef.current) return;
    begin(e, { ...base(e), kind: "marquee", origin: toCanvas(e.clientX, e.clientY), lastIds: "" });
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dxS = e.clientX - d.startClient.x;
    const dyS = e.clientY - d.startClient.y;
    if (!d.started) {
      if (!pastDragThreshold(dxS, dyS)) return;
      d.started = true;
      if (d.kind !== "marquee") props.onPushHistory();
    }
    const dx = dxS / d.scale;
    const dy = dyS / d.scale;
    const threshold = e.altKey ? 0 : SNAP_SCREEN_PX / d.scale;
    if (d.kind === "move") {
      const out = dragMove(d.start, d.primaryId, dx, dy, d.others, layout.size, threshold);
      props.onLive(applyRects(out.rects));
      setGuides(out.guides);
    } else if (d.kind === "resize") {
      const out = dragResize(d.start, d.handle, dx, dy, d.others, layout.size, threshold);
      props.onLive(applyRects({ [d.id]: out.rect }));
      setGuides(out.guides);
    } else {
      const m = normalizeMarquee(d.origin, toCanvas(e.clientX, e.clientY));
      setMarquee(m);
      const ids = widgetsInMarquee(layout.widgets, m);
      const key = ids.join("\n");
      if (key !== d.lastIds) {
        d.lastIds = key;
        props.onSelect(ids, false);
      }
    }
  }

  function endDrag(e: React.PointerEvent, cancelled: boolean) {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    hostRef.current?.releasePointerCapture?.(e.pointerId);
    dragRef.current = null;
    setGuides([]);
    setMarquee(null);
    // A plain click on the background clears the selection. Move/resize
    // commit nothing here: history was pushed at drag start and the draft is live.
    if (!cancelled && d.kind === "marquee" && !d.started) props.onSelect([], false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (isEditable(e.target as Element) || isEditable(document.activeElement)) return;
    if (e.altKey || e.metaKey || e.ctrlKey) return;
    const nudge = nudgeForKey(e.key, e.shiftKey);
    if (!nudge || selectedIds.length === 0) return;
    e.preventDefault();
    props.onNudge(nudge[0], nudge[1]);
  }

  const line = 1 / scale;
  const handleSize = 8 / scale;

  return (
    <div
      ref={hostRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onBackgroundPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endDrag(e, false)}
      onPointerCancel={(e) => endDrag(e, true)}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        background: "#0a0b0e",
        outline: "none",
        userSelect: "none",
        touchAction: "none",
      }}
    >
      <div
        ref={stageRef}
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: layout.size.w,
          height: layout.size.h,
          transform: `translate(-50%, -50%) scale(${scale})`,
          transformOrigin: "50% 50%",
          boxShadow: "0 0 0 1px var(--border, #2a2e36), 0 8px 40px rgba(0,0,0,0.6)",
        }}
      >
        <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: layout.background, pointerEvents: "none" }}>
          {layout.widgets.map((w) => (
            <StageWidgetView key={w.id} widget={w} feed={feed} nowMs={nowMs} />
          ))}
        </div>

        {layout.widgets.map((w) => {
          const isSel = selected.has(w.id);
          if (w.hidden && !isSel) return null;
          return (
            <div
              key={w.id}
              data-widget-id={w.id}
              onPointerDown={(e) => onWidgetPointerDown(e, w)}
              style={{
                position: "absolute",
                left: w.rect.x,
                top: w.rect.y,
                width: w.rect.w,
                height: w.rect.h,
                boxSizing: "border-box",
                cursor: w.locked ? "default" : "move",
                outline: isSel ? `${2 * line}px ${w.hidden ? "dashed" : "solid"} ${SELECT_COLOR}` : undefined,
                outlineOffset: -line,
              }}
            />
          );
        })}

        {resizable &&
          HANDLES.map((h) => (
            <div
              key={h.handle}
              onPointerDown={(e) => onHandlePointerDown(e, h.handle)}
              style={{
                position: "absolute",
                left: resizable.rect.x + resizable.rect.w * h.fx - handleSize / 2,
                top: resizable.rect.y + resizable.rect.h * h.fy - handleSize / 2,
                width: handleSize,
                height: handleSize,
                boxSizing: "border-box",
                background: SELECT_COLOR,
                border: `${line}px solid #0c0d10`,
                borderRadius: 2 * line,
                cursor: h.cursor,
              }}
            />
          ))}

        {guides.map((g, i) =>
          g.axis === "x" ? (
            <div
              key={i}
              style={{ position: "absolute", left: g.at - line / 2, top: 0, width: line, height: layout.size.h, background: GUIDE_COLOR, pointerEvents: "none" }}
            />
          ) : (
            <div
              key={i}
              style={{ position: "absolute", top: g.at - line / 2, left: 0, height: line, width: layout.size.w, background: GUIDE_COLOR, pointerEvents: "none" }}
            />
          ),
        )}

        {marquee && (
          <div
            style={{
              position: "absolute",
              left: marquee.x,
              top: marquee.y,
              width: marquee.w,
              height: marquee.h,
              border: `${line}px solid ${SELECT_COLOR}`,
              background: "rgba(74, 222, 128, 0.12)",
              pointerEvents: "none",
            }}
          />
        )}
      </div>

      <div
        style={{
          position: "absolute",
          bottom: 8,
          left: 12,
          fontSize: 11,
          color: "var(--text-dim, #9099a8)",
          fontFamily: "ui-monospace, monospace",
          pointerEvents: "none",
        }}
      >
        {layout.size.w}×{layout.size.h} · {(scale * 100).toFixed(0)}%
      </div>
    </div>
  );
}
