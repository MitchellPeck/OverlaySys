import type { ChannelState, SectionKind, Song, SongRow, SongSessionSummary } from "@overlaysys/core";
import { resolveArrangement, slideAirData } from "@overlaysys/core";
import { scriptureSlideData } from "@overlaysys/scripture";
import type { ClientMessage } from "@overlaysys/ws-protocol";
import { mediaRowTakeMessage, posterPathFor } from "./mediaTake";
import { effectiveRowData, graphicRowMessage } from "./rowData";
import { rowAirState, sessionPlaysRow, songRowIsUnique, type AirContext } from "./rowAirState";
import type { RowLike } from "./rowLike";
import { sectionShortLabel, type RowViewCtx } from "./rowView";
import { slideDeltaTo } from "./songNav";
import { songCueChannel, songRowChannel } from "./songChannel";
import { slidesLiveChannel, slidesRowViewFor, slidesThumbMessages, slidesThumbState } from "./slidesRowView";

export type ThumbCtx = RowViewCtx & {
  channelStates: Record<string, ChannelState>;
  songSessions: Record<string, SongSessionSummary | null>;
};

export type ThumbRender =
  | {
      kind: "template";
      templateId: string;
      data: Record<string, string>;
      /**
       * Slides: the card applies slideAirData with the design it loads, so a
       * thumbnail never shows the design's sample text, even before the
       * design reaches the store's template cache (final-review M6).
       */
      airData?: true;
    }
  | { kind: "poster"; src: string | null }
  /** A photo row: the card shows the stored image itself. */
  | { kind: "image"; src: string }
  | { kind: "placeholder"; text: string };

export type ThumbSpec = {
  key: string;
  label: string;
  group: { label: string; sectionKind: SectionKind } | null;
  render: ThumbRender;
  state: "live" | "cued" | null;
  blanked: boolean;
};

export type ThumbAction = { messages: ClientMessage[]; toast?: string };

const STALE_SECTION = "That section is no longer in this song";

type SongEntry = {
  arrIdx: number;
  slideIdx: number;
  sectionId: string;
  /** False when the arrangement names a section the song no longer has. */
  present: boolean;
  spec: ThumbSpec;
};

type SongModel = {
  song: Song;
  arrangement: string[];
  /** The session these thumbs reflect, with the channel it runs on; null when none. */
  session: { channel: string; summary: SongSessionSummary } | null;
  live: boolean;
  entries: SongEntry[];
};

function airCtx(row: SongRow, ctx: ThumbCtx): AirContext {
  return { showId: ctx.show.id, rows: ctx.show.rows, songChannel: songRowChannel(row, ctx.show, ctx) };
}

function placeholder(key: string, text: string): ThumbSpec {
  return { key, label: "", group: null, render: { kind: "placeholder", text }, state: null, blanked: false };
}

/**
 * Whether the channel's session is this row's. The session itself already
 * matches by song / row id; this rules out a session taken from another show
 * or from another row of the same song. An absent liveRow, or one pointing at
 * a different kind of row (a video over lyrics), still counts as this row,
 * except for a song that appears in more than one row of the show.
 */
function exactRowOn(ch: string | undefined, row: { id: string; kind: string; songId?: string }, ctx: ThumbCtx): boolean {
  const lr = ch ? ctx.channelStates[ch]?.liveRow : undefined;
  // A song row with no exact liveRow counts only when it is the song's only
  // row in the show: with a reprise we can't tell which one was taken.
  const unique = () => row.kind !== "song" || songRowIsUnique(ctx.show.rows, row.songId ?? "");
  if (!lr) return unique();
  if (lr.showId !== ctx.show.id) return false;
  if (lr.rowId === row.id) return true;
  const taken = ctx.show.rows.find((r) => r.id === lr.rowId) as { kind?: string; songId?: string } | undefined;
  if (row.kind === "song") {
    if (taken?.kind === "song" && taken.songId === row.songId) return false;
    return unique();
  }
  return !taken || taken.kind !== row.kind;
}

/** A song session on `ch` is this row's: the session's own row when it names one, else exactRowOn. */
function songSessionIsRow(ch: string, s: SongSessionSummary, row: SongRow, ctx: ThumbCtx): boolean {
  if (s.songId !== row.songId) return false;
  return sessionPlaysRow(s, row.id, ctx.show.id) ?? exactRowOn(ch, row, ctx);
}

