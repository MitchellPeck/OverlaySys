import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { SlideView, StageFeed, StageWidget } from "@overlaysys/core";
import type { ClientMessage } from "@overlaysys/ws-protocol";
import { parseNotesMarkdown, type Span } from "./notesMarkdown";
import { overflowDirection } from "./notesOverflow";
import { useFitText } from "./useFitText";
import { captionFontSize, defaultCaption, type CurrentKind } from "./captionStyle";
import { fitFontSize } from "./fitText";
import { overtimeView, pulseOn } from "./timerOvertime";
import { formatClockDisplay, formatRemaining, pickStageTimer, serviceProgressText, stageTimerView, videoRemainingSec } from "./stageTime";

const EMPTY = "—";

/** `label` is the caption shown above the body; it defaults to `style.label`. */
function Frame({
  widget,
  label,
  background,
  rect,
  children,
}: {
  widget: StageWidget;
  label?: string;
  /** Overrides style.background (overtime fill, message flash). */
  background?: string;
  /** Overrides the widget rect (message bar growing upward). */
  rect?: { x: number; y: number; w: number; h: number };
  children: ReactNode;
}) {
  const st = widget.style;
  const caption = st.label || label;
  const r = rect ?? widget.rect;
  const box: CSSProperties = {
    position: "absolute",
    left: r.x,
    top: r.y,
    width: r.w,
    height: r.h,
    boxSizing: "border-box",
    padding: st.padding,
    background: background ?? st.background,
    border: st.border ? `${st.border.width}px solid ${st.border.color}` : undefined,
    borderRadius: st.border?.radius,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  };
  return (
    <div style={box}>
      {caption && (
        <div
          style={{
            fontFamily: st.fontFamily,
            fontSize: captionFontSize(st.fontSize, st.captionSize),
            fontWeight: 700,
            letterSpacing: 2,
            lineHeight: 1.1,
            color: st.captionColor ?? "#aaaaaa",
            marginBottom: 6,
          }}
        >
          {caption}
        </div>
      )}
      {children}
    </div>
  );
}

function FitBody({
  widget,
  text,
  dim,
  minPx,
  tight,
  clamp,
}: {
  widget: StageWidget;
  text: string;
  dim?: number;
  minPx?: number;
  tight?: boolean;
  /** Ellipsize with as many lines as fit at the (floored) size instead of clipping mid-line. */
  clamp?: boolean;
}) {
  const st = widget.style;
  const { ref, fontSize } = useFitText<HTMLDivElement>(st.fontSize, st.autoFit || !!tight, text, minPx);
  const [lines, setLines] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    if (!clamp) return;
    const el = ref.current;
    if (el) setLines(Math.max(1, Math.floor((el.clientHeight + 1) / (fontSize * 1.15))));
  }, [clamp, fontSize, text, ref]);
  const justify = { top: "flex-start", middle: "center", bottom: "flex-end" }[st.vAlign];
  return (
    <div
      ref={ref}
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent: justify,
        fontFamily: st.fontFamily,
        fontSize,
        fontWeight: st.fontWeight,
        color: st.color,
        textAlign: st.align,
        lineHeight: tight ? 1 : 1.15,
        whiteSpace: tight ? "nowrap" : "pre-wrap",
        overflowWrap: "anywhere",
        opacity: dim,
        overflow: "hidden",
      }}
    >
      {!text ? (
        <span style={{ opacity: 0.3 }}>{EMPTY}</span>
      ) : clamp && lines ? (
        <div style={{ display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: lines, overflow: "hidden" }}>{text}</div>
      ) : (
        text
      )}
    </div>
  );
}

const CURRENT_KIND: Record<string, CurrentKind | undefined> = { lyric: "song", scripture: "scripture", graphic: "graphic" };
const KIND_NAMES = ["lyrics", "scripture", "graphic", "slides", "video"];

function currentKindOf(feed: StageFeed): CurrentKind | undefined {
  return CURRENT_KIND[feed.current.kind];
}

function currentCaption(widget: StageWidget, feed: StageFeed): string | undefined {
  return defaultCaption(widget.kind, currentKindOf(feed));
}

