"use client";

import { useEffect, useRef, useState } from "react";
import { slideAirData } from "@overlaysys/core";
import { colors, radius, useToast } from "@overlaysys/ui";
import { useWs } from "@/lib/useWs";
import { useStore } from "@/lib/store";
import { thumbActivate, thumbsFor, type ThumbCtx, type ThumbSpec } from "@/lib/thumbClick";
import type { RowLike } from "@/lib/rowLike";
import { TemplateThumbnail } from "@/lib/thumbnails/TemplateThumbnail";
import { useTemplateBody } from "@/lib/thumbnails/useTemplateBody";
import { videoPosterUrl } from "@/lib/uploadAsset";
import { measureTextLayers, overflowSummary } from "@/lib/textOverflow";
import { sectionKindColor } from "@/app/songs/edit/slides/sectionColors";
import { useOverflowStore } from "./overflowStore";

const MIN_CARD = 180;
const GAP = 10;
const BORDER = 2;

/** Mouse clicks must not leave focus on a card: Space is the global advance key. */
const keepFocus = (e: React.MouseEvent) => e.preventDefault();

/** Card width for the grid's `repeat(auto-fill, minmax(180px, 1fr))` at this container width. */
function cardWidthFor(w: number): number {
  if (w <= 0) return MIN_CARD;
  const cols = Math.max(1, Math.floor((w + GAP) / (MIN_CARD + GAP)));
  return Math.floor((w - GAP * (cols - 1)) / cols);
}

const stateWord = (s: ThumbSpec["state"], blanked: boolean) =>
  s === "live" ? (blanked ? "on air, blanked" : "on air") : s === "cued" ? "cued" : "not on air";

/**
 * The selected row as slide thumbnails. A click follows `thumbActivate`: on a
 * live row it takes that slide to air on its own channel; otherwise it cues
 * to preview.
 */
export function ThumbStrip({ row, ctx }: { row: RowLike; ctx: ThumbCtx }) {
  const { send } = useWs();
  const toast = useToast();
  const disconnected = useStore((s) => s.conn) !== "open";
  const gridRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const specs = thumbsFor(row, ctx);
  const liveKey = specs.find((s) => s.state === "live")?.key ?? null;
  const cardRefs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const read = () => setWidth(el.clientWidth);
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (liveKey) cardRefs.current.get(liveKey)?.scrollIntoView({ block: "nearest" });
  }, [liveKey]);

  const activate = (index: number) => {
    const action = thumbActivate(row, index, ctx);
    for (const m of action.messages) send(m);
    if (action.toast) toast({ message: action.toast, tone: "info" });
  };

  const cardWidth = cardWidthFor(width);
  const inner = Math.max(1, cardWidth - BORDER * 2);

  return (
    <div
      ref={gridRef}
      role="list"
      aria-label="Slides"
      style={{ display: "grid", gridTemplateColumns: `repeat(auto-fill, minmax(${MIN_CARD}px, 1fr))`, gap: GAP }}
    >
      {specs.map((s, i) => (
        <div key={s.key} role="listitem" style={{ minWidth: 0 }}>
          <ThumbCard
            spec={s}
            row={row}
            width={inner}
            measure={row.kind === "graphic" && i === 0}
            disabled={disconnected}
            onActivate={() => activate(i)}
            refCb={(el) => {
              if (el) cardRefs.current.set(s.key, el);
              else cardRefs.current.delete(s.key);
            }}
          />
        </div>
      ))}
    </div>
  );
}

function ThumbCard({
  spec,
  row,
  width,
  measure,
  disabled,
  onActivate,
  refCb,
}: {
  spec: ThumbSpec;
  row: RowLike;
  width: number;
  measure: boolean;
  disabled: boolean;
  onActivate(): void;
  refCb(el: HTMLButtonElement | null): void;
}) {
  const [hover, setHover] = useState(false);
  const label = spec.label || "Slide";
  const border = spec.state === "live" ? colors.onair : spec.state === "cued" ? colors.ok : hover ? colors.borderStrong : "transparent";
  const captionColor = spec.group ? sectionKindColor[spec.group.sectionKind] : colors.textMuted;
  const height = Math.round((width * 9) / 16);
  return (
    <>
      <button
        ref={refCb}
        type="button"
        aria-label={`${label}, ${stateWord(spec.state, spec.blanked)}`}
        onMouseDown={keepFocus}
        onClick={onActivate}
        disabled={disabled}
        title={disabled ? "Reconnect to take" : undefined}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          display: "block",
          width: "100%",
          padding: 0,
          border: `${BORDER}px solid ${border}`,
          borderRadius: radius.md,
          background: colors.surface,
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.6 : undefined,
          position: "relative",
          overflow: "hidden",
        }}
      >
        <CardBody spec={spec} row={row} width={width} height={height} measure={measure} />
        {spec.state === "live" && spec.blanked && (
          <span
            aria-hidden
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "color-mix(in srgb, var(--bg) 70%, transparent)",
              color: colors.warn,
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 1,
            }}
          >
            BLANKED
          </span>
        )}
      </button>
      {spec.label && (
        <div
          style={{
            marginTop: 3,
            fontSize: 10,
            fontWeight: 700,
            color: captionColor,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {spec.label}
        </div>
      )}
    </>
  );
}

