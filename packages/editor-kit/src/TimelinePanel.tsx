import type { Draft } from "immer";
import { useRef, useState } from "react";
import type { Template, Track, Keyframe, EasingSpec, Layer } from "@overlaysys/core";
import { EasingPicker } from "./EasingPicker";
import { findLayer } from "./utils";

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
const HEADER_WIDTH = 240;
const STEP_SECONDS = 1 / 30; // single-frame step at ~30fps

const ALL_PROPERTIES = [
  "x",
  "y",
  "rotation",
  "scaleX",
  "scaleY",
  "opacity",
  "w",
  "h",
] as const;
type TrackProperty = (typeof ALL_PROPERTIES)[number];

export function TimelinePanel(props: Props) {
  const tl = props.template.timelines[props.active];

  return (
    <div
      style={{
        height: "100%",
        display: "grid",
        gridTemplateRows: "auto 1fr",
        background: "var(--panel, #14161a)",
        minHeight: 0,
      }}
    >
      <Toolbar {...props} />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `${HEADER_WIDTH}px minmax(0, 1fr) 220px`,
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        <TrackList
          tracks={tl.tracks}
          template={props.template}
          activeTimeline={props.active}
          selectedLayerId={props.selectedLayerId}
          onSelectLayer={(id) => {
            // Selecting a track header also focuses the layer in the inspector.
            // We funnel through the existing keyframe-selection clearing.
            props.setSelectedKeyframe(null);
            // Note: we don't have an onSelectLayer prop on TimelinePanel. The
            // Canvas/LayerTree own layer selection — keep this as a no-op for now.
            void id;
          }}
          onCommit={props.onCommit}
        />
        <TrackLanes
          tracks={tl.tracks}
          duration={tl.duration}
          selectedLayerId={props.selectedLayerId}
          time={props.time}
          setTime={props.setTime}
          playing={props.playing}
          onPause={props.onPause}
          selectedKeyframe={props.selectedKeyframe}
          onSelectKeyframe={props.setSelectedKeyframe}
          activeTimeline={props.active}
          onCommit={props.onCommit}
          onLive={props.onLive}
          onPushHistory={props.onPushHistory}
        />
        <KeyframeInspector
          template={props.template}
          activeTimeline={props.active}
          selected={props.selectedKeyframe}
          onCommit={props.onCommit}
          onDeleteSelected={() => {
            if (!props.selectedKeyframe) return;
            const sel = props.selectedKeyframe;
            props.onCommit((d) => {
              const t = trackByKey(d.timelines[props.active].tracks, sel.trackKey);
              if (t) t.keyframes.splice(sel.index, 1);
            });
            props.setSelectedKeyframe(null);
          }}
        />
      </div>
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

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 10px",
        borderBottom: "1px solid var(--border, #2a2e36)",
        background: "var(--panel-2, #1c1f25)",
      }}
    >
      <select
        value={props.active}
        onChange={(e) => props.setActive(e.target.value as "in" | "out")}
        style={selectStyle}
      >
        <option value="in">in ({props.template.timelines.in.duration}s)</option>
        <option value="out">out ({props.template.timelines.out.duration}s)</option>
      </select>
      <NumberSpinner
        label="dur"
        value={tl.duration}
        step={0.05}
        onChange={(v) =>
          props.onCommit((d) => {
            d.timelines[props.active].duration = Math.max(0.05, v);
          })
        }
      />

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

      <label
        style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--text-dim, #9099a8)" }}
      >
        <input type="checkbox" checked={props.loop} onChange={props.onLoopToggle} />
        loop
      </label>

      {/* Property picker: select-as-action. The select is reset to "" on each
          change so the user can add the same property after deleting it. */}
      <select
        value=""
        onChange={(e) => {
          const v = e.target.value as TrackProperty | "";
          if (!v) return;
          addTrack(v);
          e.currentTarget.value = "";
        }}
        disabled={!props.selectedLayerId}
        title={
          props.selectedLayerId
            ? `Add a track for ${layerName ?? props.selectedLayerId}`
            : "Select a layer first"
        }
        style={{
          ...selectStyle,
          opacity: props.selectedLayerId ? 1 : 0.5,
        }}
      >
        <option value="">
          {props.selectedLayerId ? `+ Track on ${layerName ?? "…"}` : "+ Track (select layer)"}
        </option>
        {ALL_PROPERTIES.map((p) => {
          const used = usedForLayer.has(p);
          return (
            <option key={p} value={p} disabled={used}>
              {p}
              {used ? " (added)" : ""}
            </option>
          );
        })}
      </select>

      <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-dim, #9099a8)" }}>
        t = {props.time.toFixed(2)}s · {tl.tracks.length} track(s)
      </span>
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
    <div style={{ display: "flex", gap: 2 }}>
      <TransportBtn title="Jump to start" onClick={() => onSeek(0)}>⏮</TransportBtn>
      <TransportBtn
        title="Step back (1/30s)"
        onClick={() => onSeek(Math.max(0, time - STEP_SECONDS))}
      >
        ◄
      </TransportBtn>
      <button onClick={playing ? onPause : onPlay} style={playBtn(playing)}>
        {playing ? "⏸" : "▶"}
      </button>
      <TransportBtn
        title="Step forward (1/30s)"
        onClick={() => onSeek(Math.min(duration, time + STEP_SECONDS))}
      >
        ►
      </TransportBtn>
      <TransportBtn title="Jump to end" onClick={() => onSeek(duration)}>⏭</TransportBtn>
    </div>
  );
}

