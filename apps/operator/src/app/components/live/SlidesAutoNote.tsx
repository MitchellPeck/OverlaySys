"use client";

import { useEffect, useState } from "react";
import { colors } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import type { RowLike } from "@/lib/rowLike";
import { slidesAutoInfo, slidesCountdownSec, useDeckFor } from "@/lib/slidesRowView";

/**
 * "auto · loops · 5s" for a slides row whose deck is moving on by itself on
 * air. The countdown reads the server clock (local time + serverTimeOffsetMs).
 * Renders nothing for other rows, manual decks, or a row that isn't on air.
 */
export function SlidesAutoNote({ row }: { row: RowLike }) {
  const deck = useDeckFor(row);
  const channelStates = useStore((s) => s.channelStates);
  const offset = useStore((s) => s.serverTimeOffsetMs);
  const info = row.kind === "slides" ? slidesAutoInfo(row, channelStates, deck) : null;
  const at = info?.nextAdvanceAt;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (at === undefined) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [at]);
  if (!info) return null;
  const text = at === undefined ? info.text : `${info.text} · ${slidesCountdownSec(at, now, offset)}s`;
  return (
    <span
      title={at === undefined ? "Moves on by itself" : "Next slide in"}
      style={{ fontSize: 11, color: colors.textDim, whiteSpace: "nowrap", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}
    >
      {text}
    </span>
  );
}
