"use client";

import { Fragment, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { breaksToSlides, slidesToBreaks, type ScriptureVerse, type SlideBudget } from "@overlaysys/scripture";
import { colors } from "@overlaysys/ui";
import {
  addBreak,
  isVerseBoundary,
  moveBreak,
  nudgeTarget,
  removeBreak,
  slideCharCounts,
  slideStarts,
  stableSlideIds,
} from "@/lib/slideBreaks";

export interface EditableSlide {
  id: string;
  verses: ScriptureVerse[];
}

interface Props {
  slides: EditableSlide[];
  onChange: (next: EditableSlide[]) => void;
  budget: SlideBudget;
}

/**
 * The passage as one continuous block of text. Slide breaks are markers:
 * click a gap between words to add one, ✕ to remove, drag (or ←/→, ⇧←/⇧→
 * when focused) to move.
 */
export function ScriptureSlideEditor({ slides, onChange, budget }: Props) {
  const { verses, words, breaks } = useMemo(() => slidesToBreaks(slides), [slides]);
  const counts = slideCharCounts(words, breaks);
  const starts = slideStarts(breaks);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const focusAfterChange = useRef<number | null>(null);

  function commit(next: Set<number>) {
    const regrouped = breaksToSlides(verses, words, next);
    const ids = stableSlideIds(slides.map((s) => s.id), starts, slideStarts(next));
    onChange(regrouped.map((s, i) => ({ id: ids[i]!, verses: s.verses })));
  }

  function onBreakKey(e: KeyboardEvent, at: number) {
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      commit(removeBreak(breaks, at));
      return;
    }
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const target = nudgeTarget(words, at, e.key === "ArrowLeft" ? -1 : 1, e.shiftKey ? "verse" : "word");
    if (target === null || breaks.has(target)) return;
    focusAfterChange.current = target;
    commit(moveBreak(breaks, at, target, words.length));
  }

  function endDrag() {
    setDragFrom(null);
    setDropAt(null);
  }

  const label = (slideIdx: number) => {
    const n = counts[slideIdx] ?? 0;
    const over = n > budget.maxChars;
    return (
      <span style={{ color: over ? colors.warn : colors.textDim }}>
        Slide {slideIdx + 1} · {n} chars{over ? ` (over ${budget.maxChars})` : ""}
      </span>
    );
  };

  return (
    <div
      data-testid="slide-editor"
      style={{
        border: `1px solid ${colors.border}`,
        borderRadius: 6,
        padding: 10,
        lineHeight: 1.9,
        maxHeight: 420,
        overflowY: "auto",
      }}
    >
      <div style={{ fontSize: 12 }}>{label(0)}</div>
      {words.map((w, i) => {
        const isBreak = i > 0 && breaks.has(i);
        const startsVerse = i === 0 || words[i - 1]!.verseIdx !== w.verseIdx;
        const slideIdx = starts.filter((s) => s <= i).length - 1;
        return (
          <Fragment key={i}>
            {isBreak ? (
              <div
                role="separator"
                tabIndex={0}
                draggable
                aria-label={`Break before slide ${slideIdx + 1}. Arrow keys move it, Shift moves by verse, Delete removes it.`}
                ref={(el) => {
                  if (el && focusAfterChange.current === i) {
                    focusAfterChange.current = null;
                    el.focus();
                  }
                }}
                onKeyDown={(e) => onBreakKey(e, i)}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = "move";
                  setDragFrom(i);
                }}
                onDragEnd={endDrag}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  margin: "6px 0",
                  padding: "0 6px",
                  fontSize: 12,
                  borderTop: `2px solid ${colors.brand}`,
                  cursor: "grab",
                  opacity: dragFrom === i ? 0.4 : 1,
                }}
              >
                {label(slideIdx)}
                <button
                  type="button"
                  aria-label={`Remove break before slide ${slideIdx + 1}`}
                  onClick={() => commit(removeBreak(breaks, i))}
                  style={{ marginLeft: "auto", background: "none", border: 0, color: colors.textDim, cursor: "pointer" }}
                >
                  <X size={14} aria-hidden style={{ verticalAlign: "-2px" }} />
                </button>
              </div>
            ) : (
              i > 0 && (
                <Gap
                  wide={isVerseBoundary(words, i)}
                  active={dropAt === i}
                  onClick={() => commit(addBreak(breaks, i, words.length))}
                  onDragOver={(e) => {
                    if (dragFrom === null) return;
                    e.preventDefault();
                    setDropAt(i);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragFrom !== null) commit(moveBreak(breaks, dragFrom, i, words.length));
                    endDrag();
                  }}
                />
              )
            )}
            {startsVerse && (
              <sup style={{ fontWeight: 700, color: colors.textDim, marginRight: 3 }}>
                {verses[w.verseIdx]!.verse}
              </sup>
            )}
            <span>{w.text}</span>
          </Fragment>
        );
      })}
    </div>
  );
}

function Gap({
  wide,
  active,
  onClick,
  onDragOver,
  onDrop,
}: {
  wide: boolean;
  active: boolean;
  onClick: () => void;
  onDragOver: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
}) {
  const [hover, setHover] = useState(false);
  const show = hover || active;
  return (
    <span
      role="button"
      aria-label="Insert slide break here"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onDragOver={onDragOver}
      onDrop={onDrop}
      style={{
        display: "inline-block",
        width: wide ? 12 : 6,
        height: "1.2em",
        verticalAlign: "middle",
        cursor: "pointer",
        borderLeft: show ? `2px solid ${colors.brand}` : "2px solid transparent",
        marginLeft: wide ? 2 : 0,
      }}
    />
  );
}