function TransportBtn({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        width: 28,
        height: 24,
        background: "var(--panel, #14161a)",
        color: "var(--text, #e9eaee)",
        border: "1px solid var(--border, #2a2e36)",
        borderRadius: 3,
        fontSize: 12,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {children}
    </button>
  );
}

function NumberSpinner({
  label,
  value,
  step,
  onChange,
}: {
  label: string;
  value: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label
      style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--text-dim, #9099a8)" }}
    >
      {label}
      <input
        type="number"
        value={value}
        step={step}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
        style={{
          width: 60,
          padding: "2px 4px",
          background: "var(--panel, #14161a)",
          border: "1px solid var(--border, #2a2e36)",
          color: "var(--text, #e9eaee)",
          borderRadius: 3,
          fontSize: 11,
        }}
      />
    </label>
  );
}

// ──────────────────────────────────────────────────────────────────────────

/**
 * Track list (left rail). Iterates `tracks` in the same order TrackLanes does
 * so each row visually aligns with its lane. Each row shows the layer name +
 * property and has a ✕ delete button that removes the whole track.
 */
function TrackList({
  tracks,
  template,
  activeTimeline,
  selectedLayerId,
  onSelectLayer,
  onCommit,
}: {
  tracks: Track[];
  template: Template;
  activeTimeline: "in" | "out";
  selectedLayerId: string | null;
  onSelectLayer: (id: string | null) => void;
  onCommit: (recipe: (d: Draft<Template>) => void) => void;
}) {
  function deleteTrack(layerId: string, property: TrackProperty) {
    onCommit((d) => {
      const tl = d.timelines[activeTimeline];
      tl.tracks = tl.tracks.filter((t) => !(t.layerId === layerId && t.property === property));
    });
  }

  return (
    <div style={{ borderRight: "1px solid var(--border, #2a2e36)", overflow: "auto", paddingTop: 18 }}>
      {tracks.length === 0 && (
        <p
          style={{
            fontSize: 11,
            color: "var(--text-dim, #9099a8)",
            padding: 12,
            margin: 0,
            lineHeight: 1.5,
          }}
        >
          No tracks. Select a layer and use <strong>+ Track</strong> in the toolbar to add one.
        </p>
      )}
      {tracks.map((track) => {
        const layer = findLayer(template.layers, track.layerId);
        const layerName = layer?.name ?? track.layerId;
        const isSel = track.layerId === selectedLayerId;
        return (
          <div
            key={`${track.layerId}::${track.property}`}
            onClick={() => onSelectLayer(track.layerId)}
            style={{
              height: TRACK_HEIGHT,
              padding: "0 8px 0 10px",
              fontSize: 12,
              display: "flex",
              alignItems: "center",
              gap: 6,
              borderBottom: "1px solid #1a1c20",
              background: isSel ? "rgba(74,222,128,0.08)" : "transparent",
              borderLeft: isSel ? "2px solid #4ade80" : "2px solid transparent",
              cursor: "default",
            }}
          >
            <span
              style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}
              title={`${track.layerId} · ${track.property}`}
            >
              {layerName}
            </span>
            <span style={{ fontSize: 10, color: "var(--accent-2, #ffb13a)", fontFamily: "ui-monospace, monospace" }}>
              {track.property}
            </span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                deleteTrack(track.layerId, track.property as TrackProperty);
              }}
              title="Delete track"
              style={{
                width: 18,
                height: 18,
                background: "transparent",
                color: "var(--text-dim, #9099a8)",
                border: "1px solid var(--border, #2a2e36)",
                borderRadius: 3,
                cursor: "pointer",
                fontSize: 11,
                lineHeight: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────

type DragKf = { trackKey: string; index: number; startX: number; startT: number; pxPerSec: number };

function TrackLanes({
  tracks,
  duration,
  selectedLayerId,
  time,
  setTime,
  playing,
  onPause,
  selectedKeyframe,
  onSelectKeyframe,
  activeTimeline,
  onCommit,
  onLive,
  onPushHistory,
}: {
  tracks: Track[];
  duration: number;
  selectedLayerId: string | null;
  time: number;
  setTime: (t: number) => void;
  playing: boolean;
  onPause: () => void;
  selectedKeyframe: { trackKey: string; index: number } | null;
  onSelectKeyframe: (k: { trackKey: string; index: number } | null) => void;
  activeTimeline: "in" | "out";
  onCommit: (recipe: (d: Draft<Template>) => void) => void;
  onLive: (recipe: (d: Draft<Template>) => void) => void;
  onPushHistory: () => void;
}) {
  const laneRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragKf | null>(null);
  const scrubDragRef = useRef<boolean>(false);

  function setTimeFromClientX(clientX: number): void {
    const r = (laneRef.current as HTMLElement).getBoundingClientRect();
    const t = clamp(((clientX - r.left) / r.width) * duration, 0, duration);
    setTime(t);
  }

  function startScrubDrag(e: React.PointerEvent) {
    // Don't call setPointerCapture here — capturing the pointer on the
    // container redirects pointer events and disrupts the browser's normal
    // click / dblclick dispatch to the lane rows. We use document-level
    // pointer listeners instead so the drag continues even if the cursor
    // leaves the timeline area, without disturbing click/dblclick targeting.
    // We also avoid e.preventDefault() for the same reason; userSelect:none
    // already prevents text selection during drag.
    e.stopPropagation();
    if (playing) onPause();
    scrubDragRef.current = true;
    setTimeFromClientX(e.clientX);

    const move = (ev: PointerEvent) => {
      if (!scrubDragRef.current) return;
      setTimeFromClientX(ev.clientX);
    };
    const end = () => {
      scrubDragRef.current = false;
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
    e.stopPropagation(); // prevents the container scrub-drag from also starting
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    onSelectKeyframe({ trackKey, index });
    onPushHistory();
    const r = (laneRef.current as HTMLElement).getBoundingClientRect();
    dragRef.current = {
      trackKey,
      index,
      startX: e.clientX,
      startT,
      pxPerSec: r.width / duration,
    };
  }

  function onContainerPointerDown(e: React.PointerEvent) {
    // Keyframe diamonds stop propagation on their own pointerdown, so any
    // pointerdown reaching here is on the axis or empty lane area — treat
    // as scrub.
    startScrubDrag(e);
  }
  function onContainerPointerMove(e: React.PointerEvent) {
    // Only handles keyframe drag — scrub is handled by document listeners.
    if (!dragRef.current) return;
    const d = dragRef.current;
    const dx = e.clientX - d.startX;
    const newT = clamp(d.startT + dx / d.pxPerSec, 0, duration);
    onLive((draft) => {
      const t = trackByKey(draft.timelines[activeTimeline].tracks, d.trackKey);
      if (!t) return;
      const kf = t.keyframes[d.index];
      if (kf) kf.t = newT;
    });
  }
  function onContainerPointerUp(e: React.PointerEvent) {
    if (!dragRef.current) return;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    dragRef.current = null;
    // Don't sort — gsap-timeline.ts sorts internally and sorting here
    // would invalidate selectedKeyframe.index.
  }

  function addKeyframeAt(track: Track, t: number) {
    const trackKey = `${track.layerId}::${track.property}`;
    onCommit((draft) => {
      const found = trackByKey(draft.timelines[activeTimeline].tracks, trackKey);
      if (!found) return;
      const before = [...found.keyframes].reverse().find((k) => k.t < t);
      const fallback: Keyframe = { t, value: before?.value ?? 0, easing: "power2.out" };
      found.keyframes.push(fallback);
    });
  }

  return (
    <div
      ref={laneRef}
      style={{
        position: "relative",
        overflow: "auto",
        cursor: scrubDragRef.current ? "grabbing" : "default",
        userSelect: "none",
      }}
      onPointerDown={onContainerPointerDown}
      onPointerMove={onContainerPointerMove}
      onPointerUp={onContainerPointerUp}
      onPointerCancel={onContainerPointerUp}
    >
      {/* Time axis — clickable; container scrub-drag also handles it. */}
      <div
        style={{
          position: "sticky",
          top: 0,
          height: 18,
          background: "var(--panel-2, #1c1f25)",
          borderBottom: "1px solid var(--border, #2a2e36)",
          fontSize: 10,
          color: "var(--text-dim, #9099a8)",
          cursor: "ew-resize",
        }}
      >
        {Array.from({ length: Math.ceil(duration) + 1 }).map((_, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${(i / duration) * 100}%`,
              fontSize: 10,
              top: 4,
              transform: "translateX(2px)",
            }}
          >
            {i.toFixed(1)}s
          </div>
        ))}
      </div>

      {/* Lanes — same iteration order as TrackList so rows align. */}
      {tracks.map((track) => {
        const trackKey = `${track.layerId}::${track.property}`;
        const isSel = track.layerId === selectedLayerId;
        return (
          <div
            key={trackKey}
            onDoubleClick={(e) => {
              e.stopPropagation();
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              const t = ((e.clientX - r.left) / r.width) * duration;
              addKeyframeAt(track, clamp(t, 0, duration));
            }}
            style={{
              position: "relative",
              height: TRACK_HEIGHT,
              borderBottom: "1px solid #1a1c20",
              background: isSel ? "rgba(74,222,128,0.05)" : "transparent",
              cursor: "crosshair",
            }}
          >
            {track.keyframes.map((kf, j) => {
              const left = (kf.t / duration) * 100;
              const isThisSelected =
                selectedKeyframe?.trackKey === trackKey && selectedKeyframe.index === j;
              return (
                <div
                  key={j}
                  title={`${track.property}=${kf.value} @ ${kf.t.toFixed(2)}s — drag to move, dbl-click track to add, Del to remove`}
                  onPointerDown={(e) => startKfDrag(e, trackKey, j, kf.t)}
                  style={{
                    position: "absolute",
                    left: `${left}%`,
                    top: TRACK_HEIGHT / 2 - 6,
                    width: 12,
                    height: 12,
                    background: isThisSelected ? "#4ade80" : "#ffb13a",
                    transform: "rotate(45deg) translateX(-6px)",
                    borderRadius: 1,
                    cursor: "grab",
                    boxShadow: isThisSelected ? "0 0 0 1px #fff inset" : "none",
                  }}
                />
              );
            })}
          </div>
        );
      })}

      {/* Scrub head: visual indicator only — clicks are handled by the
          container's pointerdown so dragging anywhere on the timeline scrubs. */}
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: `${(time / duration) * 100}%`,
          width: 0,
          borderLeft: "1px solid #4ade80",
          pointerEvents: "none",
          boxShadow: "0 0 6px rgba(74,222,128,0.6)",
        }}
      >
        {/* Triangular head + grab affordance at the top of the axis. */}
        <div
          style={{
            position: "absolute",
            top: 2,
            left: -6,
            width: 12,
            height: 12,
            background: "#4ade80",
            clipPath: "polygon(0 0, 100% 0, 50% 100%)",
          }}
        />
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────

function KeyframeInspector({
  template,
  activeTimeline,
  selected,
  onCommit,
  onDeleteSelected,
}: {
  template: Template;
  activeTimeline: "in" | "out";
  selected: { trackKey: string; index: number } | null;
  onCommit: (recipe: (d: Draft<Template>) => void) => void;
  onDeleteSelected: () => void;
}) {
  const [showEasing, setShowEasing] = useState(true);
  if (!selected) {
    return (
      <div
        style={{
          padding: 12,
          fontSize: 11,
          color: "var(--text-dim, #9099a8)",
          borderLeft: "1px solid var(--border, #2a2e36)",
          overflow: "auto",
        }}
      >
        Select a keyframe (or double-click a track to add).
      </div>
    );
  }
  const track = trackByKey(template.timelines[activeTimeline].tracks, selected.trackKey);
  const kf = track?.keyframes[selected.index];
  if (!track || !kf) return null;

  function patch(p: Partial<Keyframe>) {
    onCommit((d) => {
      const t = trackByKey(d.timelines[activeTimeline].tracks, selected!.trackKey);
      if (!t) return;
      const k = t.keyframes[selected!.index];
      if (!k) return;
      Object.assign(k, p);
    });
  }

  return (
    <div
      style={{
        padding: 10,
        borderLeft: "1px solid var(--border, #2a2e36)",
        overflow: "auto",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
        <strong style={{ fontSize: 12 }}>Keyframe</strong>
        <span style={{ marginLeft: 8, color: "var(--text-dim, #9099a8)", fontSize: 10 }}>
          {track.property}
        </span>
        <button onClick={onDeleteSelected} style={{ marginLeft: "auto", ...delBtn }}>
          Delete
        </button>
      </div>
      <Row label="t (s)">
        <input
          type="number"
          step={0.01}
          value={kf.t}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            if (Number.isFinite(v)) patch({ t: v });
          }}
          style={inputStyle}
        />
      </Row>
      <Row label="value">
        <input
          value={String(kf.value)}
          onChange={(e) => {
            const num = parseFloat(e.target.value);
            patch({ value: Number.isFinite(num) ? num : e.target.value });
          }}
          style={inputStyle}
        />
      </Row>
      <button
        onClick={() => setShowEasing((s) => !s)}
        style={{
          ...miniBtn,
          width: "100%",
          marginTop: 8,
          marginBottom: 6,
        }}
      >
        {showEasing ? "Hide" : "Show"} easing
      </button>
      {showEasing && (
        <EasingPicker value={kf.easing as EasingSpec} onChange={(e) => patch({ easing: e })} />
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      style={{ display: "grid", gridTemplateColumns: "60px 1fr", gap: 6, alignItems: "center", marginBottom: 6 }}
    >
      <label style={{ fontSize: 11, color: "var(--text-dim, #9099a8)" }}>{label}</label>
      {children}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────

/**
 * Sensible starting keyframes for a newly-added track.
 *
 * Most properties default to a flat "current value at both ends" so the user
 * can shape the in/out from the layer's design pose. Opacity is the common
 * exception: 0 → 1 is what authors almost always want for an `in` reveal,
 * and 1 → 0 for an `out`. We can't tell which timeline the user picked from
 * here, so we default to 0 → 1 (matches the previous behaviour for `in`,
 * and the user can drag/edit values for `out`).
 */
function initialKeyframesFor(
  property: TrackProperty,
  layer: Layer,
  duration: number,
): Keyframe[] {
  const t = layer.transform;
  const cur: Record<TrackProperty, number> = {
    x: t.x,
    y: t.y,
    rotation: t.rotation,
    scaleX: t.scaleX,
    scaleY: t.scaleY,
    opacity: t.opacity,
    w: t.w ?? 0,
    h: t.h ?? 0,
  };

  if (property === "opacity") {
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
    if (`${t.layerId}::${t.property}` === key) return t as Draft<Track>;
  }
  return null;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "4px 6px",
  background: "var(--panel-2, #1c1f25)",
  border: "1px solid var(--border, #2a2e36)",
  color: "var(--text, #e9eaee)",
  borderRadius: 3,
  fontSize: 12,
  outline: "none",
};
const selectStyle: React.CSSProperties = {
  padding: "4px 8px",
  background: "var(--panel, #14161a)",
  border: "1px solid var(--border, #2a2e36)",
  color: "var(--text, #e9eaee)",
  borderRadius: 3,
  fontSize: 12,
};
const miniBtn: React.CSSProperties = {
  padding: "4px 8px",
  background: "var(--panel, #14161a)",
  color: "var(--text, #e9eaee)",
  border: "1px solid var(--border, #2a2e36)",
  borderRadius: 3,
  fontSize: 11,
  cursor: "pointer",
};
const delBtn: React.CSSProperties = {
  padding: "2px 6px",
  background: "transparent",
  color: "var(--red, #f87171)",
  border: "1px solid var(--red, #f87171)",
  borderRadius: 3,
  fontSize: 11,
  cursor: "pointer",
};
function playBtn(playing: boolean): React.CSSProperties {
  return {
    padding: "4px 12px",
    background: playing ? "var(--panel-2, #1c1f25)" : "var(--accent, #ff3a3a)",
    color: "#fff",
    border: "1px solid var(--border, #2a2e36)",
    borderRadius: 3,
    fontSize: 12,
    cursor: "pointer",
  };
}