/**
 * style.label wins, except when it is itself a content-kind name that
 * contradicts what is live (the Scripture layout says "SCRIPTURE" while a lower third is up).
 */
function currentLabelOverride(widget: StageWidget, feed: StageFeed): { widget?: StageWidget } {
  const live = currentCaption(widget, feed);
  const lab = widget.style.label;
  if (live && lab && KIND_NAMES.includes(lab.toLowerCase()) && lab.toLowerCase() !== live.toLowerCase()) {
    return { widget: { ...widget, style: { ...widget.style, label: live } } as StageWidget };
  }
  return {};
}

/** lucide "pause" glyph, inlined so the package needs no icon dependency. */
function PauseGlyph({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-label="Paused" style={{ alignSelf: "center", flexShrink: 0 }}>
      <rect x="14" y="3" width="5" height="18" rx="1" />
      <rect x="5" y="3" width="5" height="18" rx="1" />
    </svg>
  );
}

function slideText(v: SlideView, maxLines?: number): string {
  const lines = maxLines ? v.lines.slice(0, maxLines) : v.lines;
  return lines.join("\n");
}

function Spans({ spans }: { spans: Span[] }) {
  return (
    <>
      {spans.map((sp, i) => {
        let node: ReactNode = sp.text;
        if (sp.italic) node = <em>{node}</em>;
        if (sp.bold) node = <strong>{node}</strong>;
        return <span key={i}>{node}</span>;
      })}
    </>
  );
}

const HEADING_SCALE = [1.25, 1.15, 1.05];

type NotesWidget = Extract<StageWidget, { kind: "sermonNotes" }>;

function NotesBody({
  widget,
  notes,
  send,
}: {
  widget: NotesWidget;
  notes: NonNullable<StageFeed["notes"]>;
  send?: (msg: ClientMessage) => void;
}) {
  const st = widget.style;
  const { highlightColor, dimPast, showCounter, anchor } = widget.props;
  const boxRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const pointRefs = useRef<(HTMLDivElement | null)[]>([]);
  const sentKey = useRef("");
  const { points, pointIdx, scrollOffset } = notes;
  const parsed = useMemo(() => points.map((pt) => parseNotesMarkdown(pt.markdown)), [points]);

  useLayoutEffect(() => {
    const box = boxRef.current;
    const scroller = scrollerRef.current;
    const active = pointRefs.current[pointIdx];
    if (!box || !scroller || !active) return;
    const boxH = box.clientHeight;
    scroller.style.transform = `translateY(${anchor * boxH - active.offsetTop - scrollOffset * boxH}px)`;
    const dir = overflowDirection({
      scrollOffset,
      boxHeight: boxH,
      anchor,
      pointTop: active.offsetTop,
      pointHeight: active.offsetHeight,
      isFirst: pointIdx === 0,
      isLast: pointIdx >= points.length - 1,
    });
    const key = `${pointIdx}:${scrollOffset}`;
    if (!dir) {
      sentKey.current = "";
    } else if (send && sentKey.current !== key) {
      sentKey.current = key;
      send({ type: "notes_overflow", direction: dir, atPoint: pointIdx });
    }
  }, [pointIdx, scrollOffset, points, anchor, send, st.fontSize]);

  return (
    <div
      ref={boxRef}
      style={{
        flex: 1,
        minHeight: 0,
        position: "relative",
        overflow: "hidden",
        fontFamily: st.fontFamily,
        fontSize: st.fontSize,
        fontWeight: st.fontWeight,
        color: st.color,
        textAlign: st.align,
        lineHeight: 1.25,
      }}
    >
      <div
        ref={scrollerRef}
        style={{ position: "absolute", left: 0, right: 0, top: 0, transition: "transform 300ms ease" }}
      >
        {points.map((_pt, i) => {
          const active = i === pointIdx;
          const blocks = parsed[i]!;
          return (
            <div
              key={i}
              ref={(el) => {
                pointRefs.current[i] = el;
              }}
              style={{
                marginBottom: st.fontSize * 0.8,
                opacity: dimPast && i < pointIdx ? 0.35 : 1,
                borderLeft: active ? `6px solid ${highlightColor}` : "6px solid transparent",
                paddingLeft: 18,
                overflowWrap: "anywhere",
              }}
            >
              {blocks.map((b, j) => {
                if (b.kind === "heading")
                  return (
                    <div key={j} style={{ fontWeight: 700, fontSize: st.fontSize * (HEADING_SCALE[b.level - 1] ?? 1), margin: "0 0 6px" }}>
                      <Spans spans={b.spans} />
                    </div>
                  );
                if (b.kind === "para")
                  return (
                    <p key={j} style={{ margin: "0 0 0.5em" }}>
                      <Spans spans={b.spans} />
                    </p>
                  );
                const Tag = b.ordered ? "ol" : "ul";
                return (
                  <Tag key={j} style={{ margin: "0 0 0.5em", paddingLeft: "1.2em", textAlign: "left" }}>
                    {b.items.map((it, k) => (
                      <li key={k}>
                        <Spans spans={it} />
                      </li>
                    ))}
                  </Tag>
                );
              })}
            </div>
          );
        })}
      </div>
      {showCounter && (
        <div style={{ position: "absolute", top: 0, right: 0, fontSize: 24, color: "#888", fontFamily: st.fontFamily }}>
          {pointIdx + 1} / {points.length}
        </div>
      )}
    </div>
  );
}

