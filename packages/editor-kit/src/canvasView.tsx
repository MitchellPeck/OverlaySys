import { useEffect, useRef, useState } from "react";
import { Crosshair, Grid3x3, Minus, Plus, Scan } from "lucide-react";
import { isEditableTarget } from "./utils";

/** Zoom steps relative to fit-to-window (1 = fit). */
export const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8];
export const MIN_ZOOM = ZOOM_STEPS[0]!;
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1]!;

/** Next zoom step above (dir 1) or below (dir -1) `z`. */
export function stepZoom(z: number, dir: 1 | -1): number {
  if (dir > 0) return ZOOM_STEPS.find((s) => s > z + 1e-6) ?? MAX_ZOOM;
  return [...ZOOM_STEPS].reverse().find((s) => s < z - 1e-6) ?? MIN_ZOOM;
}

/** Continuous zoom from a wheel delta (trackpad pinch arrives as ctrl+wheel). */
export function wheelZoom(z: number, deltaY: number): number {
  const next = z * Math.exp(-deltaY * 0.01);
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next));
}

export type ZoomKey = "in" | "out" | "reset";

/** ⌘/Ctrl + = / − / 0 → zoom in / out / fit. */
export function zoomShortcut(e: { key: string; code: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean }): ZoomKey | null {
  if (!(e.metaKey || e.ctrlKey) || e.altKey) return null;
  if (e.key === "=" || e.key === "+" || e.code === "Equal" || e.code === "NumpadAdd") return "in";
  if (e.key === "-" || e.key === "_" || e.code === "Minus" || e.code === "NumpadSubtract") return "out";
  if (e.key === "0" || e.code === "Digit0" || e.code === "Numpad0") return "reset";
  return null;
}

/**
 * Zoom state for an editor canvas: ⌘+/−/0 on the window (outside text
 * inputs) and ⌘/Ctrl+wheel (or pinch) over `hostRef`. `onReset` also runs on
 * ⌘0 so the caller can re-centre.
 */
export function useCanvasZoom(hostRef: React.RefObject<HTMLElement | null>, onReset?: () => void) {
  const [zoom, setZoom] = useState(1);
  const resetRef = useRef(onReset);
  resetRef.current = onReset;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const k = zoomShortcut(e);
      if (!k || isEditableTarget(e.target)) return;
      e.preventDefault();
      if (k === "reset") {
        setZoom(1);
        resetRef.current?.();
      } else setZoom((z) => stepZoom(z, k === "in" ? 1 : -1));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    function onWheel(e: WheelEvent) {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      setZoom((z) => wheelZoom(z, e.deltaY));
    }
    // Non-passive so preventDefault stops the browser's own page zoom.
    host.addEventListener("wheel", onWheel, { passive: false });
    return () => host.removeEventListener("wheel", onWheel);
  }, [hostRef]);

  return { zoom, setZoom };
}

export type GuideToggles = { safe: boolean; center: boolean; thirds: boolean };

/** Title-safe and action-safe areas (SMPTE ST 2046-1: 90% / 93%). */
export const SAFE_AREAS = [
  { label: "title safe", inset: 0.05 },
  { label: "action safe", inset: 0.035 },
];

const GUIDE = "rgba(56, 189, 248, 0.7)";

/** Non-interactive guides drawn in canvas px over a w×h stage. */
export function GuideOverlays({ w, h, scale, show }: { w: number; h: number; scale: number; show: GuideToggles }) {
  const line = 1 / scale;
  const base: React.CSSProperties = { position: "absolute", pointerEvents: "none" };
  return (
    <>
      {show.safe &&
        SAFE_AREAS.map((a) => (
          <div
            key={a.label}
            title={a.label}
            style={{
              ...base,
              left: w * a.inset,
              top: h * a.inset,
              width: w * (1 - 2 * a.inset),
              height: h * (1 - 2 * a.inset),
              border: `${line}px dashed ${GUIDE}`,
              boxSizing: "border-box",
            }}
          />
        ))}
      {show.thirds &&
        [1, 2].map((i) => (
          <div key={`v${i}`} style={{ ...base, left: (w * i) / 3 - line / 2, top: 0, width: line, height: h, background: GUIDE }} />
        ))}
      {show.thirds &&
        [1, 2].map((i) => (
          <div key={`h${i}`} style={{ ...base, top: (h * i) / 3 - line / 2, left: 0, height: line, width: w, background: GUIDE }} />
        ))}
      {show.center && (
        <>
          <div style={{ ...base, left: w / 2 - line / 2, top: h / 2 - 40 * line, width: line, height: 80 * line, background: GUIDE }} />
          <div style={{ ...base, top: h / 2 - line / 2, left: w / 2 - 40 * line, height: line, width: 80 * line, background: GUIDE }} />
        </>
      )}
    </>
  );
}

const ICON = 14;

/** Bottom-right view controls: zoom −/%/+ (click % to fit) and guide toggles. */
export function ViewToolbar({
  zoom,
  scale,
  onZoom,
  guides,
  onGuides,
  extra,
}: {
  zoom: number;
  /** Effective canvas scale (fit × zoom), shown as a percentage. */
  scale: number;
  onZoom: (z: number | "fit") => void;
  guides: GuideToggles;
  onGuides: (g: GuideToggles) => void;
  extra?: React.ReactNode;
}) {
  const toggle = (k: keyof GuideToggles) => onGuides({ ...guides, [k]: !guides[k] });
  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        bottom: 8,
        right: 12,
        display: "flex",
        alignItems: "center",
        gap: 4,
        fontSize: 11,
        color: "var(--text-dim, #9099a8)",
      }}
    >
      {extra}
      <ViewBtn label="Zoom out (⌘−)" onClick={() => onZoom(stepZoom(zoom, -1))}>
        <Minus size={ICON} aria-hidden />
      </ViewBtn>
      <ViewBtn label="Fit to window (⌘0)" onClick={() => onZoom("fit")}>
        <span style={{ minWidth: 36, fontFamily: "ui-monospace, monospace" }}>{(scale * 100).toFixed(0)}%</span>
      </ViewBtn>
      <ViewBtn label="Zoom in (⌘+)" onClick={() => onZoom(stepZoom(zoom, 1))}>
        <Plus size={ICON} aria-hidden />
      </ViewBtn>
      <span style={{ width: 1, alignSelf: "stretch", background: "var(--border, #2a2e36)", margin: "0 2px" }} />
      <ViewBtn label="Safe areas" pressed={guides.safe} onClick={() => toggle("safe")}>
        <Scan size={ICON} aria-hidden />
      </ViewBtn>
      <ViewBtn label="Centre mark" pressed={guides.center} onClick={() => toggle("center")}>
        <Crosshair size={ICON} aria-hidden />
      </ViewBtn>
      <ViewBtn label="Rule of thirds" pressed={guides.thirds} onClick={() => toggle("thirds")}>
        <Grid3x3 size={ICON} aria-hidden />
      </ViewBtn>
    </div>
  );
}

function ViewBtn({
  label,
  pressed,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minWidth: 24,
        height: 22,
        padding: "0 4px",
        background: pressed ? "var(--brand-subtle)" : "var(--panel-2, #1c1f25)",
        color: pressed ? "var(--brand-text)" : "var(--text, #e9eaee)",
        border: "1px solid var(--border, #2a2e36)",
        borderRadius: 3,
        fontSize: 11,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}
