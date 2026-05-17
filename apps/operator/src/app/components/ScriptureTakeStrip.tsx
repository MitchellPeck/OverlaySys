"use client";

import type { ScriptureRow, ScriptureSlide } from "@overlaysys/core";
import { BOOKS } from "@overlaysys/scripture";
import { Button } from "@overlaysys/ui";
import { useWs } from "@/lib/useWs";

interface Props {
  row: ScriptureRow;
  channel: string;
}

export function ScriptureTakeStrip({ row, channel }: Props) {
  const { send } = useWs();

  function take(slide: ScriptureSlide) {
    const data: Record<string, string> = {
      text: slide.verses.map((v) => v.text).join("\n"),
      reference: prettyReferenceForSlide(slide),
      translation: row.translationAbbreviation ?? row.translation,
      attribution: row.attribution ?? "",
    };
    send({ type: "take", channel, templateId: row.templateId, data });
  }

  return (
    <div
      role="toolbar"
      aria-label="Scripture slides"
      style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}
    >
      {row.slides.map((slide, i) => (
        <Button
          key={slide.id}
          size="md"
          variant="primary"
          onClick={() => take(slide)}
          style={{ flex: "1 1 auto", minWidth: 120 }}
        >
          {i + 1}. {prettyReferenceForSlide(slide)}
        </Button>
      ))}
    </div>
  );
}

function prettyReferenceForSlide(slide: ScriptureSlide): string {
  if (slide.verses.length === 0) return "";
  const first = slide.verses[0]!;
  const bookName = BOOKS.find((b) => b.id === first.book)?.name ?? first.book;

  // Group verses into contiguous runs. A run breaks when the next verse is not
  // exactly prev.verse + 1 within the same chapter, or is in a different chapter
  // without being adjacent (different chapter but same sequence: e.g. 3:36 → 4:1
  // is contiguous only when it is the next verse in the canonical verse order,
  // which we approximate as "same chapter" or "verse == 1 of next chapter").
  type Run = { startChapter: number; startVerse: number; endChapter: number; endVerse: number };
  const runs: Run[] = [];

  for (const v of slide.verses) {
    const last = runs[runs.length - 1];
    const isContiguous =
      last &&
      (
        // Same chapter, consecutive verse
        (v.chapter === last.endChapter && v.verse === last.endVerse + 1) ||
        // Next chapter, first verse (cross-chapter run like 3:36 → 4:1)
        (v.chapter === last.endChapter + 1 && v.verse === 1)
      );
    if (isContiguous && last) {
      last.endChapter = v.chapter;
      last.endVerse = v.verse;
    } else {
      runs.push({ startChapter: v.chapter, startVerse: v.verse, endChapter: v.chapter, endVerse: v.verse });
    }
  }

  const runStrings = runs.map((r) => {
    if (r.startChapter === r.endChapter && r.startVerse === r.endVerse) {
      return `${r.startChapter}:${r.startVerse}`;
    }
    if (r.startChapter === r.endChapter) {
      return `${r.startChapter}:${r.startVerse}-${r.endVerse}`;
    }
    return `${r.startChapter}:${r.startVerse}-${r.endChapter}:${r.endVerse}`;
  });

  return `${bookName} ${runStrings.join(", ")}`;
}
