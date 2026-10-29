import type { Draft } from "immer";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Template, Track, Keyframe, EasingSpec, Layer } from "@overlaysys/core";
import { Checkbox, IconButton, Input, NumberInput, SegmentedControl, Select, colors, fontSize, radius, shadow } from "@overlaysys/ui";
import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Spline,
  Trash2,
  X,
} from "lucide-react";
import { EASING_PRESETS, EasingPicker } from "./EasingPicker";
import { findLayer } from "./utils";
import { useEditCoalescer } from "./editCoalescer";
import { ANIMATION_PRESETS, applyAnimationPreset, clampTimelineDuration, minTimelineDuration, type AnimationPreset } from "./templateOps";
import { TRACK_PAD, rulerTicks, timeToX, xToTime } from "./timelineRuler";
import { TRACK_PROPERTY_LABELS, groupTracksByLayer, layersMissingOut, missingOutMessage, type TrackGroup } from "./timelineLabels";

type Props = {
  template: Template;
  active: "in" | "out";
  setActive: (which: "in" | "out") => void;
  time: number;
  setTime: (t: number) => void;
  selectedLayerId: string | null;
  selectedKeyframe: { trackKey: string; index: number } | null;
  setSelectedKeyframe: (k: { trackKey: string; index: number } | null) => void;
  playing: boolean;
  loop: boolean;
  onPlay: () => void;
  onPause: () => void;
  onLoopToggle: () => void;
  onCommit: (recipe: (d: Draft<Template>) => void) => void;
  onLive: (recipe: (d: Draft<Template>) => void) => void;
  onPushHistory: () => void;
};

const TRACK_HEIGHT = 24;
const RULER_HEIGHT = 20;
const HEADER_WIDTH = 240;
const STEP_SECONDS = 1 / 30; // single-frame step at ~30fps
/** Visible diamond: an 8 px square turned 45° (~11 px across, so TRACK_PAD keeps the end ones whole). */
const DIAMOND = 8;
const CURVE_POPOVER_W = 340;
const CURVE_POPOVER_H = 200;

const ALL_PROPERTIES = [
  "x",
  "y",
  "rotation",
  "scaleX",
  "scaleY",
  "opacity",
  "w",
  "h",
  "wipe",
] as const;
type TrackProperty = (typeof ALL_PROPERTIES)[number];

const keyOf = (t: { layerId: string; property: string }) => `${t.layerId}::${t.property}`;

export function TimelinePanel(rawProps: Props) {
  // Typed values (duration, keyframe t/value) make one undo step per field edit.
  const { commit, handlers } = useEditCoalescer(rawProps.onCommit, rawProps.onLive);
  const props = { ...rawProps, onCommit: commit };
  const tl = props.template.timelines[props.active];
  const missingOut = props.active === "out" ? layersMissingOut(props.template) : [];

  return (
    <div
      {...handlers}
      style={{
        height: "100%",
        display: "grid",
        gridTemplateRows: "auto auto auto minmax(0, 1fr)",
        background: colors.surface,
        minHeight: 0,
      }}
    >
      <Toolbar {...props} />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          height: 32,
          padding: "0 8px",
          borderBottom: `1px solid ${colors.border}`,
          fontSize: fontSize.xs,
          minWidth: 0,
        }}
      >
        <KeyframeRow {...props} />
      </div>
      <MissingOutWarnings entries={missingOut} />
      <TrackArea {...props} tracks={tl.tracks} duration={tl.duration} />
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────

