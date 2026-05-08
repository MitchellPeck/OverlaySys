import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Draft } from "immer";
import type { Template, Layer } from "@overlaysys/core";
import { mountTemplate, type MountedTemplate } from "@overlaysys/template-engine";
import { fitScale, findLayer } from "./utils";
import {
  isDoubleClick,
  pickGroupSelection,
  type ChainEntry,
  type LastClick,
} from "./groupSelection";

type Props = {
  template: Template;
  data: Record<string, string>;
  selectedLayerId: string | null;
  onSelectLayer: (id: string | null) => void;
  /**
   * The literal scrub state: which timeline is being viewed and where its
   * playhead sits. The Canvas always reflects this — no implicit
   * "design pose" fallback. Pass `{ timeline: "in", time: in.duration }`
   * to show the design pose.
   */
  scrub: { timeline: "in" | "out"; time: number };
  onCommit: (recipe: (d: Draft<Template>) => void) => void;
  onLive: (recipe: (d: Draft<Template>) => void) => void;
  onPushHistory: () => void;
};

type DragMode = "move" | "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

type DragState = {
  mode: DragMode;
  layerId: string;
  startX: number;
  startY: number;
  startTransform: Layer["transform"];
  scaleAtStart: number;
  moved: boolean;
};

type PanState = {
  startX: number;
  startY: number;
  startPan: { x: number; y: number };
};

