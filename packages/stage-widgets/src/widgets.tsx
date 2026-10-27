import { useLayoutEffect, useMemo, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { SlideView, StageFeed, StageWidget } from "@overlaysys/core";
import type { ClientMessage } from "@overlaysys/ws-protocol";
import { parseNotesMarkdown, type Span } from "./notesMarkdown";
import { overflowDirection } from "./notesOverflow";
import { useFitText } from "./useFitText";
import { formatClockDisplay, formatRemaining, pickStageTimer, serviceProgressText, stageTimerView, videoRemainingSec } from "./stageTime";

const EMPTY = "—";

/** `label` is the caption shown above the body; it defaults to `style.label`. */
function Frame({ widget, label, children }: { widget: StageWidget; label?: string; children: ReactNode }) {
  const st = widget.style;
  const caption = st.label || label;
  const box: CSSProperties = {
    position: "absolute",
    left: widget.rect.x,
    top: widget.rect.y,
    width: widget.rect.w,
    height: widget.rect.h,
    boxSizing: "border-box",
    padding: st.padding,
    background: st.background,
    border: st.border ? `${st.border.width}px solid ${st.border.color}` : undefined,
    borderRadius: st.border?.radius,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  };
  return (
    <div style={box}>
      {caption && (
        <div style={{ fontFamily: st.fontFamily, fontSize: 20, fontWeight: 700, letterSpacing: 2, color: "#888", marginBottom: 6 }}>
          {caption}
        </div>
      )}
      {children}
    </div>
  );
}

function FitBody({ widget, text, dim }: { widget: StageWidget; text: string; dim?: number }) {
  const st = widget.style;
  const { ref, fontSize } = useFitText<HTMLDivElement>(st.fontSize, st.autoFit, text);
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
        lineHeight: 1.15,
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
        opacity: dim,
        overflow: "hidden",
      }}
    >
      {text || <span style={{ opacity: 0.3 }}>{EMPTY}</span>}
    </div>
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
        <Frame widget={widget}>
          {ref && <div style={{ fontSize: 24, color: "#888", fontFamily: widget.style.fontFamily }}>{ref}</div>}
          <FitBody widget={widget} text={slideText(feed.current)} />
        </Frame>
      );
    }
    case "nextSlide":
      return (
        <Frame widget={widget}>
          <FitBody widget={widget} text={slideText(feed.next, widget.props.maxLines)} dim={widget.props.dimOpacity} />
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
          <FitBody widget={widget} text={formatClockDisplay(nowMs, widget.props.format, widget.props.seconds)} />
        </Frame>
      );
    case "timer": {
      const { source, warnBelowSec, warnColor, overColor, showLabel } = widget.props;
      const t = pickStageTimer(feed.timers, source);
      const view = t ? stageTimerView(t, nowMs, warnBelowSec) : undefined;
      const color = view?.phase === "over" ? overColor : view?.phase === "warn" ? warnColor : widget.style.color;
      const shown: StageWidget = { ...widget, style: { ...widget.style, color } };
      return (
        // The timer's label goes through Frame's caption slot (style.label wins when both are set),
        // so FitBody's flex area — which autoFit measures — already excludes it.
        <Frame widget={shown} label={showLabel ? t?.label : undefined}>
          <FitBody widget={shown} text={view?.text ?? ""} />
        </Frame>
      );
    }
    case "videoRemaining": {
      const v = feed.video;
      const sec = v ? videoRemainingSec(v, nowMs) : 0;
      const warn = v && sec <= widget.props.warnBelowSec;
      const shown: StageWidget = { ...widget, style: { ...widget.style, color: warn ? "#ff5c5c" : widget.style.color } };
      return (
        <Frame widget={shown}>
          <FitBody widget={shown} text={v ? `-${formatRemaining(sec)}` : ""} />
        </Frame>
      );
    }
    case "sermonNotes":
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
      const dim = flashing && Math.floor((nowMs - msg.sentAt) / 500) % 2 === 1 ? 0.4 : 1;
      return (
        <Frame widget={widget}>
          <FitBody widget={widget} text={msg.text} dim={dim} />
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