function Toolbar(props: Props) {
  const tl = props.template.timelines[props.active];
  const selectedLayer = props.selectedLayerId
    ? findLayer(props.template.layers, props.selectedLayerId)
    : null;
  const layerName = selectedLayer?.name ?? null;
  const outMissing = layersMissingOut(props.template).length > 0;

  // Properties not yet on this layer for this timeline.
  const usedForLayer = new Set(
    tl.tracks.filter((t) => t.layerId === props.selectedLayerId).map((t) => t.property),
  );

  function addTrack(property: TrackProperty) {
    if (!props.selectedLayerId || !selectedLayer) return;
    if (usedForLayer.has(property)) return; // double-guard, dropdown also disables it
    const initial = initialKeyframesFor(property, selectedLayer, tl.duration);
    props.onCommit((d) => {
      d.timelines[props.active].tracks.push({
        layerId: props.selectedLayerId!,
        property,
        keyframes: initial,
      });
    });
  }

  const minDur = minTimelineDuration(tl);

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 8,
        padding: "4px 8px",
        borderBottom: `1px solid ${colors.border}`,
        background: colors.surface2,
        fontSize: fontSize.xs,
        color: colors.textDim,
      }}
    >
      <SegmentedControl
        size="sm"
        aria-label="Timeline"
        value={props.active}
        onChange={props.setActive}
        options={[
          { value: "in", label: `In · ${fmtSec(props.template.timelines.in.duration)}` },
          {
            value: "out",
            label: (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                Out · {fmtSec(props.template.timelines.out.duration)}
                {outMissing && <AlertTriangle size={12} color={colors.warn} aria-label="Some layers have no out animation" />}
              </span>
            ),
            title: outMissing ? "Some layers have no out animation" : undefined,
          },
        ]}
      />
      <label
        style={{ display: "flex", alignItems: "center", gap: 4 }}
        title={`Timeline length. Can't be shorter than the last keyframe (${minDur.toFixed(2)}s): move or delete keyframes first.`}
      >
        Duration
        <span style={{ width: 72 }}>
          <NumberInput
            size="sm"
            aria-label="Duration"
            value={tl.duration}
            step={0.05}
            precision={2}
            min={minDur}
            suffix="s"
            onCommit={(v) =>
              props.onCommit((d) => {
                const t = d.timelines[props.active];
                t.duration = clampTimelineDuration(t, v);
              })
            }
          />
        </span>
      </label>

      <Transport
        time={props.time}
        duration={tl.duration}
        playing={props.playing}
        onSeek={(t) => {
          if (props.playing) props.onPause();
          props.setTime(t);
        }}
        onPlay={props.onPlay}
        onPause={props.onPause}
      />

      <span title="Loop the preview playback here in the editor">
        <Checkbox checked={props.loop} onChange={() => props.onLoopToggle()} label="Loop" />
      </span>

      <Select
        value=""
        onChange={(e) => {
          const v = e.target.value as AnimationPreset | "";
          e.currentTarget.value = "";
          if (!v || !props.selectedLayerId) return;
          props.onCommit(applyAnimationPreset(props.selectedLayerId, props.active, v));
        }}
        disabled={!props.selectedLayerId}
        aria-label={props.active === "in" ? "Animate in" : "Animate out"}
        title={
          props.selectedLayerId
            ? `Replace ${layerName ?? "the layer"}'s ${props.active} animation with a preset`
            : "Select a layer first"
        }
        style={{ width: "auto", opacity: props.selectedLayerId ? 1 : 0.5 }}
      >
        <option value="">{props.active === "in" ? "Animate in…" : "Animate out…"}</option>
        {ANIMATION_PRESETS.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </Select>

      {/* Property picker: select-as-action. The select is reset to "" on each
          change so the user can add the same property after deleting it. */}
      <Select
        value=""
        onChange={(e) => {
          const v = e.target.value as TrackProperty | "";
          e.currentTarget.value = "";
          if (!v) return;
          addTrack(v);
        }}
        disabled={!props.selectedLayerId}
        aria-label="Add track"
        title={props.selectedLayerId ? `Add a track to ${layerName ?? "the layer"}` : "Select a layer first"}
        style={{ width: "auto", opacity: props.selectedLayerId ? 1 : 0.5 }}
      >
        <option value="">
          {props.selectedLayerId ? `+ Track on ${layerName ?? "…"}` : "+ Track (select a layer)"}
        </option>
        {ALL_PROPERTIES.map((p) => {
          const used = usedForLayer.has(p);
          return (
            <option key={p} value={p} disabled={used}>
              {TRACK_PROPERTY_LABELS[p].label}
              {used ? " (added)" : ""}
            </option>
          );
        })}
      </Select>

    </div>
  );
}