function songModel(row: SongRow, ctx: ThumbCtx): SongModel | null {
  const song = ctx.songCache[row.songId];
  if (!song) return null;
  const air = rowAirState(row, ctx.channelStates, ctx.songSessions, airCtx(row, ctx));
  const routed = songRowChannel(row, ctx.show, ctx);
  let session: SongModel["session"] = null;
  let live = false;
  if (air === "program") {
    for (const ch of ["program", routed]) {
      const s = ch ? ctx.songSessions[ch] : null;
      if (ch && s && songSessionIsRow(ch, s, row, ctx)) {
        session = { channel: ch, summary: s };
        live = true;
        break;
      }
    }
  } else if (air === "preview") {
    const s = ctx.songSessions.preview;
    if (s && songSessionIsRow("preview", s, row, ctx)) session = { channel: "preview", summary: s };
  }
  const showSong = ctx.show.songs.find((s) => s.songId === row.songId);
  const arrangement = session ? session.summary.arrangement : resolveArrangement(row, showSong, song);
  const lyricTemplateId = live && session ? session.summary.lyricTemplateId : row.lyricTemplateId;
  const entries: SongEntry[] = [];
  arrangement.forEach((sectionId, arrIdx) => {
    const section = song.sections.find((s) => s.id === sectionId);
    if (!section) {
      entries.push({
        arrIdx,
        slideIdx: 0,
        sectionId,
        present: false,
        spec: {
          key: `${row.id}:${arrIdx}:missing`,
          label: "Removed",
          group: null,
          render: { kind: "placeholder", text: "Section removed" },
          state: null,
          blanked: false,
        },
      });
      return;
    }
    const short = sectionShortLabel(section, song.sections);
    section.slides.forEach((slide, slideIdx) => {
      const cur = session?.summary.cursor;
      const here = !!cur && cur.sectionIdx === arrIdx && cur.slideIdx === slideIdx;
      entries.push({
        arrIdx,
        slideIdx,
        sectionId,
        present: true,
        spec: {
          key: `${row.id}:${arrIdx}:${slideIdx}`,
          label: `${short} · ${slideIdx + 1}`,
          group: { label: short, sectionKind: section.kind },
          render: { kind: "template", templateId: lyricTemplateId, data: { text: slide.lines.join("\n") } },
          state: here ? (live ? "live" : "cued") : null,
          blanked: here && live && !!session?.summary.blanked,
        },
      });
    });
  });
  return { song, arrangement, session, live, entries };
}

function songThumbs(row: SongRow, ctx: ThumbCtx): ThumbSpec[] {
  const m = songModel(row, ctx);
  if (!m) return [placeholder(row.id, "Loading song")];
  return m.entries.map((e) => e.spec);
}

function scriptureThumbs(row: Extract<RowLike, { kind: "scripture" }>, ctx: ThumbCtx): ThumbSpec[] {
  const prog = exactRowOn("program", row, ctx) ? ctx.channelStates.program?.scriptureSession : undefined;
  const prev = exactRowOn("preview", row, ctx) ? ctx.channelStates.preview?.scriptureSession : undefined;
  return row.slides.map((_, i) => ({
    key: `${row.id}:${i}`,
    label: `${i + 1}`,
    group: null,
    render: {
      kind: "template" as const,
      templateId: row.templateId,
      data: scriptureSlideData(row, i) as unknown as Record<string, string>,
    },
    state:
      prog?.rowId === row.id && prog.slideIdx === i
        ? ("live" as const)
        : prev?.rowId === row.id && prev.slideIdx === i
          ? ("cued" as const)
          : null,
    blanked: false,
  }));
}

/** One thumbnail per slide of a rundown row. Never throws. */
export function thumbsFor(row: RowLike, ctx: ThumbCtx): ThumbSpec[] {
  try {
    switch (row.kind) {
      case "song":
        return songThumbs(row as SongRow, ctx);
      case "scripture":
        return scriptureThumbs(row as Extract<RowLike, { kind: "scripture" }>, ctx);
      case "graphic": {
        const g = row as Extract<RowLike, { kind: "graphic" }>;
        const air = rowAirState(g, ctx.channelStates, ctx.songSessions, { showId: ctx.show.id, rows: ctx.show.rows });
        return [
          {
            key: g.id,
            label: "",
            group: null,
            render: { kind: "template", templateId: g.templateId, data: effectiveRowData(g, ctx.overrides) },
            state: air === "program" ? "live" : air === "preview" ? "cued" : null,
            blanked: false,
          },
        ];
      }
      case "video": {
        const v = row as Extract<RowLike, { kind: "video" }>;
        const air = rowAirState(v, ctx.channelStates, ctx.songSessions);
        return [
          {
            key: v.id,
            label: "",
            group: null,
            render: { kind: "poster", src: posterPathFor(v.assetUrl) },
            state: air === "program" ? "live" : null,
            blanked: false,
          },
        ];
      }
      case "media": {
        const p = row as Extract<RowLike, { kind: "media" }>;
        const air = rowAirState(p, ctx.channelStates, ctx.songSessions);
        return [
          {
            key: p.id,
            label: "",
            group: null,
            render: { kind: "image", src: p.assetUrl },
            state: air === "program" ? "live" : null,
            blanked: false,
          },
        ];
      }
      case "slides": {
        const deckId = (row as { deckId?: string }).deckId;
        const view = slidesRowViewFor(row, deckId ? (ctx.deckNotFound?.[deckId] ? null : ctx.deckCache[deckId]) : null);
        if (!view) return [placeholder(row.id, "Slides decks aren't available yet")];
        return view.slides.map((s, i) => ({
          key: s.key,
          label: s.label ?? `Slide ${i + 1}`,
          group: null,
          render: {
            kind: "template" as const,
            templateId: s.templateId,
            data: slideAirData(s.data, ctx.templateCache[s.templateId]),
            airData: true as const,
          },
          state: slidesThumbState(row, i, ctx.channelStates),
          blanked: false,
        }));
      }
      default:
        return [placeholder(row.id, "Unsupported item")];
    }
  } catch {
    return [placeholder(row.id, "Unsupported item")];
  }
}

