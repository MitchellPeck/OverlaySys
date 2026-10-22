"use client";

import type { ScriptureRow } from "@overlaysys/core";
import { Button } from "@overlaysys/ui";
import { useWs } from "@/lib/useWs";
import { slideReference } from "@overlaysys/scripture";
import { reportScriptureUsage } from "@/lib/scriptureClient";

interface Props {
  row: ScriptureRow;
  channel: string;
}

export function ScriptureTakeStrip({ row, channel }: Props) {
  const { send } = useWs();

  function take(slideIdx: number) {
    const slide = row.slides[slideIdx]!;
    const data: Record<string, string> = {
      text: slide.verses.map((v) => v.text).join("\n"),
      reference: slideReference(row.slides, slideIdx),
      translation: row.translationAbbreviation ?? row.translation,
      attribution: row.attribution ?? "",
    };
    send({ type: "take", channel, templateId: row.templateId, data });
    if (row.source) reportScriptureUsage(row.source.usageTokens);
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
          onClick={() => take(i)}
          style={{ flex: "1 1 auto", minWidth: 120 }}
        >
          {i + 1}. {slideReference(row.slides, i)}
        </Button>
      ))}
    </div>
  );
}
