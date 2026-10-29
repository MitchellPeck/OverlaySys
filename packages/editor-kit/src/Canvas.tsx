import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { commitRect } from "./geometryCommit";
import type { Draft } from "immer";
import type { Template, Layer } from "@overlaysys/core";
import { mountTemplate, type MountedTemplate } from "@overlaysys/template-engine";
import { colors } from "@overlaysys/ui";
import { fitScale, findLayer } from "./utils";
import { escAction } from "./groupSelection";
import {
  isDoubleClick,
  pickGroupSelection,
  type ChainEntry,
  type LastClick,
} from "./groupSelection";
import { SNAP_SCREEN_PX, type Guide, type ResizeHandle } from "./stageGeometry";
import {
  dragMove,
  dragResize,
  marqueeSelection,
  nextMarqueeKey,
  normalizeMarquee,
  pastDragThreshold,
  rectsIntersect,
} from "./stageCanvasMath";
import { GuideOverlays, ViewToolbar, useCanvasZoom, type GuideToggles } from "./canvasView";
import { hasTrack, locateLayer, topmostIds, upsertKeyframe, visibleArtboardRect } from "./templateOps";

type Recipe = (d: Draft<Template>) => void;

type Props = {
  template: Template;
  data: Record<string, string>;
  /** Primary selection (inspector target). */
  selectedLayerId: string | null;
  /** Every selected layer; defaults to the primary alone. */
  selectedLayerIds?: string[];
  onSelectLayer: (id: string | null) => void;
  /** Replace the selection, or toggle ids (Shift-click / Shift-marquee). Falls back to onSelectLayer. */
  onSelectLayers?: (ids: string[], additive: boolean) => void;
  /**
   * The literal scrub state: which timeline is being viewed and where its
   * playhead sits. The Canvas always reflects this — no implicit
   * "design pose" fallback. Pass `{ timeline: "in", time: in.duration }`
   * to show the design pose.
   */
  scrub: { timeline: "in" | "out"; time: number };
  onCommit: (recipe: Recipe) => void;
  onLive: (recipe: Recipe) => void;
  /** Snapshot for undo; called once per drag, just before its first actual change. */
  onPushHistory: () => void;
  /** The browser cancelled a drag after onPushHistory: drop that snapshot and restore it. */
  onCancelDrag?: () => void;
  /** Set to true on the first pointer move while Space is held (so the page can skip its tap-to-play). */
  spacePannedRef?: React.MutableRefObject<boolean>;
  /** A pointerdown on the pasteboard (outside the artboard) with no pan. */
  onPasteboardClick?: () => void;
  /** Filled with a getter for the artboard area currently on screen (artboard px), e.g. to place new layers. */
  visibleAreaRef?: React.MutableRefObject<(() => Rect) | null>;
};

type Point = { x: number; y: number };
type Rect = { x: number; y: number; w: number; h: number };

type DragBase = { pointerId: number; startClient: Point; lastClient: Point; scale: number; started: boolean };

/**
 * Per moving layer: its start transform rect, plus the animated x/y offset it
 * had at the playhead when the drag began (used when that axis is auto-keyed).
 */
type MoveItem = { id: string; start: Rect; anim: Point; keyX: boolean; keyY: boolean };

type DragState =
  | (DragBase & { kind: "move"; primaryId: string; items: MoveItem[]; others: Rect[]; box: { w: number; h: number }; pushed: boolean })
  | (DragBase & { kind: "resize"; item: MoveItem; handle: ResizeHandle; others: Rect[]; box: { w: number; h: number }; pushed: boolean })
  | (DragBase & { kind: "marquee"; origin: Point; lastIds: string | null; base: string[] });

type PanState = {
  startX: number;
  startY: number;
  startPan: { x: number; y: number };
};

/** Selection is blue (accent); green means preview / next [D5]. */
const SELECT_COLOR = colors.accent;
const GUIDE_COLOR = "#ff00ff";
const MIN_LAYER_SIZE = 1;
const HOST_PADDING = 32;
const EMPTY_IMAGE_CSS = `.ovs-edit-stage img[data-layer-type="image"]:not([src]),
.ovs-edit-stage img[data-layer-type="image"][src=""] {
  background-color: ${colors.surface3};
  background-image: linear-gradient(45deg, ${colors.borderStrong} 25%, transparent 25%, transparent 75%, ${colors.borderStrong} 75%),
    linear-gradient(45deg, ${colors.borderStrong} 25%, transparent 25%, transparent 75%, ${colors.borderStrong} 75%);
  background-size: 24px 24px;
  background-position: 0 0, 12px 12px;
  outline: 1px dashed ${colors.textMuted};
  outline-offset: -1px;
}`;

