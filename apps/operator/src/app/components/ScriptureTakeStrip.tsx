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
      translation: row.translation,
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
  const last = slide.verses[slide.verses.length - 1]!;
  const bookName = BOOKS.find((b) => b.id === first.book)?.name ?? first.book;
  if (first.chapter === last.chapter && first.verse === last.verse) {
    return `${bookName} ${first.chapter}:${first.verse}`;
  }
  if (first.chapter === last.chapter) {
    return `${bookName} ${first.chapter}:${first.verse}-${last.verse}`;
  }
  return `${bookName} ${first.chapter}:${first.verse}-${last.chapter}:${last.verse}`;
}