function Transport({
  time,
  duration,
  playing,
  onSeek,
  onPlay,
  onPause,
}: {
  time: number;
  duration: number;
  playing: boolean;
  onSeek: (t: number) => void; // pauses playback if currently playing
  onPlay: () => void;
  onPause: () => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
      <IconButton aria-label="Jump to start" title="Jump to start" onClick={() => onSeek(0)}>
        <SkipBack size={14} />
      </IconButton>
      <IconButton
        aria-label="Step back one frame"
        title="Step back (1/30s)"
        onClick={() => onSeek(Math.max(0, time - STEP_SECONDS))}
      >
        <ChevronLeft size={14} />
      </IconButton>
      <IconButton
        aria-label={playing ? "Pause (Space)" : "Play (Space)"}
        title={playing ? "Pause (Space)" : "Play (Space)"}
        onClick={playing ? onPause : onPlay}
        style={playing ? undefined : { background: colors.brandFill, border: `1px solid ${colors.brandFill}`, color: "#fff" }}
      >
        {playing ? <Pause size={14} /> : <Play size={14} />}
      </IconButton>
      <IconButton
        aria-label="Step forward one frame"
        title="Step forward (1/30s)"
        onClick={() => onSeek(Math.min(duration, time + STEP_SECONDS))}
      >
        <ChevronRight size={14} />
      </IconButton>
      <IconButton aria-label="Jump to end" title="Jump to end" onClick={() => onSeek(duration)}>
        <SkipForward size={14} />
      </IconButton>
      <span style={{ minWidth: 44, textAlign: "right", fontVariantNumeric: "tabular-nums", color: colors.text }}>
        {fmtTime(time)}
      </span>
    </div>
  );
}

function fmtTime(t: number): string {
  return `${t.toFixed(2)}s`;
}

