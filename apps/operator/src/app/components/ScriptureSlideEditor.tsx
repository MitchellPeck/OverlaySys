"use client";

import type { ScriptureVerse } from "@overlaysys/scripture";
import { Button, colors } from "@overlaysys/ui";

export interface EditableSlide {
  id: string;
  verses: ScriptureVerse[];
}

interface Props {
  slides: EditableSlide[];
  onChange: (next: EditableSlide[]) => void;
}

export function ScriptureSlideEditor({ slides, onChange }: Props) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {slides.map((slide, slideIdx) => (
        <div
          key={slide.id}
          data-testid="slide-card"
          style={{
            border: `1px solid ${colors.border}`,
            borderRadius: 6,
            padding: 8,
          }}
        >
          <header style={{ fontSize: 12, color: colors.textDim, marginBottom: 6 }}>
            Slide {slideIdx + 1}
          </header>
          {slide.verses.map((v, verseIdx) => {
            const isFirstVerseOfFirstSlide = slideIdx === 0 && verseIdx === 0;
            return (
              <div
                key={`${v.book}-${v.chapter}-${v.verse}`}
                data-testid="verse-row"
                style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 4 }}
              >
                <span style={{ flex: 1 }}>
                  <strong style={{ marginRight: 6 }}>{v.chapter}:{v.verse}</strong>
                  {v.text}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Move ${v.chapter}:${v.verse} to previous slide`}
                  disabled={isFirstVerseOfFirstSlide}
                  onClick={() => onChange(moveVerse(slides, slideIdx, verseIdx, -1))}
                >
                  ◀
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Move ${v.chapter}:${v.verse} to next slide`}
                  onClick={() => onChange(moveVerse(slides, slideIdx, verseIdx, +1))}
                >
                  ▶
                </Button>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function moveVerse(
  slides: EditableSlide[],
  slideIdx: number,
  verseIdx: number,
  direction: -1 | 1,
): EditableSlide[] {
  const next = slides.map((s) => ({ ...s, verses: s.verses.slice() }));
  const sourceSlide = next[slideIdx]!;
  const [verse] = sourceSlide.verses.splice(verseIdx, 1);

  const targetIdx = slideIdx + direction;
  if (targetIdx < 0) {
    // Defensive — UI disables ◀ on the very first verse.
    sourceSlide.verses.splice(verseIdx, 0, verse!);
    return next;
  }
  if (targetIdx >= next.length) {
    next.push({ id: nextSlideId(next), verses: [] });
  }
  const targetSlide = next[targetIdx]!;
  if (direction === -1) {
    targetSlide.verses.push(verse!);
  } else {
    targetSlide.verses.unshift(verse!);
  }
  return next.filter((s) => s.verses.length > 0);
}

function nextSlideId(slides: EditableSlide[]): string {
  const used = new Set(slides.map((s) => s.id));
  let i = slides.length;
  while (used.has(`slide-${i}`)) i++;
  return `slide-${i}`;
}