const HANDLES: { mode: ResizeHandle; fx: number; fy: number; cursor: string }[] = [
  { mode: "nw", fx: 0, fy: 0, cursor: "nwse-resize" },
  { mode: "n", fx: 0.5, fy: 0, cursor: "ns-resize" },
  { mode: "ne", fx: 1, fy: 0, cursor: "nesw-resize" },
  { mode: "e", fx: 1, fy: 0.5, cursor: "ew-resize" },
  { mode: "se", fx: 1, fy: 1, cursor: "nwse-resize" },
  { mode: "s", fx: 0.5, fy: 1, cursor: "ns-resize" },
  { mode: "sw", fx: 0, fy: 1, cursor: "nesw-resize" },
  { mode: "w", fx: 0, fy: 0.5, cursor: "ew-resize" },
];

function sameRect(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

function isEditable(): boolean {
  const ae = document.activeElement as HTMLElement | null;
  if (!ae) return false;
  const tag = ae.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || ae.isContentEditable;
}

export function Canvas(props: Props) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef<MountedTemplate | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const panDragRef = useRef<PanState | null>(null);
  const scaleRef = useRef(1);
  const [fit, setFit] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [enteredGroupId, setEnteredGroupId] = useState<string | null>(null);
  const [snapGuides, setSnapGuides] = useState<Guide[]>([]);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [overlays, setOverlays] = useState<GuideToggles>({ safe: false, center: false, thirds: false });
  const lastClickRef = useRef<LastClick>({ time: 0, groupId: null });
  const { zoom, setZoom } = useCanvasZoom(hostRef, () => setPan({ x: 0, y: 0 }));
  const scale = fit * zoom;
  scaleRef.current = scale;
  const viewRef = useRef({ pan, scale, size: props.template.size });
  viewRef.current = { pan, scale, size: props.template.size };
  const visibleAreaRef = props.visibleAreaRef;
  useLayoutEffect(() => {
    if (!visibleAreaRef) return;
    // The getter reads the latest view when called, so it's installed once.
    visibleAreaRef.current = () => {
      const r = hostRef.current?.getBoundingClientRect();
      const v = viewRef.current;
      return visibleArtboardRect({ w: r?.width ?? 0, h: r?.height ?? 0 }, v.size, v.pan, v.scale);
    };
    return () => {
      visibleAreaRef.current = null;
    };
  }, [visibleAreaRef]);

  const selectedIds = props.selectedLayerIds ?? (props.selectedLayerId ? [props.selectedLayerId] : []);
  const selectedRef = useRef(selectedIds);
  selectedRef.current = selectedIds;
  const scrubRef = useRef(props.scrub);
  scrubRef.current = props.scrub;
  const templateRef = useRef(props.template);
  templateRef.current = props.template;

  function selectIds(ids: string[], additive: boolean) {
    if (props.onSelectLayers) props.onSelectLayers(ids, additive);
    else props.onSelectLayer(ids[ids.length - 1] ?? null);
  }

  // Track space key for pan-mode cursor + pointerdown intercept. Ignore key
  // events that target editable controls so typing in inspector inputs is
  // unaffected.
  useEffect(() => {
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

  // Escape exits one level of group entry, then clears the selection
  // (see escAction). Alt toggles snapping mid-drag.
  const escStateRef = useRef({ inGroup: false, hasSelection: false });
  escStateRef.current = { inGroup: enteredGroupId !== null, hasSelection: selectedIds.length > 0 };
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Alt") {
        rerunForAlt(e.type === "keydown");
        return;
      }
      if (e.type !== "keydown" || e.key !== "Escape") return;
      if (isEditable()) return;
      const act = escAction(escStateRef.current);
      if (act === "exit-group") {
        setEnteredGroupId(null);
        lastClickRef.current = { time: 0, groupId: null };
      } else if (act === "clear-selection") {
        selectIds([], false);
      }
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Mount / patch ──────────────────────────────────────────────────────

  // Tear down on unmount only; template changes patch in place.
  useEffect(
    () => () => {
      mountedRef.current?.destroy();
      mountedRef.current = null;
    },
    [],
  );

  // Edits restyle the existing DOM (a drag frame touches one layer); only a
  // structural change (layers added/removed/reordered, fields, fonts, size)
  // rebuilds the template.
  const [mountGen, setMountGen] = useState(0);
  useEffect(() => {
    if (!stageRef.current) return;
    const cur = mountedRef.current;
    if (cur && cur.patch(props.template)) return;
    cur?.destroy();
    const m = mountTemplate(stageRef.current, props.template, props.data, { mode: "edit" });
    mountedRef.current = m;
    m.scrub(scrubRef.current.timeline, scrubRef.current.time);
    setMountGen((g) => g + 1);
    void m.ready.then(() => {
      if (mountedRef.current === m) setMountGen((g) => g + 1);
    });
    // props.data is applied by its own effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    mountedRef.current?.scrub(props.scrub.timeline, props.scrub.time);
  }, [props.scrub]);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const ro = new ResizeObserver(() => {
      const r = host.getBoundingClientRect();
      const next = fitScale(props.template.size.w, props.template.size.h, r.width - HOST_PADDING, r.height - HOST_PADDING);
      if (next > 0) setFit(next);
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, [props.template.size.w, props.template.size.h]);

  // ─── Selection rects (live DOM bboxes, so they follow the animation) ────

  const domRect = useCallback((id: string): Rect | null => {
    const node = mountedRef.current?.nodes.get(id);
    const stage = stageRef.current;
    if (!node || !stage) return null;
    const nr = node.getBoundingClientRect();
    const sr = stage.getBoundingClientRect();
    const s = scaleRef.current || 1;
    return { x: (nr.left - sr.left) / s, y: (nr.top - sr.top) / s, w: nr.width / s, h: nr.height / s };
  }, []);

  const [selRects, setSelRects] = useState<{ id: string; rect: Rect }[]>([]);
  const selKey = selectedIds.join("\n");
  const recomputeSelRects = useCallback(() => {
    const out: { id: string; rect: Rect }[] = [];
    for (const id of selKey ? selKey.split("\n") : []) {
      const r = domRect(id);
      // Hidden layers (display: none) have no box to outline.
      if (r && (r.w > 0 || r.h > 0)) out.push({ id, rect: r });
    }
    setSelRects(out);
  }, [selKey, domRect]);

  // Scrubbing and playback change props.scrub every frame, which re-runs this;
  // no free-running animation-frame loop is needed.
  useEffect(() => {
    recomputeSelRects();
  }, [recomputeSelRects, props.template, props.scrub, scale, pan, mountGen]);

  // ─── Drag mechanics ─────────────────────────────────────────────────────

  function base(e: React.PointerEvent): DragBase {
    const p = { x: e.clientX, y: e.clientY };
    return { pointerId: e.pointerId, startClient: p, lastClient: p, scale: scaleRef.current, started: false };
  }

  /** Snapshot a layer for dragging: its rect and the auto-key state of x/y. */
  function moveItem(l: Layer): MoveItem {
    const t = templateRef.current;
    const which = scrubRef.current.timeline;
    const m = mountedRef.current;
    const keyX = hasTrack(t, which, l.id, "x");
    const keyY = hasTrack(t, which, l.id, "y");
    return {
      id: l.id,
      start: { x: l.transform.x, y: l.transform.y, w: l.transform.w ?? 0, h: l.transform.h ?? 0 },
      anim: {
        x: keyX ? (m?.getProperty(l.id, "x") ?? 0) : 0,
        y: keyY ? (m?.getProperty(l.id, "y") ?? 0) : 0,
      },
      keyX,
      keyY,
    };
  }

  /** On-screen rect of an item: its transform rect plus the animated offset. */
  function visual(it: MoveItem): Rect {
    return { ...it.start, x: it.start.x + it.anim.x, y: it.start.y + it.anim.y };
  }

  /** Snap targets and coordinate box for a layer: its visible siblings and its parent's box. */
  function context(primaryId: string, moving: Set<string>): { others: Rect[]; box: { w: number; h: number } } {
    const t = templateRef.current;
    const loc = locateLayer(t.layers, primaryId);
    const siblings = loc ? loc.siblings : t.layers;
    const others = siblings
      .filter((s) => s.visible && !moving.has(s.id) && s.transform.w !== undefined && s.transform.h !== undefined)
      .map((s) => visual(moveItem(s)));
    const parent = loc?.parent;
    const box =
      parent && parent.transform.w !== undefined && parent.transform.h !== undefined
        ? { w: parent.transform.w, h: parent.transform.h }
        : t.size;
    return { others, box };
  }

  function beginMove(e: React.PointerEvent, primaryId: string, ids: string[]) {
    const t = templateRef.current;
    const items: MoveItem[] = [];
    for (const id of topmostIds(t.layers, ids)) {
      const l = findLayer(t.layers, id);
      if (l && !l.locked) items.push(moveItem(l));
    }
    if (!items.some((i) => i.id === primaryId)) return;
    stageRef.current?.setPointerCapture(e.pointerId);
    const ctx = context(primaryId, new Set(items.map((i) => i.id)));
    dragRef.current = { ...base(e), kind: "move", primaryId, items, ...ctx, pushed: false };
  }

  /** Recipe placing `it` at visual rect `r`, writing auto-keyed axes to the playhead keyframe. */
  function place(it: MoveItem, r: Rect, resize: boolean): Recipe {
    const { timeline, time } = scrubRef.current;
    return (d) => {
      const loc = locateLayer(d.layers, it.id);
      if (!loc) return;
      const tr = loc.layer.transform;
      if (it.keyX && !resize) upsertKeyframe(timeline, it.id, "x", time, r.x - it.start.x)(d);
      else tr.x = r.x - it.anim.x;
      if (it.keyY && !resize) upsertKeyframe(timeline, it.id, "y", time, r.y - it.start.y)(d);
      else tr.y = r.y - it.anim.y;
      if (resize) {
        if (tr.w !== undefined) tr.w = r.w;
        if (tr.h !== undefined) tr.h = r.h;
      }
    };
  }

  function runFrame(d: DragState, altKey: boolean) {
    const dx = (d.lastClient.x - d.startClient.x) / d.scale;
    const dy = (d.lastClient.y - d.startClient.y) / d.scale;
    const threshold = altKey ? 0 : SNAP_SCREEN_PX / d.scale;
    if (d.kind === "marquee") {
      const m = normalizeMarquee(d.origin, toCanvas(d.lastClient.x, d.lastClient.y));
      setMarquee(m);
      const ids = marqueeSelection(d.base, layersInMarquee(m));
      const key = nextMarqueeKey(d.lastIds, ids);
      if (key !== null) {
        d.lastIds = key;
        selectIds(ids, false);
      }
      return;
    }
    let recipes: Recipe[];
    let changed: boolean;
    if (d.kind === "move") {
      const start: Record<string, Rect> = {};
      for (const it of d.items) start[it.id] = visual(it);
      const out = dragMove(start, d.primaryId, dx, dy, d.others, d.box, threshold);
      setSnapGuides(out.guides);
      changed = d.items.some((it) => !sameRect(out.rects[it.id]!, start[it.id]!));
      recipes = d.items.map((it) => place(it, commitRect(out.rects[it.id]!), false));
    } else {
      const it = d.item;
      const out = dragResize(visual(it), d.handle, dx, dy, d.others, d.box, threshold, MIN_LAYER_SIZE);
      setSnapGuides(out.guides);
      changed = !sameRect(out.rect, visual(it));
      recipes = [place(it, commitRect(out.rect, { minSize: MIN_LAYER_SIZE }), true)];
    }
    // History is pushed lazily: a click that never moves leaves no undo step.
    if (!d.pushed) {
      if (!changed) return;
      d.pushed = true;
      props.onPushHistory();
    }
    props.onLive((draft) => recipes.forEach((r) => r(draft)));
  }

  // The window key listener is bound once; reach the current render's runFrame.
  const runFrameRef = useRef(runFrame);
  runFrameRef.current = runFrame;
  function rerunForAlt(altKey: boolean) {
    const d = dragRef.current;
    if (d && d.started && d.kind !== "marquee") runFrameRef.current(d, altKey);
  }

  function onDragMove(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return false;
    if (e.buttons === 0) {
      endDrag(e, "up");
      return true;
    }
    d.lastClient = { x: e.clientX, y: e.clientY };
    if (!d.started) {
      if (!pastDragThreshold(e.clientX - d.startClient.x, e.clientY - d.startClient.y)) return true;
      d.started = true;
    }
    runFrame(d, e.altKey);
    return true;
  }

  /** "up": keep the result. "cancel": the browser cancelled; put a started drag back. */
  function endDrag(e: React.PointerEvent, how: "up" | "cancel") {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    stageRef.current?.releasePointerCapture?.(e.pointerId);
    dragRef.current = null;
    setSnapGuides([]);
    setMarquee(null);
    if (how === "cancel" && d.kind !== "marquee" && d.pushed) props.onCancelDrag?.();
    if (how === "up" && d.kind === "marquee" && !d.started && d.base.length === 0) {
      setEnteredGroupId(null);
      selectIds([], false);
    }
  }

  function toCanvas(clientX: number, clientY: number): Point {
    const r = stageRef.current!.getBoundingClientRect();
    const s = scaleRef.current || 1;
    return { x: (clientX - r.left) / s, y: (clientY - r.top) / s };
  }

  /** Visible layers at the current entry level whose on-screen box the marquee touches. */
  function layersInMarquee(m: Rect): string[] {
    const t = templateRef.current;
    const entered = enteredGroupId ? findLayer(t.layers, enteredGroupId) : null;
    const level = entered && entered.type === "group" ? entered.children : t.layers;
    const hits: string[] = [];
    for (const l of level) {
      if (!l.visible) continue;
      const r = domRect(l.id);
      if (r && rectsIntersect(r, m)) hits.push(l.id);
    }
    return hits;
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
    if (spaceHeld && props.spacePannedRef) props.spacePannedRef.current = true;
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

  function pickAndDrag(e: React.PointerEvent, id: string) {
    e.stopPropagation();
    if (e.shiftKey) {
      selectIds([id], true);
      return;
    }
    const sel = selectedRef.current;
    const ids = sel.includes(id) ? sel : [id];
    if (!sel.includes(id)) selectIds([id], false);
    beginMove(e, id, ids);
  }

  function onStagePointerDown(e: React.PointerEvent) {
    if (shouldPan(e)) {
      e.preventDefault();
      e.stopPropagation();
      beginPan(stageRef.current!, e);
      return;
    }
    if (e.button !== 0) return;

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
        pickAndDrag(e, inner.id);
      } else if (inner.kind === "exit") {
        // Click landed on the group itself even after entering — clear.
        setEnteredGroupId(null);
        selectIds([], false);
      } else {
        selectIds([], false);
      }
      lastClickRef.current = { time: 0, groupId: null };
      return;
    }

    const result = pickGroupSelection(chain, enteredGroupId);

    if (result.kind === "background" || result.kind === "exit") {
      // Empty canvas: start a marquee (a plain click clears the selection on release).
      lastClickRef.current = { time: 0, groupId: null };
      if (result.kind === "exit") setEnteredGroupId(null);
      e.stopPropagation();
      stageRef.current?.setPointerCapture(e.pointerId);
      dragRef.current = {
        ...base(e),
        kind: "marquee",
        origin: toCanvas(e.clientX, e.clientY),
        lastIds: null,
        base: e.shiftKey ? [...selectedRef.current] : [],
      };
      return;
    }

    pickAndDrag(e, result.id);

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
    onDragMove(e);
  }

  function onStagePointerUp(e: React.PointerEvent, how: "up" | "cancel") {
    if (panDragRef.current) {
      endPan(stageRef.current!, e);
      return;
    }
    endDrag(e, how);
  }

  // Resize handle handlers.
  function onHandlePointerDown(e: React.PointerEvent, handle: ResizeHandle, id: string) {
    if (e.button !== 0) return;
    const l = findLayer(templateRef.current.layers, id);
    if (!l || l.locked || l.transform.w === undefined || l.transform.h === undefined) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const item = moveItem(l);
    dragRef.current = { ...base(e), kind: "resize", item, handle, ...context(id, new Set([id])), pushed: false };
  }
  function onHandlePointerMove(e: React.PointerEvent) {
    if (!dragRef.current) return;
    e.stopPropagation();
    onDragMove(e);
  }
  function onHandlePointerUp(e: React.PointerEvent, how: "up" | "cancel") {
    if (!dragRef.current) return;
    e.stopPropagation();
    endDrag(e, how);
  }

  // Host-level pan: middle-click on the empty area outside the stage.
  function onHostPointerDown(e: React.PointerEvent) {
    if (shouldPan(e)) {
      e.preventDefault();
      beginPan(hostRef.current!, e);
      return;
    }
    if (e.button === 0 && !wrapperRef.current?.contains(e.target as Node)) props.onPasteboardClick?.();
  }
  function onHostPointerMove(e: React.PointerEvent) {
    if (panDragRef.current) applyPan(e);
  }
  function onHostPointerUp(e: React.PointerEvent) {
    if (panDragRef.current) endPan(hostRef.current!, e);
  }

  const cursor = panDragRef.current ? "grabbing" : spaceHeld ? "grab" : "default";
  const single = selRects.length === 1 ? findLayer(props.template.layers, selRects[0]!.id) : null;
  const resizable = single && !single.locked && single.transform.w !== undefined && single.transform.h !== undefined;
  const line = 1 / scale;

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
        touchAction: "none",
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
        {/* An image layer with no source would be invisible: show a checkerboard until one is set. */}
        <style>{EMPTY_IMAGE_CSS}</style>
        <div
          ref={stageRef}
          className="ovs-edit-stage"
          onPointerDown={onStagePointerDown}
          onPointerMove={onStagePointerMove}
          onPointerUp={(e) => onStagePointerUp(e, "up")}
          onPointerCancel={(e) => onStagePointerUp(e, "cancel")}
          style={{
            position: "absolute",
            inset: 0,
            cursor,
            userSelect: "none",
          }}
        />
        <GuideOverlays w={props.template.size.w} h={props.template.size.h} scale={scale} show={overlays} />
        {selRects.map(({ id, rect }) => (
          <SelectionOverlay
            key={id}
            id={id}
            rect={rect}
            scale={scale}
            handles={!!resizable}
            onHandlePointerDown={onHandlePointerDown}
            onHandlePointerMove={onHandlePointerMove}
            onHandlePointerUp={onHandlePointerUp}
          />
        ))}
        {snapGuides.map((g, i) =>
          g.axis === "x" ? (
            <div
              key={i}
              style={{ position: "absolute", left: g.at - line / 2, top: 0, width: line, height: props.template.size.h, background: GUIDE_COLOR, pointerEvents: "none" }}
            />
          ) : (
            <div
              key={i}
              style={{ position: "absolute", top: g.at - line / 2, left: 0, height: line, width: props.template.size.w, background: GUIDE_COLOR, pointerEvents: "none" }}
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
              background: colors.brandSubtle,
              pointerEvents: "none",
            }}
          />
        )}
      </div>

      {/* The size and the pan / snap hints live in the designer header ("?"). */}
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

function SelectionOverlay({
  id,
  rect,
  scale,
  handles,
  onHandlePointerDown,
  onHandlePointerMove,
  onHandlePointerUp,
}: {
  id: string;
  rect: Rect;
  scale: number;
  handles: boolean;
  onHandlePointerDown: (e: React.PointerEvent, mode: ResizeHandle, id: string) => void;
  onHandlePointerMove: (e: React.PointerEvent) => void;
  onHandlePointerUp: (e: React.PointerEvent, how: "up" | "cancel") => void;
}) {
  const handleSize = 8 / scale;
  const half = handleSize / 2;
  return (
    <div
      style={{
        position: "absolute",
        left: rect.x,
        top: rect.y,
        width: rect.w,
        height: rect.h,
        outline: `${2 / scale}px solid ${SELECT_COLOR}`,
        outlineOffset: `${-1 / scale}px`,
        // Pure visual — clicks pass through to the layer underneath so the
        // stage's pointerdown handler picks them up for select+drag.
        pointerEvents: "none",
      }}
    >
      {handles &&
        HANDLES.map((h) => (
          <div
            key={h.mode}
            onPointerDown={(e) => onHandlePointerDown(e, h.mode, id)}
            onPointerMove={onHandlePointerMove}
            onPointerUp={(e) => onHandlePointerUp(e, "up")}
            onPointerCancel={(e) => onHandlePointerUp(e, "cancel")}
            style={{
              position: "absolute",
              left: rect.w * h.fx - half,
              top: rect.h * h.fy - half,
              width: handleSize,
              height: handleSize,
              background: SELECT_COLOR,
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
