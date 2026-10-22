import type { CSSProperties, ReactNode } from "react";
import type { SlideView, StageFeed, StageWidget } from "@overlaysys/core";
import { useFitText } from "./useFitText";
import { formatClockDisplay, formatRemaining, timerDisplay, videoRemainingSec } from "./stageTime";

const EMPTY = "—";

function Frame({ widget, children }: { widget: StageWidget; children: ReactNode }) {
  const st = widget.style;
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
      {st.label && (
        <div style={{ fontFamily: st.fontFamily, fontSize: 20, fontWeight: 700, letterSpacing: 2, color: "#888", marginBottom: 6 }}>
          {st.label}
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

export function StageWidgetView({ widget, feed, nowMs }: { widget: StageWidget; feed: StageFeed; nowMs: number }) {
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
      const src = widget.props.source;
      const t = src === "firstActive" ? feed.timers[0] : feed.timers.find((x) => x.channel === src.channel);
      return (
        <Frame widget={widget}>
          <FitBody widget={widget} text={t ? timerDisplay(t, nowMs) : ""} />
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
    case "text":
      return (
        <Frame widget={widget}>
          <FitBody widget={widget} text={widget.props.text} />
        </Frame>
      );
  }
}
