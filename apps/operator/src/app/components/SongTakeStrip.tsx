"use client";

import { useEffect, useMemo, useState } from "react";
import type { Show, SongRow, SongSessionSummary } from "@overlaysys/core";
import {
  resolveIntroTake,
  resolveOutroTake,
} from "@overlaysys/core";
import { colors, control, fontWeight, lineHeight, radius } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";

type Segment = "intro" | "lyrics" | "outro";

interface SongTakeStripProps {
  show: Show;
  row: SongRow;
  /**
   * The channel to fire on. Caller has resolved this via `resolveSongChannel`.
   * Falls back to `"program"` when nothing else applies.
   */
  channel: string;
  /**
   * The currently-live session for this channel (if any). Used to pick between
   * `song_take` (start) and `song_advance` (continue same song).
   */
  liveSession: SongSessionSummary | null | undefined;
}

/**
 * Three-segment take strip for a song row: Intro | Lyrics | Outro.
 *
 * Segment dispatch:
 *  - Intro / Outro fire a regular `take` against the resolved channel using
 *    {@link resolveIntroTake} / {@link resolveOutroTake} payloads.
 *  - Lyrics either starts a fresh `song_take` or `song_advance`s the existing
 *    session when the same `songId` is live on the channel. The server's
 *    session state survives Intro/Outro inserts (the renderer just replaces
 *    visible content), so re-clicking Lyrics mid-session brings the cursor
 *    back at the next slide.
 *
 * Intro / Outro segments are omitted entirely when their resolver returns
 * null (no template configured anywhere, the skip flag is set, or the
 * resolved template id is missing). Lyrics is always rendered.
 */
export function SongTakeStrip({
  show,
  row,
  channel,
  liveSession,
}: SongTakeStripProps) {
  const { send } = useWs();
  const songCache = useStore((s) => s.songCache);
  const templateCache = useStore((s) => s.templateCache);
  const conn = useStore((s) => s.conn);
  const song = songCache[row.songId];

  // Local-only progress hint. Reset whenever the selected row changes — the
  // store has no per-row "what did the operator just press" memory, and we
  // don't try to reconstruct it from the server's session state.
  const [lastFired, setLastFired] = useState<Segment | null>(null);
  useEffect(() => {
    setLastFired(null);
  }, [row.id]);

  // Pull the full song into the cache if we only have the meta. Same WS
  // pattern as elsewhere (e.g. SongModePanel) — fire once when missing.
  useEffect(() => {
    if (!song && conn === "open") {
      send({ type: "get_song", songId: row.songId });
    }
  }, [song, conn, row.songId, send]);

  // Identify every template id involved in the take strip (lyric + resolved
  // intro/outro template ids) and request any that aren't in the cache yet.
  // The resolvers need FULL Template payloads (with `fields`) to expand the
  // field map into a take's `data` record.
  const showSong = show.songs.find((s) => s.songId === row.songId);
  const introTemplateId =
    row.introTemplateId ?? showSong?.introTemplateId ?? song?.defaultIntroTemplateId;
  const outroTemplateId =
    row.outroTemplateId ?? showSong?.outroTemplateId ?? song?.defaultOutroTemplateId;

  useEffect(() => {
    if (conn !== "open") return;
    const ids = [row.lyricTemplateId, introTemplateId, outroTemplateId].filter(
      (id): id is string => typeof id === "string" && id.length > 0,
    );
    for (const id of ids) {
      if (!templateCache[id]) {
        send({ type: "get_template", templateId: id });
      }
    }
  }, [
    row.lyricTemplateId,
    introTemplateId,
    outroTemplateId,
    templateCache,
    conn,
    send,
  ]);

  // The resolver helpers ignore unknown template ids gracefully (return null),
  // so we can pass the cache contents straight through. The intro/outro shapes
  // light up the moment their template payload lands in the cache.
  const templatesArr = useMemo(
    () => Object.values(templateCache),
    [templateCache],
  );

  const intro = song ? resolveIntroTake(row, showSong, song, templatesArr) : null;
  const outro = song ? resolveOutroTake(row, showSong, song, templatesArr) : null;

  // Loading: still waiting for the song body. Render a placeholder rather
  // than the fully-laid-out strip so the operator can't fire half-resolved
  // segments. (Lyrics could technically fire without the song body since
  // song_take only needs showId+songRowId, but blocking the whole strip
  // keeps the UI behavior simple and consistent.)
  if (!song) {
    return (
      <div style={{ marginBottom: 12 }}>
        <div
          style={{
            padding: "8px 12px",
            background: colors.panel2,
            border: `1px solid ${colors.border}`,
            borderRadius: radius.md,
            fontSize: 12,
            color: colors.textDim,
          }}
        >
          Loading song…
        </div>
      </div>
    );
  }

  const segments: Segment[] = [];
  if (intro) segments.push("intro");
  segments.push("lyrics"); // always present — lyricTemplateId is required on the row.
  if (outro) segments.push("outro");

  function nextSegment(): Segment | null {
    // Highlight progression: intro → lyrics → outro → none.
    // Before any take: first segment (intro if present, else lyrics).
    // After firing X: the segment after X in the canonical order, if present.
    // Special case: when lyrics is the LAST present segment (no outro), the
    // highlight stays on lyrics after firing so each subsequent click reads
    // as "the obvious next action" rather than going un-highlighted.
    const order: Segment[] = ["intro", "lyrics", "outro"];
    if (lastFired === null) {
      return segments[0] ?? null;
    }
    const idx = order.indexOf(lastFired);
    for (let i = idx + 1; i < order.length; i++) {
      const seg = order[i]!;
      if (segments.includes(seg)) return seg;
    }
    if (lastFired === "lyrics" && segments[segments.length - 1] === "lyrics") {
      return "lyrics";
    }
    return null;
  }
  const highlight = nextSegment();

  function takeIntro() {
    if (!intro) return;
    send({
      type: "take",
      channel,
      templateId: intro.templateId,
      data: intro.fieldValues,
    });
    setLastFired("intro");
  }

  function takeOutro() {
    if (!outro) return;
    send({
      type: "take",
      channel,
      templateId: outro.templateId,
      data: outro.fieldValues,
    });
    setLastFired("outro");
  }

  function takeLyrics() {
    // Same-song session live → advance the cursor. Otherwise start a fresh
    // session (server's songSession.start ends any prior session on this
    // channel before opening the new one).
    if (liveSession && liveSession.songId === row.songId) {
      send({ type: "song_advance", channel, delta: 1 });
    } else {
      send({
        type: "song_take",
        channel,
        showId: show.id,
        songRowId: row.id,
      });
    }
    setLastFired("lyrics");
  }

  return (
    <div
      role="group"
      aria-label="Song take strip"
      style={{
        display: "flex",
        marginBottom: 12,
        // Make the strip read as a single connected button bar — each segment
        // overlaps the previous one's right border via a -1 marginLeft, and
        // corner radii apply only to the outermost edges.
      }}
    >
      {segments.map((seg, i) => {
        const isFirst = i === 0;
        const isLast = i === segments.length - 1;
        const isHighlight = seg === highlight;
        const onClick =
          seg === "intro" ? takeIntro
          : seg === "outro" ? takeOutro
          : takeLyrics;
        return (
          <SegmentButton
            key={seg}
            label={labelFor(seg)}
            isHighlight={isHighlight}
            isFirst={isFirst}
            isLast={isLast}
            onClick={onClick}
          />
        );
      })}
    </div>
  );
}