function MissingOutWarnings({ entries }: { entries: { layerId: string; name: string }[] }) {
  if (entries.length === 0) return <div />;
  return (
    <div
      role="status"
      style={{
        padding: "4px 10px",
        borderBottom: `1px solid ${colors.border}`,
        display: "flex",
        flexDirection: "column",
        gap: 2,
      }}
    >
      {entries.map((e) => (
        <div
          key={e.layerId}
          style={{ display: "flex", alignItems: "center", gap: 6, fontSize: fontSize.sm, color: colors.warn }}
        >
          <AlertTriangle size={12} aria-hidden />
          {missingOutMessage(e.name)}
        </div>
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────

/** `pushed`: history was snapshotted (on the first move, so a click only selects). */
type DragKf = { trackKey: string; index: number; startX: number; startT: number; pxPerSec: number; pushed: boolean };

/**
 * Track headers (left) and lanes (right) in one vertical scroller, so rows
 * always line up. Tracks are grouped under a collapsible layer header.
 */
function TrackArea(props: Props & { tracks: Track[]; duration: number }) {
  const { tracks, duration } = props;
  const activeTimeline = props.active;
  const groups = groupTracksByLayer(props.template.layers, tracks);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const laneRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragKf | null>(null);
  const [laneW, setLaneW] = useState(0);

  useLayoutEffect(() => {
    const el = laneRef.current;
    if (!el) return;
    setLaneW(el.clientWidth);
    const ro = new ResizeObserver(() => setLaneW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  function toggle(layerId: string) {
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(layerId)) n.delete(layerId);
      else n.add(layerId);
      return n;
    });
  }

  function deleteTrack(layerId: string, property: string) {
    if (props.selectedKeyframe?.trackKey === `${layerId}::${property}`) props.setSelectedKeyframe(null);
    props.onCommit((d) => {
      const tl = d.timelines[activeTimeline];
      tl.tracks = tl.tracks.filter((t) => !(t.layerId === layerId && t.property === property));
    });
  }

  function timeAtClientX(clientX: number): number {
    const r = (laneRef.current as HTMLElement).getBoundingClientRect();
    return xToTime(clientX - r.left, duration, r.width);
  }

  function startScrubDrag(e: React.PointerEvent) {
    // Document-level listeners (not pointer capture) so click/dblclick
    // targeting on the lane rows keeps working while the drag continues
    // outside the timeline. userSelect:none prevents text selection.
    e.stopPropagation();
    if (props.playing) props.onPause();
    props.setTime(timeAtClientX(e.clientX));
    const move = (ev: PointerEvent) => props.setTime(timeAtClientX(ev.clientX));
    const end = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", end);
      document.removeEventListener("pointercancel", end);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", end);
    document.addEventListener("pointercancel", end);
  }

  function startKfDrag(e: React.PointerEvent, trackKey: string, index: number, startT: number) {
    e.preventDefault();
    e.stopPropagation(); // prevents the scrub-drag from also starting
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    props.setSelectedKeyframe({ trackKey, index });
    const r = (laneRef.current as HTMLElement).getBoundingClientRect();
    dragRef.current = {
      trackKey,
      index,
      startX: e.clientX,
      startT,
      pxPerSec: Math.max(1, r.width - 2 * TRACK_PAD) / duration,
      pushed: false,
    };
  }
  function onLanePointerMove(e: React.PointerEvent) {
    if (!dragRef.current) return;
    const d = dragRef.current;
    const newT = clamp(d.startT + (e.clientX - d.startX) / d.pxPerSec, 0, duration);
    if (!d.pushed) {
      if (newT === d.startT) return;
      d.pushed = true;
      props.onPushHistory();
    }
    // Only `t` of the dragged keyframe changes; everything else is left as stored.
    props.onLive((draft) => {
      const kf = trackByKey(draft.timelines[activeTimeline].tracks, d.trackKey)?.keyframes[d.index];
      if (kf) kf.t = newT;
    });
  }
  function onLanePointerUp(e: React.PointerEvent) {
    if (!dragRef.current) return;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    dragRef.current = null;
    // Don't sort: gsap-timeline.ts sorts internally and sorting here
    // would invalidate selectedKeyframe.index.
  }

  function addKeyframeAt(track: Track, t: number) {
    const trackKey = keyOf(track);
    props.onCommit((draft) => {
      const found = trackByKey(draft.timelines[activeTimeline].tracks, trackKey);
      if (!found) return;
      const before = [...found.keyframes].reverse().find((k) => k.t < t);
      found.keyframes.push({ t, value: before?.value ?? 0, easing: "power2.out" });
    });
  }

  const ticks = rulerTicks(duration, Math.max(0, laneW - 2 * TRACK_PAD));
  const x = (t: number) => timeToX(t, duration, laneW);

  // Rows shared by both columns, so heights match by construction.
  type Row =
    | { kind: "group"; group: TrackGroup; open: boolean }
    | { kind: "track"; group: TrackGroup; track: Track; last: boolean };
  const rows: Row[] = [];
  for (const g of groups) {
    const open = !collapsed.has(g.layerId);
    rows.push({ kind: "group", group: g, open });
    if (open) g.tracks.forEach((e, i) => rows.push({ kind: "track", group: g, track: e.track, last: i === g.tracks.length - 1 }));
  }

  return (
    <div style={{ overflowY: "auto", overflowX: "hidden", minHeight: 0, position: "relative" }}>
      <div style={{ display: "flex", minHeight: "100%" }}>
        {/* Headers */}
        <div style={{ width: HEADER_WIDTH, flexShrink: 0, borderRight: `1px solid ${colors.border}` }}>
          <div
            style={{
              position: "sticky",
              top: 0,
              zIndex: 2,
              height: RULER_HEIGHT,
              background: colors.surface2,
              borderBottom: `1px solid ${colors.border}`,
            }}
          />
          {tracks.length === 0 && (
            <p style={{ fontSize: fontSize.xs, color: colors.textDim, padding: "8px 10px", margin: 0, lineHeight: 1.5 }}>
              No tracks. Select a layer, then use <strong>+ Track</strong> or <strong>Animate {props.active}…</strong>.
            </p>
          )}
          {rows.map((row) => {
            const isSel = row.group.layerId === props.selectedLayerId;
            if (row.kind === "group") {
              return (
                <button
                  key={`g:${row.group.layerId}`}
                  type="button"
                  onClick={() => toggle(row.group.layerId)}
                  aria-expanded={row.open}
                  aria-label={`${row.open ? "Collapse" : "Expand"} ${row.group.name} tracks`}
                  style={{
                    ...rowBase(),
                    width: "100%",
                    border: "none",
                    borderBottom: `1px solid ${colors.border}`,
                    borderLeft: `2px solid ${isSel ? colors.accent : "transparent"}`,
                    background: isSel ? colors.brandSubtle : colors.surface2,
                    color: colors.text,
                    fontWeight: 600,
                    cursor: "pointer",
                    textAlign: "left",
                    fontFamily: "inherit",
                  }}
                >
                  {row.open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
                  <span style={ellipsis}>{row.group.name}</span>
                  <span style={{ marginLeft: "auto", fontWeight: 400, color: colors.textMuted }}>
                    {row.group.tracks.length}
                  </span>
                </button>
              );
            }
            const meta = TRACK_PROPERTY_LABELS[row.track.property];
            return (
              <div
                key={keyOf(row.track)}
                style={{
                  ...rowBase(),
                  paddingLeft: 28,
                  borderBottom: `1px solid ${row.last ? colors.border : colors.surface2}`,
                  borderLeft: `2px solid ${isSel ? colors.accent : "transparent"}`,
                  background: isSel ? colors.brandSubtle : "transparent",
                }}
              >
                <span style={{ ...ellipsis, flex: 1 }}>{meta.label}</span>
                {meta.unit && <span style={{ color: colors.textMuted }}>{meta.unit}</span>}
                <IconButton
                  size={24}
                  aria-label={`Delete ${meta.label} track of ${row.group.name}`}
                  title="Delete track"
                  onClick={() => deleteTrack(row.track.layerId, row.track.property)}
                  style={{ border: "none" }}
                >
                  <X size={12} />
                </IconButton>
              </div>
            );
          })}
        </div>

        {/* Lanes */}
        <div
          ref={laneRef}
          style={{ flex: 1, minWidth: 0, position: "relative", userSelect: "none" }}
          onPointerDown={startScrubDrag}
          onPointerMove={onLanePointerMove}
          onPointerUp={onLanePointerUp}
          onPointerCancel={onLanePointerUp}
        >
          <div
            aria-hidden
            style={{
              position: "sticky",
              top: 0,
              zIndex: 2,
              height: RULER_HEIGHT,
              background: colors.surface2,
              borderBottom: `1px solid ${colors.border}`,
              cursor: "ew-resize",
              overflow: "hidden",
            }}
          >
            {ticks.minor.map((t) => (
              <div
                key={`m${t}`}
                style={{ position: "absolute", left: x(t), bottom: 0, height: 4, borderLeft: `1px solid ${colors.borderStrong}` }}
              />
            ))}
            {ticks.labels.map((l) => (
              <div key={`l${l.t}`} style={{ position: "absolute", left: x(l.t), top: 0, bottom: 0 }}>
                <div style={{ position: "absolute", bottom: 0, height: 8, borderLeft: `1px solid ${colors.textMuted}` }} />
                <span
                  style={{
                    position: "absolute",
                    top: 2,
                    // Labels near the right edge sit left of their tick so they aren't clipped.
                    ...(x(l.t) > laneW - 36 ? { right: 3 } : { left: 3 }),
                    fontSize: fontSize["2xs"],
                    color: colors.textDim,
                    whiteSpace: "nowrap",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {l.text}
                </span>
              </div>
            ))}
          </div>

          {rows.map((row) => {
            const isSel = row.group.layerId === props.selectedLayerId;
            if (row.kind === "group") {
              return (
                <div
                  key={`g:${row.group.layerId}`}
                  style={{
                    position: "relative",
                    height: TRACK_HEIGHT,
                    boxSizing: "border-box",
                    borderBottom: `1px solid ${colors.border}`,
                    background: isSel ? colors.brandSubtle : colors.surface2,
                  }}
                >
                  {/* Collapsed: a read-only summary of every keyframe in the group. */}
                  {!row.open &&
                    row.group.tracks.flatMap(({ track }) =>
                      track.keyframes.map((kf, j) => (
                        <div
                          key={`${keyOf(track)}:${j}`}
                          style={{
                            ...diamondStyle(false),
                            position: "absolute",
                            left: x(kf.t) - DIAMOND / 2,
                            top: TRACK_HEIGHT / 2 - DIAMOND / 2,
                            opacity: 0.6,
                            pointerEvents: "none",
                          }}
                        />
                      )),
                    )}
                </div>
              );
            }
            const track = row.track;
            const trackKey = keyOf(track);
            const meta = TRACK_PROPERTY_LABELS[track.property];
            return (
              <div
                key={trackKey}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  addKeyframeAt(track, timeAtClientX(e.clientX));
                }}
                style={{
                  position: "relative",
                  height: TRACK_HEIGHT,
                  boxSizing: "border-box",
                  borderBottom: `1px solid ${row.last ? colors.border : colors.surface2}`,
                  background: isSel ? colors.brandSubtle : "transparent",
                  cursor: "crosshair",
                }}
              >
                {track.keyframes.map((kf, j) => {
                  const on = props.selectedKeyframe?.trackKey === trackKey && props.selectedKeyframe.index === j;
                  return (
                    // 14×24 hit area around the small visible diamond.
                    <div
                      key={j}
                      title={`${meta.label} ${String(kf.value)}${meta.unit} at ${kf.t.toFixed(2)}s: drag to move, double-click the track to add, Delete to remove`}
                      onPointerDown={(e) => startKfDrag(e, trackKey, j, kf.t)}
                      style={{
                        position: "absolute",
                        left: x(kf.t) - 7,
                        top: 0,
                        width: 14,
                        height: TRACK_HEIGHT,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        cursor: "grab",
                        zIndex: on ? 1 : 0,
                      }}
                    >
                      <div style={diamondStyle(on)} />
                    </div>
                  );
                })}
              </div>
            );
          })}

          {/* Playhead: visual only; the lane's pointerdown scrubs. */}
          <div
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: x(props.time),
              width: 0,
              borderLeft: `1px solid ${colors.text}`,
              pointerEvents: "none",
              zIndex: 3,
            }}
          >
            <div
              style={{
                position: "absolute",
                top: RULER_HEIGHT - 8,
                left: -5,
                width: 10,
                height: 8,
                background: colors.text,
                clipPath: "polygon(0 0, 100% 0, 50% 100%)",
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────

/**
 * The selected keyframe as one row: time, value (with unit), easing, then
 * "Edit curve" (bezier editor in a popover) and delete.
 */
function KeyframeRow(props: Props) {
  const active = props.active;
  const sel = props.selectedKeyframe;
  const track = sel ? trackByKey(props.template.timelines[active].tracks, sel.trackKey) : null;
  const kf = sel && track ? track.keyframes[sel.index] : undefined;
  // Fixed position (the timeline cell clips overflow); opens upward when there's no room below.
  const [curvePos, setCurvePos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const curveOpen = curvePos !== null;
  const setCurveOpen = (open: boolean) => {
    if (!open) return setCurvePos(null);
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - CURVE_POPOVER_W - 8));
    setCurvePos(
      window.innerHeight - r.bottom >= CURVE_POPOVER_H + 12
        ? { left, top: r.bottom + 6 }
        : { left, bottom: window.innerHeight - r.top + 6 },
    );
  };
  const popRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!curveOpen) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setCurveOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Close only the popover; the designer's own Escape (deselect) shouldn't also fire.
      e.stopPropagation();
      setCurveOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [curveOpen]);

  useEffect(() => {
    if (!kf) setCurveOpen(false);
  }, [kf]);

  if (!sel || !track || !kf) {
    return <span style={{ color: colors.textMuted }}>Select a keyframe, or double-click a track to add one</span>;
  }
  const meta = TRACK_PROPERTY_LABELS[track.property];

  // Writes only the given keys; the rest of the keyframe (and any unknown keys) stays as stored.
  function patch(p: Partial<Keyframe>) {
    props.onCommit((d) => {
      const k = trackByKey(d.timelines[active].tracks, sel!.trackKey)?.keyframes[sel!.index];
      if (k) Object.assign(k, p);
    });
  }
  function remove() {
    props.onCommit((d) => {
      trackByKey(d.timelines[active].tracks, sel!.trackKey)?.keyframes.splice(sel!.index, 1);
    });
    props.setSelectedKeyframe(null);
  }

  const easing = kf.easing as EasingSpec;
  const isCustom = Array.isArray(easing);
  const named = typeof easing === "string" ? easing : "";
  const known = (EASING_PRESETS as readonly string[]).includes(named);
  const valueStep = track.property === "rotation" || meta.unit === "px" ? 1 : 0.01;

  return (
    <>
      <span style={{ color: colors.text, fontWeight: 600, whiteSpace: "nowrap" }}>{meta.label} keyframe</span>
      <span style={{ width: 72 }}>
        <NumberInput
          size="sm"
          aria-label="Keyframe time"
          value={kf.t}
          step={0.01}
          precision={2}
          min={0}
          suffix="s"
          onCommit={(v) => patch({ t: v })}
        />
      </span>
      <span style={{ width: 84 }}>
        {typeof kf.value === "number" ? (
          <NumberInput
            size="sm"
            aria-label={`${meta.label} value`}
            value={kf.value}
            step={valueStep}
            suffix={meta.unit || undefined}
            onCommit={(v) => patch({ value: v })}
          />
        ) : (
          <Input
            aria-label={`${meta.label} value`}
            value={kf.value}
            onChange={(e) => {
              const num = parseFloat(e.target.value);
              patch({ value: Number.isFinite(num) ? num : e.target.value });
            }}
          />
        )}
      </span>
      <Select
        aria-label="Easing"
        value={isCustom ? "__custom" : named}
        onChange={(e) => {
          if (e.target.value !== "__custom") patch({ easing: e.target.value });
        }}
        style={{ width: 120 }}
      >
        {isCustom && <option value="__custom">Custom curve</option>}
        {!isCustom && !known && <option value={named}>{named}</option>}
        {EASING_PRESETS.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </Select>
      <span ref={btnRef} style={{ position: "relative", display: "inline-flex" }}>
        <IconButton
          aria-label="Edit curve"
          title="Edit curve"
          aria-expanded={curveOpen}
          onClick={() => setCurveOpen(!curveOpen)}
          style={curveOpen ? { border: `1px solid ${colors.accent}`, color: colors.brandText } : undefined}
        >
          <Spline size={14} />
        </IconButton>
        {curvePos && (
          <div
            ref={popRef}
            role="dialog"
            aria-label="Easing curve"
            style={{
              position: "fixed",
              ...curvePos,
              zIndex: 50,
              width: CURVE_POPOVER_W,
              boxSizing: "border-box",
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: radius.lg,
              boxShadow: shadow.modal,
              padding: 6,
            }}
          >
            <EasingPicker value={easing} onChange={(e) => patch({ easing: e })} />
          </div>
        )}
      </span>
      <IconButton
        tone="danger"
        aria-label={`Delete ${meta.label} keyframe at ${kf.t.toFixed(2)}s`}
        title="Delete keyframe (Delete)"
        onClick={remove}
      >
        <Trash2 size={14} />
      </IconButton>
    </>
  );
}

// ──────────────────────────────────────────────────────────────────────────

/**
 * Sensible starting keyframes for a newly-added track.
 *
 * Most properties default to a flat "current value at both ends" so the user
 * can shape the in/out from the layer's design pose. x/y tracks are offsets
 * from the design position (the engine applies them as a translate), so
 * their flat value is 0 — seeding the absolute position would double it.
 * Opacity and wipe are the common exceptions: 0 → 1 is what authors almost
 * always want for an `in` reveal, and 1 → 0 for an `out`. We can't tell
 * which timeline the user picked from here, so we default to 0 → 1 (matches
 * the previous behaviour for `in`, and the user can drag/edit values for
 * `out`).
 */
function initialKeyframesFor(
  property: TrackProperty,
  layer: Layer,
  duration: number,
): Keyframe[] {
  const t = layer.transform;
  const cur: Record<TrackProperty, number> = {
    x: 0,
    y: 0,
    rotation: t.rotation,
    scaleX: t.scaleX,
    scaleY: t.scaleY,
    opacity: t.opacity,
    w: t.w ?? 0,
    h: t.h ?? 0,
    wipe: 1,
  };

  if (property === "opacity" || property === "wipe") {
    return [
      { t: 0, value: 0, easing: "power2.out" },
      { t: duration, value: 1, easing: "power2.out" },
    ];
  }
  return [
    { t: 0, value: cur[property], easing: "power2.out" },
    { t: duration, value: cur[property], easing: "power2.out" },
  ];
}

function trackByKey(tracks: Track[] | Draft<Track>[], key: string): Draft<Track> | null {
  for (const t of tracks) {
    if (keyOf(t) === key) return t as Draft<Track>;
  }
  return null;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** "1s", "0.6s": no trailing zeros. */
function fmtSec(s: number): string {
  return `${Number(s.toFixed(2))}s`;
}

function rowBase(): React.CSSProperties {
  return {
    height: TRACK_HEIGHT,
    boxSizing: "border-box",
    padding: "0 4px 0 8px",
    fontSize: fontSize.sm,
    display: "flex",
    alignItems: "center",
    gap: 6,
    borderBottom: `1px solid ${colors.border}`,
    color: colors.text,
  };
}

const ellipsis: React.CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 };

function diamondStyle(on: boolean): React.CSSProperties {
  return {
    width: DIAMOND,
    height: DIAMOND,
    transform: "rotate(45deg)",
    borderRadius: 1,
    background: on ? colors.accent : colors.textDim,
    boxShadow: on ? `0 0 0 1px ${colors.text}` : "none",
  };
}