export function StageWidgetView({
  widget,
  feed,
  nowMs,
  send,
}: {
  widget: StageWidget;
  feed: StageFeed;
  nowMs: number;
  send?: (msg: ClientMessage) => void;
}) {
  if (widget.hidden) return null;
  switch (widget.kind) {
    case "currentSlide": {
      const ref = widget.props.showReference ? feed.current.reference : undefined;
      return (
        <Frame widget={widget} label={currentCaption(widget, feed)} {...currentLabelOverride(widget, feed)}>
          {ref && <div style={{ fontSize: 24, color: "#888", fontFamily: widget.style.fontFamily }}>{ref}</div>}
          <FitBody widget={widget} text={slideText(feed.current)} />
        </Frame>
      );
    }
    case "nextSlide":
      return (
        <Frame widget={widget}>
          <FitBody widget={widget} text={slideText(feed.next, widget.props.maxLines)} dim={widget.props.dimOpacity} minPx={30} clamp />
        </Frame>
      );
    case "rowTitle": {
      if (widget.props.prefer === "pco" && feed.service?.current) {
        const nextTitle = widget.props.showNext && feed.service.next ? `  →  ${feed.service.next.title}` : "";
        return (
          <Frame widget={widget}>
            <FitBody widget={widget} text={`${feed.service.current.title}${nextTitle}`} />
          </Frame>
        );
      }
      const next = widget.props.showNext && feed.nextRow ? `  →  ${feed.nextRow.title}` : "";
      return (
        <Frame widget={widget}>
          <FitBody widget={widget} text={feed.row ? `${feed.row.title}${next}` : ""} />
        </Frame>
      );
    }
    case "rowCue": {
      const parts = [feed.row?.cue ?? ""];
      if (widget.props.includeNextRow && feed.nextRow?.cue) parts.push(`Next: ${feed.nextRow.cue}`);
      return (
        <Frame widget={widget}>
          <FitBody widget={widget} text={parts.filter(Boolean).join("\n\n")} />
        </Frame>
      );
    }
    case "clock":
      return (
        <Frame widget={widget}>
          <FitBody widget={widget} text={formatClockDisplay(nowMs, widget.props.format, widget.props.seconds)} tight />
        </Frame>
      );
    case "timer": {
      const { source, warnBelowSec, warnColor, overColor, showLabel, overtimeStyle } = widget.props;
      const t = pickStageTimer(feed.timers, source);
      const view = t ? stageTimerView(t, nowMs, warnBelowSec) : undefined;
      const ot = overtimeView(overtimeStyle, view?.phase === "over", nowMs);
      const filled = ot.background !== undefined;
      const color = filled
        ? ot.color
        : view?.phase === "over"
          ? overColor
          : view?.phase === "warn"
            ? warnColor
            : widget.style.color;
      const shown: StageWidget = { ...widget, style: { ...widget.style, color: color ?? widget.style.color } };
      const bg = filled ? (ot.pulse && !pulseOn(nowMs) ? widget.style.background ?? "#000000" : overColor) : undefined;
      return (
        // The timer's label goes through Frame's caption slot (style.label wins when both are set),
        // so FitBody's flex area — which autoFit measures — already excludes it.
        <Frame widget={filled ? { ...shown, style: { ...shown.style, captionColor: shown.style.captionColor ?? "#ffffff" } } : shown} label={showLabel ? t?.label : undefined} background={bg}>
          <FitBody widget={shown} text={view?.text ?? ""} tight />
        </Frame>
      );
    }
    case "videoRemaining": {
      const v = feed.video;
      const sec = v ? videoRemainingSec(v, nowMs) : 0;
      const { warnBelowSec, warnColor, overColor } = widget.props;
      const done = !!v && sec <= 0;
      const warn = !!v && !done && sec <= warnBelowSec;
      const color = done ? (overColor ?? "#ef233c") : warn ? (warnColor ?? "#ff5c5c") : widget.style.color;
      const shown: StageWidget = { ...widget, style: { ...widget.style, color } };
      const paused = !!v && v.status === "paused";
      return (
        <Frame widget={shown}>
          <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "stretch", gap: 16, opacity: paused ? 0.5 : 1 }}>
            {paused && <PauseGlyph size={Math.round(widget.style.fontSize * 0.7)} color={color} />}
            <FitBody widget={shown} text={v ? `-${formatRemaining(sec)}` : ""} tight />
          </div>
        </Frame>
      );
    }
    case "sermonNotes":
      if (widget.props.collapseWhenEmpty && !(feed.notes && feed.notes.points.length > 0)) return null;
      return (
        <Frame widget={widget}>
          {feed.notes && feed.notes.points.length > 0 ? (
            <NotesBody widget={widget} notes={feed.notes} send={send} />
          ) : (
            <div style={{ color: "#888", fontFamily: widget.style.fontFamily, fontSize: widget.style.fontSize, opacity: 0.6 }}>No notes</div>
          )}
        </Frame>
      );
    case "message": {
      const msg = feed.message;
      if (!msg) return null;
      const flashing = widget.props.flash && nowMs - msg.sentAt < 6000;
      const off = flashing && Math.floor((nowMs - msg.sentAt) / 500) % 2 === 1;
      const st = widget.style;
      // The whole bar pulses: its background swaps to dark and the text to the bar colour.
      const shown: StageWidget = off ? { ...widget, style: { ...st, color: st.background ?? st.color } } : widget;
      const bg = off ? "#000000" : undefined;
      const inner = { w: widget.rect.w - 2 * st.padding, h: widget.rect.h - 2 * st.padding - (st.label ? captionFontSize(st.fontSize, st.captionSize) + 6 : 0) };
      const fit = st.autoFit ? fitFontSize(msg.text, inner, st.fontSize) : { px: st.fontSize, wrap: false, grow: 1 };
      const r = widget.rect;
      // grow is relative to the inner box; the padding/caption chrome stays fixed.
      const chrome = r.h - inner.h;
      const grownH = Math.min(r.h * 2, Math.round(inner.h * fit.grow + chrome));
      const rect = { ...r, y: r.y - (grownH - r.h), h: grownH };
      return (
        <Frame widget={shown} background={bg} rect={rect}>
          {/* at the 2x cap the text may still shrink below the floor rather than clip */}
          <FitBody widget={shown} text={msg.text} minPx={fit.grow >= 2 ? undefined : 48} />
        </Frame>
      );
    }
    case "serviceProgress":
      return (
        <Frame widget={widget}>
          <FitBody widget={widget} text={feed.service ? serviceProgressText(feed.service, nowMs, widget.props) : ""} />
        </Frame>
      );
    case "text":
      return (
        <Frame widget={widget}>
          <FitBody widget={widget} text={widget.props.text} />
        </Frame>
      );
  }
}