function songActivate(row: SongRow, index: number, ctx: ThumbCtx): ThumbAction {
  const m = songModel(row, ctx);
  const entry = m?.entries[index];
  if (!m || !entry) return { messages: [] };
  if (!entry.present || !m.song.sections.some((s) => s.id === entry.sectionId)) {
    return { messages: [], toast: STALE_SECTION };
  }

  const deltaFrom = (cursor: SongSessionSummary["cursor"]): number | null => {
    const d = slideDeltaTo(m.arrangement, m.song.sections, cursor, entry.arrIdx);
    return d == null ? null : d + entry.slideIdx;
  };
  const move = (channel: string, cursor: SongSessionSummary["cursor"]): ClientMessage[] => {
    const d = deltaFrom(cursor);
    if (d == null) return [{ type: "song_jump", channel, sectionId: entry.sectionId, slideIdx: entry.slideIdx }];
    return d === 0 ? [] : [{ type: "song_advance", channel, delta: d }];
  };

  if (m.live && m.session) return { messages: move(m.session.channel, m.session.summary.cursor) };
  if (m.session) return { messages: move("preview", m.session.summary.cursor) };
  const channel = songCueChannel(row, ctx.show, ctx);
  const take: ClientMessage = { type: "song_take", channel, showId: ctx.show.id, songRowId: row.id };
  const d = deltaFrom({ sectionIdx: 0, slideIdx: 0 });
  if (d == null) {
    return { messages: [take, { type: "song_jump", channel, sectionId: entry.sectionId, slideIdx: entry.slideIdx }] };
  }
  return { messages: d > 0 ? [take, { type: "song_advance", channel, delta: d }] : [take] };
}

/**
 * What a thumbnail click sends. A live row takes that slide to air on its own
 * channel; anything else cues to preview. Never goes straight to program.
 */
export function thumbActivate(row: RowLike, index: number, ctx: ThumbCtx): ThumbAction {
  try {
    switch (row.kind) {
      case "song":
        return songActivate(row as SongRow, index, ctx);
      case "scripture": {
        const r = row as Extract<RowLike, { kind: "scripture" }>;
        if (index < 0 || index >= r.slides.length) return { messages: [] };
        if (ctx.channelStates.program?.scriptureSession?.rowId === r.id && exactRowOn("program", r, ctx)) {
          return { messages: [{ type: "scripture_goto", channel: "program", slideIdx: index }] };
        }
        return {
          messages: [
            { type: "scripture_take_slide", showId: ctx.show.id, rowId: r.id, slideIdx: index, channel: "preview" },
          ],
        };
      }
      case "graphic": {
        const g = row as Extract<RowLike, { kind: "graphic" }>;
        const air = rowAirState(g, ctx.channelStates, ctx.songSessions, { showId: ctx.show.id, rows: ctx.show.rows });
        if (air === "program") return { messages: [], toast: "Already on air" };
        return { messages: [graphicRowMessage(g, "cue", ctx.overrides, ctx.show.id)] };
      }
      case "video": {
        const live = rowAirState(row as Extract<RowLike, { kind: "video" }>, ctx.channelStates, ctx.songSessions) === "program";
        if (live) return { messages: [] };
        return { messages: [], toast: "Videos play straight to their output: use Take" };
      }
      case "media": {
        // A photo has no cue or playback: a click takes it, unless it is already up.
        const p = row as Extract<RowLike, { kind: "media" }>;
        if (rowAirState(p, ctx.channelStates, ctx.songSessions) === "program") return { messages: [] };
        return { messages: [mediaRowTakeMessage(p, ctx.show.id)] };
      }
      case "slides": {
        // Live on any output (program or the row's routed one): jump that session.
        const live = slidesLiveChannel(row, ctx.channelStates);
        const msgs = slidesThumbMessages(ctx.show.id, row, index, live ? "program-live" : "preview", live ?? undefined);
        return msgs ? { messages: msgs } : { messages: [], toast: "Slides decks aren't available yet" };
      }
      default:
        return { messages: [] };
    }
  } catch {
    return { messages: [] };
  }
}
