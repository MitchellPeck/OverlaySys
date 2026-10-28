import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Draft } from "immer";
import type { StageFeed, StageLayout, StageRect, StageWidget, StageWidgetKind } from "@overlaysys/core";
import { StageWidgetView } from "@overlaysys/stage-widgets";
import { fitScale, isEditableTarget } from "./utils";
import { SNAP_SCREEN_PX, type Guide, type ResizeHandle } from "./stageGeometry";
import { STAGE_WIDGET_DRAG_TYPE } from "./StagePalette";
import { GuideOverlays, ViewToolbar, useCanvasZoom, type GuideToggles } from "./canvasView";
import {
  dragMove,
  dragResize,
  marqueeSelection,
  nextMarqueeKey,
  normalizeMarquee,
  nudgeForKey,
  pastDragThreshold,
  sameRects,
  widgetsInMarquee,
} from "./stageCanvasMath";

export type StageCanvasProps = {
  layout: StageLayout;
  /** Sample feed; its `.layout` is ignored, `layout` is drawn. */
  feed: StageFeed;
  nowMs: number;
  selectedIds: string[];
  onSelect(ids: string[], additive: boolean): void;
  /** Applies a drag frame to the draft without touching history. */
  onLive(recipe: (d: Draft<StageLayout>) => void): void;
  /** Snapshot for undo; called once per drag, just before its first actual change. */
  onPushHistory(): void;
  /**
   * The browser cancelled a drag after onPushHistory: drop that snapshot and
   * restore it. Omitted, the canvas re-applies the start rects via onLive
   * (which leaves a no-op undo step behind).
   */
  onCancelDrag?(): void;
  /** The page commits nudgeWidgets(selectedIds, dx, dy). */
  onNudge(dx: number, dy: number): void;
  /**
   * A StagePalette button dropped on the canvas: `point` is in canvas px.
   * Omit it (e.g. read-only) and the canvas refuses palette drops.
   */
  onDropWidget?(kind: StageWidgetKind, point: { x: number; y: number }): void;
};

type Point = { x: number; y: number };