function CardBody({
  spec,
  row,
  width,
  height,
  measure,
}: {
  spec: ThumbSpec;
  row: RowLike;
  width: number;
  height: number;
  measure: boolean;
}) {
  const r = spec.render;
  if (r.kind === "template") {
    return (
      <TemplateCard
        rowId={row.id}
        templateId={r.templateId}
        data={r.data}
        airData={!!r.airData}
        width={width}
        height={height}
        measure={measure}
      />
    );
  }
  if (r.kind === "poster") {
    const asset = row.kind === "video" ? (row as { assetUrl?: string }).assetUrl : undefined;
    const src = asset ? videoPosterUrl(asset) : r.src;
    if (src) return <img src={src} alt="" loading="lazy" style={{ display: "block", width, height, objectFit: "cover", background: colors.bg }} />;
    return <Placeholder text="No poster" width={width} height={height} />;
  }
  return <Placeholder text={r.text} width={width} height={height} />;
}

function Placeholder({ text, width, height }: { text: string; width: number; height: number }) {
  return (
    <div
      style={{
        width,
        height,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 8,
        boxSizing: "border-box",
        textAlign: "center",
        fontSize: 12,
        color: colors.textMuted,
        background: colors.surface2,
      }}
    >
      {text}
    </div>
  );
}

/**
 * A template thumbnail, letterboxed into a 16:9 card. When `measure` is set
 * (the selected graphic), its text layers are measured after mount and each
 * edit, and fields that don't fit are reported to the overflow store.
 */
function TemplateCard({
  rowId,
  templateId,
  data: rawData,
  airData,
  width,
  height,
  measure,
}: {
  rowId: string;
  templateId: string;
  data: Record<string, string>;
  /** Slides: blank unsupplied text fields with the loaded design, as program does. */
  airData: boolean;
  width: number;
  height: number;
  measure: boolean;
}) {
  const { template } = useTemplateBody(templateId);
  const data = airData ? slideAirData(rawData, template) : rawData;
  const hostRef = useRef<HTMLDivElement>(null);
  const setRowWarnings = useOverflowStore((s) => s.setRowWarnings);
  const size = template?.size ?? { w: 16, h: 9 };
  const fit = Math.max(1, Math.floor(Math.min(width, (height * size.w) / size.h)));
  const dataKey = JSON.stringify(data);

  useEffect(() => {
    const host = hostRef.current;
    if (!measure || !host || !template) return;
    const data = JSON.parse(dataKey) as Record<string, string>;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      const m = measureTextLayers(template, data, (id) => {
        const box = host.querySelector<HTMLElement>(`[data-layer-id="${CSS.escape(id)}"]`);
        if (!box) return null;
        return { box, span: box.firstElementChild as HTMLElement | null };
      });
      // Nothing mounted yet: keep the last result rather than clearing it.
      if (m.length === 0 && !host.querySelector("[data-layer-id]")) return;
      setRowWarnings(rowId, overflowSummary(m));
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, 120);
    };
    schedule();
    const mo = new MutationObserver(schedule);
    mo.observe(host, { childList: true, subtree: true, characterData: true });
    void document.fonts?.ready.then(schedule);
    return () => {
      mo.disconnect();
      if (timer) clearTimeout(timer);
    };
    // `data` is rebuilt every render; its content (dataKey) is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measure, template, dataKey, rowId, setRowWarnings]);

  return (
    <div
      ref={hostRef}
      style={{ width, height, display: "flex", alignItems: "center", justifyContent: "center", background: colors.bg }}
    >
      {/* Slides wait for the design so the card never mounts its sample text. */}
      {airData && !template ? null : <TemplateThumbnail templateId={templateId} data={data} width={fit} />}
    </div>
  );
}