export function Canvas(props: Props) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef<MountedTemplate | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const panDragRef = useRef<PanState | null>(null);
  const scaleRef = useRef(1);
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [enteredGroupId, setEnteredGroupId] = useState<string | null>(null);
  const lastClickRef = useRef<LastClick>({ time: 0, groupId: null });

  // Track space key for pan-mode cursor + pointerdown intercept. Ignore key
  // events that target editable controls so typing in inspector inputs is
  // unaffected.
  useEffect(() => {
    function isEditable(): boolean {
      const ae = document.activeElement as HTMLElement | null;
      if (!ae) return false;
      const tag = ae.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || ae.isContentEditable;
    }
    function onDown(e: KeyboardEvent) {
      if (e.code !== "Space") return;
      if (isEditable()) return;
      // Prevent the default page-scroll behaviour while space is being used
      // as a pan modifier.
      e.preventDefault();
      setSpaceHeld(true);
    }
    function onUp(e: KeyboardEvent) {
      if (e.code !== "Space") return;
      setSpaceHeld(false);
    }
    function onBlur() {
      setSpaceHeld(false);
    }
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  // Escape exits one level of group entry. Selection stays put — that
  // matches the "step out" intuition without surprising the user by
  // also clearing what they had selected.
  useEffect(() => {
    function isEditable(): boolean {
      const ae = document.activeElement as HTMLElement | null;
      if (!ae) return false;
      const tag = ae.tagName;
      return (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        ae.isContentEditable
      );
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (isEditable()) return;
      setEnteredGroupId(null);
      lastClickRef.current = { time: 0, groupId: null };
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Re-mount on template structure change.
  useEffect(() => {
    if (!stageRef.current) return;
    if (mountedRef.current) {
      mountedRef.current.destroy();
      mountedRef.current = null;
    }
    const m = mountTemplate(stageRef.current, props.template, props.data, {
      mode: "edit",
    });
    mountedRef.current = m;
    return () => {
      m.destroy();
      mountedRef.current = null;
    };
  }, [props.template]);

  useEffect(() => {
    setEnteredGroupId(null);
    lastClickRef.current = { time: 0, groupId: null };
  }, [props.template.id]);

  useEffect(() => {
    if (enteredGroupId && !findLayer(props.template.layers, enteredGroupId)) {
      setEnteredGroupId(null);
      lastClickRef.current = { time: 0, groupId: null };
    }
  }, [props.template.layers, enteredGroupId]);

  useEffect(() => {
    mountedRef.current?.update(props.data);
  }, [props.data]);

  useEffect(() => {
    const m = mountedRef.current;
    if (!m) return;
    // Both timelines target the same DOM. Whichever timeline is active gets
    // seeked to its scrub time; the other is parked at the boundary that
    // represents the design pose (`in` ends at design pose; `out` starts
    // at design pose) so we don't leave stale property values from the
    // previously-active timeline polluting the canvas.
    if (props.scrub.timeline === "in") {
      m.timelines.out.totalProgress(0).pause();
      m.seek("in", props.scrub.time);
    } else {
      m.timelines.in.totalProgress(1).pause();
      m.seek("out", props.scrub.time);
    }
  }, [props.scrub]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ro = new ResizeObserver(() => {
      const r = host.getBoundingClientRect();
      const padding = 32;
      const next = fitScale(props.template.size.w, props.template.size.h, r.width - padding, r.height - padding);
      scaleRef.current = next;
      setScale(next);
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, [props.template.size.w, props.template.size.h]);

  // Selection rect via live DOM bbox.
  const [selRect, setSelRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const recomputeSelRect = useCallback(() => {
    const m = mountedRef.current;
    const id = props.selectedLayerId;
    if (!m || !id) {
      setSelRect(null);
      return;
    }
    const node = m.nodes.get(id);
    const stage = stageRef.current;
    if (!node || !stage) {
      setSelRect(null);
      return;
    }
    const nr = node.getBoundingClientRect();
    const sr = stage.getBoundingClientRect();
    const s = scaleRef.current || 1;
    setSelRect({
      x: (nr.left - sr.left) / s,
      y: (nr.top - sr.top) / s,
      w: nr.width / s,
      h: nr.height / s,
    });
  }, [props.selectedLayerId]);

  useEffect(() => {
    recomputeSelRect();
  }, [recomputeSelRect, props.template, props.scrub, scale, pan]);

  useEffect(() => {
    if (!props.scrub) return;
    let raf = 0;
    const step = () => {
      recomputeSelRect();
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [props.scrub, recomputeSelRect]);

  // ─── Layer drag mechanics ───────────────────────────────────────────────

  function beginLayerDrag(captureTarget: HTMLElement, mode: DragMode, layerId: string, e: React.PointerEvent) {
    const layer = findLayer(props.template.layers, layerId);
    if (!layer) return;
    captureTarget.setPointerCapture(e.pointerId);
    props.onPushHistory();
    dragRef.current = {
      mode,
      layerId,
      startX: e.clientX,
      startY: e.clientY,
      startTransform: { ...layer.transform },
      scaleAtStart: scaleRef.current,
      moved: false,
    };
  }

  function applyLayerDrag(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    const dx = (e.clientX - d.startX) / d.scaleAtStart;
    const dy = (e.clientY - d.startY) / d.scaleAtStart;
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) d.moved = true;

    props.onLive((draft) => {
      const layer = findLayerInDraft(draft.layers, d.layerId);
      if (!layer) return;
      const t0 = d.startTransform;
      switch (d.mode) {
        case "move":
          layer.transform.x = t0.x + dx;
          layer.transform.y = t0.y + dy;
          break;
        case "e":
          if (t0.w !== undefined) layer.transform.w = Math.max(1, t0.w + dx);
          break;
        case "w":
          if (t0.w !== undefined) {
            layer.transform.w = Math.max(1, t0.w - dx);
            layer.transform.x = t0.x + dx;
          }
          break;
        case "s":
          if (t0.h !== undefined) layer.transform.h = Math.max(1, t0.h + dy);
          break;
        case "n":
          if (t0.h !== undefined) {
            layer.transform.h = Math.max(1, t0.h - dy);
            layer.transform.y = t0.y + dy;
          }
          break;
        case "se":
          if (t0.w !== undefined) layer.transform.w = Math.max(1, t0.w + dx);
          if (t0.h !== undefined) layer.transform.h = Math.max(1, t0.h + dy);
          break;
        case "sw":
          if (t0.w !== undefined) {
            layer.transform.w = Math.max(1, t0.w - dx);
            layer.transform.x = t0.x + dx;
          }
          if (t0.h !== undefined) layer.transform.h = Math.max(1, t0.h + dy);
          break;
        case "ne":
          if (t0.w !== undefined) layer.transform.w = Math.max(1, t0.w + dx);
          if (t0.h !== undefined) {
            layer.transform.h = Math.max(1, t0.h - dy);
            layer.transform.y = t0.y + dy;
          }
          break;
        case "nw":
          if (t0.w !== undefined) {
            layer.transform.w = Math.max(1, t0.w - dx);
            layer.transform.x = t0.x + dx;
          }
          if (t0.h !== undefined) {
            layer.transform.h = Math.max(1, t0.h - dy);
            layer.transform.y = t0.y + dy;
          }
          break;
      }
    });
  }

  function endLayerDrag(captureTarget: HTMLElement, e: React.PointerEvent) {
    if (!dragRef.current) return;
    captureTarget.releasePointerCapture?.(e.pointerId);
    dragRef.current = null;
  }

  // ─── Pan mechanics ──────────────────────────────────────────────────────

  function shouldPan(e: React.PointerEvent): boolean {
    // Middle-click anywhere, or space+left-click. Right-click reserved for
    // future context-menu work.
    if (e.button === 1) return true;
    if (e.button === 0 && spaceHeld) return true;
    return false;
  }

  function beginPan(captureTarget: HTMLElement, e: React.PointerEvent) {
    captureTarget.setPointerCapture(e.pointerId);
    panDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPan: { ...pan },
    };
  }

  function applyPan(e: React.PointerEvent) {
    const p = panDragRef.current;
    if (!p) return;
    setPan({
      x: p.startPan.x + (e.clientX - p.startX),
      y: p.startPan.y + (e.clientY - p.startY),
    });
  }

  function endPan(captureTarget: HTMLElement, e: React.PointerEvent) {
    if (!panDragRef.current) return;
    captureTarget.releasePointerCapture?.(e.pointerId);
    panDragRef.current = null;
  }

  function resetView() {
    setPan({ x: 0, y: 0 });
  }

  // ─── Stage event routing ────────────────────────────────────────────────

  function buildLayerChain(target: EventTarget | null): ChainEntry[] {
    const chain: ChainEntry[] = [];
    let el = target as HTMLElement | null;
    while (el && el !== stageRef.current) {
      const id = el.dataset["layerId"];
      if (id) {
        chain.push({ id, isGroup: el.dataset["layerType"] === "group" });
      }
      el = el.parentElement;
    }
    return chain;
  }

  function onStagePointerDown(e: React.PointerEvent) {
    if (shouldPan(e)) {
      e.preventDefault();
      e.stopPropagation();
      beginPan(stageRef.current!, e);
      return;
    }

    const chain = buildLayerChain(e.target);
    const now = performance.now();
    const last = lastClickRef.current;

    // Double-click detection: a second click within 300ms on the previously
    // selected group "enters" that group.
    if (isDoubleClick(last, now, chain, 300)) {
      const newEntered = last.groupId!;
      setEnteredGroupId(newEntered);
      const inner = pickGroupSelection(chain, newEntered);
      if (inner.kind === "select") {
        e.stopPropagation();
        props.onSelectLayer(inner.id);
        beginLayerDrag(stageRef.current!, "move", inner.id, e);
      } else if (inner.kind === "exit") {
        // Click landed on the group itself even after entering — clear.
        setEnteredGroupId(null);
        props.onSelectLayer(null);
      } else {
        props.onSelectLayer(null);
      }
      lastClickRef.current = { time: 0, groupId: null };
      return;
    }

    const result = pickGroupSelection(chain, enteredGroupId);

    if (result.kind === "background") {
      setEnteredGroupId(null);
      props.onSelectLayer(null);
      lastClickRef.current = { time: 0, groupId: null };
      return;
    }

    if (result.kind === "exit") {
      setEnteredGroupId(null);
      props.onSelectLayer(null);
      lastClickRef.current = { time: 0, groupId: null };
      return;
    }

    e.stopPropagation();
    props.onSelectLayer(result.id);
    beginLayerDrag(stageRef.current!, "move", result.id, e);

    const pickedIsGroup = chain.find((c) => c.id === result.id)?.isGroup === true;
    lastClickRef.current = {
      time: now,
      groupId: pickedIsGroup ? result.id : null,
    };
  }

  function onStagePointerMove(e: React.PointerEvent) {
    if (panDragRef.current) {
      applyPan(e);
      return;
    }
    applyLayerDrag(e);
  }

  function onStagePointerUp(e: React.PointerEvent) {
    if (panDragRef.current) {
      endPan(stageRef.current!, e);
      return;
    }
    if (stageRef.current) endLayerDrag(stageRef.current, e);
  }

  // Resize handle handlers.
  function onHandlePointerDown(e: React.PointerEvent, mode: DragMode) {
    if (!props.selectedLayerId) return;
    e.preventDefault();
    e.stopPropagation();
    beginLayerDrag(e.target as HTMLElement, mode, props.selectedLayerId, e);
  }
  function onHandlePointerMove(e: React.PointerEvent) {
    if (!dragRef.current) return;
    e.stopPropagation();
    applyLayerDrag(e);
  }
  function onHandlePointerUp(e: React.PointerEvent) {
    if (!dragRef.current) return;
    e.stopPropagation();
    endLayerDrag(e.target as HTMLElement, e);
  }

  // Host-level pan: middle-click on the empty area outside the stage.
  function onHostPointerDown(e: React.PointerEvent) {
    if (shouldPan(e)) {
      e.preventDefault();
      beginPan(hostRef.current!, e);
    }
  }
  function onHostPointerMove(e: React.PointerEvent) {
    if (panDragRef.current) applyPan(e);
  }
  function onHostPointerUp(e: React.PointerEvent) {
    if (panDragRef.current) endPan(hostRef.current!, e);
  }

  const cursor = panDragRef.current ? "grabbing" : spaceHeld ? "grab" : "default";

  return (
    <div
      ref={hostRef}
      onPointerDown={onHostPointerDown}
      onPointerMove={onHostPointerMove}
      onPointerUp={onHostPointerUp}
      onPointerCancel={onHostPointerUp}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        overflow: "hidden",
        background: "#0a0b0e",
        cursor,
      }}
    >
      <div
        ref={wrapperRef}
        style={{
          // Anchor the wrapper's geometric center at the host's geometric
          // center via left/top 50% + translate(-50%, -50%). This is robust
          // for elements whose layout size exceeds the host (flex centering
          // becomes unreliable in that case once you also apply scale).
          position: "absolute",
          left: "50%",
          top: "50%",
          width: props.template.size.w,
          height: props.template.size.h,
          transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
          transformOrigin: "50% 50%",
          backgroundImage:
            "linear-gradient(45deg, #1a1c20 25%, transparent 25%), linear-gradient(-45deg, #1a1c20 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #1a1c20 75%), linear-gradient(-45deg, transparent 75%, #1a1c20 75%)",
          backgroundSize: "32px 32px",
          backgroundPosition: "0 0, 0 16px, 16px -16px, -16px 0",
          boxShadow: "0 0 0 1px var(--border, #2a2e36), 0 8px 40px rgba(0,0,0,0.6)",
        }}
      >
        <div
          ref={stageRef}
          onPointerDown={onStagePointerDown}
          onPointerMove={onStagePointerMove}
          onPointerUp={onStagePointerUp}
          onPointerCancel={onStagePointerUp}
          style={{
            position: "absolute",
            inset: 0,
            cursor,
            userSelect: "none",
          }}
        />
        {selRect && (
          <SelectionOverlay
            rect={selRect}
            scale={scale}
            onHandlePointerDown={onHandlePointerDown}
            onHandlePointerMove={onHandlePointerMove}
            onHandlePointerUp={onHandlePointerUp}
          />
        )}
      </div>

      <Footer template={props.template} scale={scale} pan={pan} onReset={resetView} />
    </div>
  );
}

function findLayerInDraft(layers: Draft<Layer>[], id: string): Draft<Layer> | null {
  for (const l of layers) {
    if (l.id === id) return l;
    if (l.type === "group") {
      const f = findLayerInDraft(l.children, id);
      if (f) return f;
    }
  }
  return null;
}

function SelectionOverlay({
  rect,
  scale,
  onHandlePointerDown,
  onHandlePointerMove,
  onHandlePointerUp,
}: {
  rect: { x: number; y: number; w: number; h: number };
  scale: number;
  onHandlePointerDown: (e: React.PointerEvent, mode: DragMode) => void;
  onHandlePointerMove: (e: React.PointerEvent) => void;
  onHandlePointerUp: (e: React.PointerEvent) => void;
}) {
  const handleSize = 8 / scale;
  const half = handleSize / 2;
  const hs: { mode: DragMode; cx: number; cy: number; cursor: string }[] = [
    { mode: "nw", cx: 0, cy: 0, cursor: "nwse-resize" },
    { mode: "n", cx: rect.w / 2, cy: 0, cursor: "ns-resize" },
    { mode: "ne", cx: rect.w, cy: 0, cursor: "nesw-resize" },
    { mode: "e", cx: rect.w, cy: rect.h / 2, cursor: "ew-resize" },
    { mode: "se", cx: rect.w, cy: rect.h, cursor: "nwse-resize" },
    { mode: "s", cx: rect.w / 2, cy: rect.h, cursor: "ns-resize" },
    { mode: "sw", cx: 0, cy: rect.h, cursor: "nesw-resize" },
    { mode: "w", cx: 0, cy: rect.h / 2, cursor: "ew-resize" },
  ];
  return (
    <div
      style={{
        position: "absolute",
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        outline: `${2 / scale}px solid #4ade80`,
        outlineOffset: `${-1 / scale}px`,
        // Pure visual — clicks pass through to the layer underneath so the
        // stage's pointerdown handler picks them up for select+drag.
        pointerEvents: "none",
      }}
    >
      {hs.map((h) => (
        <div
          key={h.mode}
          onPointerDown={(e) => onHandlePointerDown(e, h.mode)}
          onPointerMove={onHandlePointerMove}
          onPointerUp={onHandlePointerUp}
          onPointerCancel={onHandlePointerUp}
          style={{
            position: "absolute",
            left: h.cx - half,
            top: h.cy - half,
            width: handleSize,
            height: handleSize,
            background: "#4ade80",
            border: `${1 / scale}px solid #0c0d10`,
            borderRadius: 2,
            cursor: h.cursor,
            pointerEvents: "auto",
          }}
        />
      ))}
    </div>
  );
}

function Footer({
  template,
  scale,
  pan,
  onReset,
}: {
  template: Template;
  scale: number;
  pan: { x: number; y: number };
  onReset: () => void;
}) {
  const panned = pan.x !== 0 || pan.y !== 0;
  return (
    <>
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
        {template.size.w}×{template.size.h} · {(scale * 100).toFixed(0)}%
      </div>
      <div
        style={{
          position: "absolute",
          bottom: 8,
          right: 12,
          fontSize: 11,
          color: "var(--text-dim, #9099a8)",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span style={{ pointerEvents: "none" }}>space + drag to pan · middle-click to pan</span>
        {panned && (
          <button
            onClick={onReset}
            style={{
              padding: "2px 8px",
              background: "var(--panel-2, #1c1f25)",
              color: "var(--text, #e9eaee)",
              border: "1px solid var(--border, #2a2e36)",
              borderRadius: 3,
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            Reset view
          </button>
        )}
      </div>
    </>
  );
}