type DragBase = {
  pointerId: number;
  startClient: Point;
  /** Latest pointer position, so an Alt press/release can re-run the frame. */
  lastClient: Point;
  scale: number;
  started: boolean;
};
/** `pushed`: history was snapshotted (lazily, on the first frame that changes a rect). */
type DragState =
  | (DragBase & { kind: "move"; primaryId: string; start: Record<string, StageRect>; others: StageRect[]; pushed: boolean })
  | (DragBase & { kind: "resize"; id: string; handle: ResizeHandle; start: StageRect; others: StageRect[]; pushed: boolean })
  /** `base`: the selection a Shift-marquee adds to ([] for a plain marquee). */
  | (DragBase & { kind: "marquee"; origin: Point; lastIds: string | null; base: string[] });

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
  const [fit, setFit] = useState(1);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [marquee, setMarquee] = useState<StageRect | null>(null);
  const [overlays, setOverlays] = useState<GuideToggles>({ safe: false, center: false, thirds: false });
  // View: zoom (⌘+/−/0, ⌘+wheel) on top of fit-to-window; middle-drag or wheel pans.
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const panRef = useRef<{ pointerId: number; start: Point; startPan: Point } | null>(null);
  const { zoom, setZoom } = useCanvasZoom(hostRef, () => setPan({ x: 0, y: 0 }));
  const scale = fit * zoom;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    function onWheel(e: WheelEvent) {
      if (e.ctrlKey || e.metaKey) return; // zoom, handled by useCanvasZoom
      e.preventDefault();
      setPan((p) => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
    }
    host.addEventListener("wheel", onWheel, { passive: false });
    return () => host.removeEventListener("wheel", onWheel);
  }, []);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ro = new ResizeObserver(() => {
      const r = host.getBoundingClientRect();
      const next = fitScale(layout.size.w, layout.size.h, r.width - HOST_PADDING, r.height - HOST_PADDING);
      if (next > 0) setFit(next);
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
    const p = { x: e.clientX, y: e.clientY };
    return { pointerId: e.pointerId, startClient: p, lastClient: p, scale, started: false };
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
    // Locked selected widgets stay put, so they remain snap targets.
    begin(e, { ...base(e), kind: "move", primaryId: w.id, start, others: otherRects(new Set(Object.keys(start))), pushed: false });
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
      pushed: false,
    });
  }

  function onBackgroundPointerDown(e: React.PointerEvent) {
    if (e.button === 1) {
      e.preventDefault();
      hostRef.current?.setPointerCapture(e.pointerId);
      panRef.current = { pointerId: e.pointerId, start: { x: e.clientX, y: e.clientY }, startPan: pan };
      return;
    }
    if (e.button !== 0 || !stageRef.current) return;
    begin(e, {
      ...base(e),
      kind: "marquee",
      origin: toCanvas(e.clientX, e.clientY),
      lastIds: null,
      base: e.shiftKey ? [...selectedIds] : [],
    });
  }

  function onPointerMove(e: React.PointerEvent) {
    const pd = panRef.current;
    if (pd && pd.pointerId === e.pointerId) {
      setPan({ x: pd.startPan.x + e.clientX - pd.start.x, y: pd.startPan.y + e.clientY - pd.start.y });
      return;
    }
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    // A pointerup we never saw (e.g. released outside the window) ends the drag, keeping its result.
    if (e.buttons === 0) {
      endDrag(e, "up");
      return;
    }
    d.lastClient = { x: e.clientX, y: e.clientY };
    if (!d.started) {
      if (!pastDragThreshold(e.clientX - d.startClient.x, e.clientY - d.startClient.y)) return;
      d.started = true;
    }
    runFrame(d, e.altKey);
  }

  /** Apply the drag at `d.lastClient`. Alt disables snapping. */
  function runFrame(d: DragState, altKey: boolean) {
    const dx = (d.lastClient.x - d.startClient.x) / d.scale;
    const dy = (d.lastClient.y - d.startClient.y) / d.scale;
    const threshold = altKey ? 0 : SNAP_SCREEN_PX / d.scale;
    if (d.kind === "marquee") {
      const m = normalizeMarquee(d.origin, toCanvas(d.lastClient.x, d.lastClient.y));
      setMarquee(m);
      const ids = marqueeSelection(d.base, widgetsInMarquee(layout.widgets, m));
      const key = nextMarqueeKey(d.lastIds, ids);
      if (key !== null) {
        d.lastIds = key;
        props.onSelect(ids, false);
      }
      return;
    }
    let rects: Record<string, StageRect>;
    let start: Record<string, StageRect>;
    if (d.kind === "move") {
      const out = dragMove(d.start, d.primaryId, dx, dy, d.others, layout.size, threshold);
      rects = out.rects;
      start = d.start;
      setGuides(out.guides);
    } else {
      const out = dragResize(d.start, d.handle, dx, dy, d.others, layout.size, threshold);
      rects = { [d.id]: out.rect };
      start = { [d.id]: d.start };
      setGuides(out.guides);
    }
    // History is pushed lazily: a drag that never changes a rect leaves no undo step.
    if (!d.pushed) {
      if (sameRects(rects, start)) return;
      d.pushed = true;
      props.onPushHistory();
    }
    props.onLive(applyRects(rects));
  }

  /**
   * "up": normal release, the live draft is the result. "cancel": the browser
   * cancelled the gesture, so a started move/resize is put back where it began.
   * "lost": capture lost without a pointerup; keep what was there.
   */
  function endDrag(e: React.PointerEvent, how: "up" | "cancel" | "lost") {
    if (panRef.current?.pointerId === e.pointerId) {
      hostRef.current?.releasePointerCapture?.(e.pointerId);
      panRef.current = null;
      return;
    }
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    hostRef.current?.releasePointerCapture?.(e.pointerId);
    dragRef.current = null;
    setGuides([]);
    setMarquee(null);
    if (how === "cancel" && d.kind !== "marquee" && d.pushed) {
      if (props.onCancelDrag) props.onCancelDrag();
      else props.onLive(applyRects(d.kind === "move" ? d.start : { [d.id]: d.start }));
    }
    // A plain click on the background clears the selection (a Shift-click keeps it).
    if (how === "up" && d.kind === "marquee" && !d.started && d.base.length === 0) props.onSelect([], false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Alt") {
      rerunForAlt(true);
      return;
    }
    if (isEditableTarget(e.target) || isEditableTarget(document.activeElement)) return;
    if (e.altKey || e.metaKey || e.ctrlKey) return;
    const nudge = nudgeForKey(e.key, e.shiftKey);
    if (!nudge || selectedIds.length === 0) return;
    e.preventDefault();
    props.onNudge(nudge[0], nudge[1]);
  }

  function onKeyUp(e: React.KeyboardEvent) {
    if (e.key === "Alt") rerunForAlt(false);
  }

  /** Pressing or releasing Alt mid-drag toggles snapping without waiting for the pointer to move. */
  function rerunForAlt(altKey: boolean) {
    const d = dragRef.current;
    if (d && d.started && d.kind !== "marquee") runFrame(d, altKey);
  }

  function isPaletteDrag(e: React.DragEvent): boolean {
    return !!props.onDropWidget && Array.from(e.dataTransfer.types).includes(STAGE_WIDGET_DRAG_TYPE);
  }

  function onDragOver(e: React.DragEvent) {
    if (!isPaletteDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }

  function onDrop(e: React.DragEvent) {
    if (!isPaletteDrag(e) || !stageRef.current) return;
    e.preventDefault();
    const kind = e.dataTransfer.getData(STAGE_WIDGET_DRAG_TYPE) as StageWidgetKind;
    if (kind) props.onDropWidget?.(kind, toCanvas(e.clientX, e.clientY));
  }

  const line = 1 / scale;
  const handleSize = 8 / scale;

  return (
    <div
      ref={hostRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onPointerDown={onBackgroundPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endDrag(e, "up")}
      onPointerCancel={(e) => endDrag(e, "cancel")}
      onLostPointerCapture={(e) => endDrag(e, "lost")}
      onDragOver={onDragOver}
      onDrop={onDrop}
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
          transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
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

        <GuideOverlays w={layout.size.w} h={layout.size.h} scale={scale} show={overlays} />

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
        {layout.size.w}×{layout.size.h} · Alt: no snap
      </div>
      <ViewToolbar
        zoom={zoom}
        scale={scale}
        onZoom={(z) => {
          if (z === "fit") {
            setZoom(1);
            setPan({ x: 0, y: 0 });
          } else setZoom(z);
        }}
        guides={overlays}
        onGuides={setOverlays}
      />
    </div>
  );
}