function labelFor(seg: Segment): string {
  switch (seg) {
    case "intro":
      return "Intro";
    case "lyrics":
      return "Lyrics";
    case "outro":
      return "Outro";
  }
}

function SegmentButton({
  label,
  isHighlight,
  isFirst,
  isLast,
  onClick,
}: {
  label: string;
  isHighlight: boolean;
  isFirst: boolean;
  isLast: boolean;
  onClick: () => void;
}) {
  const c = control.md;
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1,
        padding: `${c.padY}px ${c.padX}px`,
        fontSize: c.fontSize,
        fontWeight: fontWeight.semibold,
        lineHeight: lineHeight.tight,
        cursor: "pointer",
        // Flush adjacent borders: only the outermost edges get rounded.
        borderTopLeftRadius: isFirst ? c.radius : 0,
        borderBottomLeftRadius: isFirst ? c.radius : 0,
        borderTopRightRadius: isLast ? c.radius : 0,
        borderBottomRightRadius: isLast ? c.radius : 0,
        // Collapse the doubled border between adjacent segments.
        marginLeft: isFirst ? 0 : -1,
        border: `1px solid ${isHighlight ? colors.accent : colors.border}`,
        background: isHighlight ? colors.accent : colors.panel2,
        color: isHighlight ? "#fff" : colors.text,
        // The highlighted segment gets stacked on top so its accent border
        // doesn't get clipped by the neighbouring segment's grey border.
        position: "relative",
        zIndex: isHighlight ? 1 : 0,
      }}
    >
      {isHighlight && (
        <span aria-hidden style={{ marginRight: 6 }}>
          ▶
        </span>
      )}
      {label}
    </button>
  );
}
