// Pure derivation of a confidence monitor's StageFeed. All I/O (loading
// shows, songs, templates, configs) lives in stageFeedHub.ts so this file
// can be exhaustively unit-tested.

import {
  NONE_SLIDE,
  decodeTimerValue,
  resolveArrangement,
  stageTimerValue,
  type ChannelState,
  type RundownRow,
  type Show,
  type SlideView,
  type NotesPoint,
  type SermonNotes,
  type Song,
  type StageFeed,
  type StageLayout,
  type StageRowView,
  type StageServiceView,
  type StageState,
  type StageTimer,
  type StageTimerInstance,
  type StageVideo,
  type Template,
} from "@overlaysys/core";
import { scriptureSlideData } from "@overlaysys/scripture";

export interface StageFeedInputs {
  layout: StageLayout;
  followed: ChannelState | null;
  allStates: ChannelState[];
  show: Show | null;
  songs: Map<string, Song>;
  templates: Map<string, Template>;
  now: number;
  stage: StageState;
  /** Standalone and item timers, item timer first (reducer order). */
  stageTimers: StageTimerInstance[];
  notes: { notes: SermonNotes; points: NotesPoint[] } | null;
  /** PCO Live service view; null (or omitted) while sync is off. */
  service?: StageServiceView | null;
}

type Cursor = { sectionIdx: number; slideIdx: number };

function sectionFor(song: Song, arrangement: string[], sectionIdx: number) {
  const id = arrangement[sectionIdx];
  return id === undefined ? undefined : song.sections.find((s) => s.id === id);
}

export function lyricSlideAt(song: Song, arrangement: string[], cursor: Cursor): SlideView {
  const section = sectionFor(song, arrangement, cursor.sectionIdx);
  const slide = section?.slides[cursor.slideIdx];
  if (!section || !slide) return NONE_SLIDE;
  return { kind: "lyric", lines: slide.lines, reference: section.label };
}

/** Next slide in arrangement order, skipping missing sections; null at the end. */
export function nextLyricCursor(song: Song, arrangement: string[], cursor: Cursor): Cursor | null {
  const section = sectionFor(song, arrangement, cursor.sectionIdx);
  if (section && cursor.slideIdx + 1 < section.slides.length) {
    return { sectionIdx: cursor.sectionIdx, slideIdx: cursor.slideIdx + 1 };
  }
  for (let i = cursor.sectionIdx + 1; i < arrangement.length; i++) {
    if (sectionFor(song, arrangement, i)) return { sectionIdx: i, slideIdx: 0 };
  }
  return null;
}

function textFieldLines(template: Template | undefined, data: Record<string, string>): string[] {
  if (!template) return [];
  return template.fields
    .filter((f) => f.type === "text")
    .map((f) => (data[f.key] ?? "").trim())
    .filter((v) => v !== "");
}

export function rowTitle(row: RundownRow, songs: Map<string, Song>, templates: Map<string, Template>): string {
  switch (row.kind) {
    case "graphic": {
      const tpl = templates.get(row.templateId);
      const first = textFieldLines(tpl, row.data)[0];
      const name = tpl?.name ?? "Graphic";
      return first ? `${name} — ${first}` : name;
    }
    case "song":
      return songs.get(row.songId)?.title ?? "Song";
    case "scripture":
      return row.reference;
    case "video":
      return row.label ?? "Video";
    // [P3.8] placeholder; Task 10 replaces this
    case "slides":
      return "Slides";
  }
}

function rowView(row: RundownRow, songs: Map<string, Song>, templates: Map<string, Template>): StageRowView {
  return { title: rowTitle(row, songs, templates), cue: row.notes?.trim() ?? "" };
}

function scriptureView(row: Extract<RundownRow, { kind: "scripture" }>, slideIdx: number): SlideView {
  const d = scriptureSlideData(row, slideIdx);
  return { kind: "scripture", lines: d.text.split("\n"), reference: d.reference };
}

/** What a row puts on screen first. */
export function firstContentOf(
  row: RundownRow | null,
  show: Show,
  songs: Map<string, Song>,
  templates: Map<string, Template>,
): SlideView {
  if (!row) return NONE_SLIDE;
  switch (row.kind) {
    case "song": {
      const song = songs.get(row.songId);
      if (!song) return NONE_SLIDE;
      const showSong = show.songs.find((s) => s.songId === row.songId);
      const arrangement = resolveArrangement(row, showSong, song);
      const view = lyricSlideAt(song, arrangement, { sectionIdx: 0, slideIdx: 0 });
      return view.kind === "none" ? view : { ...view, reference: song.title };
    }
    case "scripture":
      return scriptureView(row, 0);
    case "graphic": {
      const tpl = templates.get(row.templateId);
      return { kind: "graphic", lines: textFieldLines(tpl, row.data), reference: tpl?.name ?? "Graphic" };
    }
    case "video":
      return { kind: "graphic", lines: [row.label ?? "Video"], reference: "Video" };
    // [P3.8] placeholder; Task 10 replaces this
    case "slides":
      return NONE_SLIDE;
  }
}

function currentOf(s: ChannelState, songs: Map<string, Song>, templates: Map<string, Template>): SlideView {
  if (s.songSession) {
    if (s.songSession.blanked) return NONE_SLIDE;
    const song = songs.get(s.songSession.songId);
    return song ? lyricSlideAt(song, s.songSession.arrangement, s.songSession.cursor) : NONE_SLIDE;
  }
  if (s.scriptureSession) {
    return {
      kind: "scripture",
      lines: s.scriptureSession.text.split("\n"),
      reference: s.scriptureSession.slideReference,
    };
  }
  if (s.active && s.active.phase !== "out") {
    const tpl = templates.get(s.active.templateId);
    return { kind: "graphic", lines: textFieldLines(tpl, s.active.data), reference: tpl?.name ?? "Graphic" };
  }
  return NONE_SLIDE;
}

/** The followed channel's timers come first, then the rest by channel id. */
function timersOf(
  instances: StageTimerInstance[],
  states: ChannelState[],
  templates: Map<string, Template>,
  followedId: string | null,
  now: number,
): StageTimer[] {
  const out: StageTimer[] = instances.map((t) => ({
    id: t.id,
    label: t.label,
    mode: t.mode,
    source: t.source,
    overtime: t.overtime,
    running: t.anchor !== null && t.pausedAt == null,
    value: stageTimerValue(t, now),
  }));
  const sorted = [...states].sort((a, b) => {
    if (a.channel === followedId) return b.channel === followedId ? 0 : -1;
    if (b.channel === followedId) return 1;
    return a.channel.localeCompare(b.channel);
  });
  for (const s of sorted) {
    if (!s.active || s.active.phase === "out") continue;
    const tpl = templates.get(s.active.templateId);
    if (!tpl) continue;
    for (const f of tpl.fields) {
      if (f.type !== "time" || (f.timeMode !== "countdown" && f.timeMode !== "countup")) continue;
      const value = s.active.data[f.key] ?? "";
      const decoded = decodeTimerValue(value);
      if (!Number.isFinite(decoded.anchor)) continue;
      out.push({
        id: `${s.channel}:${f.key}`,
        source: "graphic",
        overtime: false,
        running: decoded.pausedAt == null,
        label: f.label || tpl.name,
        channel: s.channel,
        mode: f.timeMode,
        ...(f.timeFormat ? { format: f.timeFormat } : {}),
        value,
      });
    }
  }
  return out;
}

function videoOf(s: ChannelState | null): StageVideo | null {
  const m = s?.media;
  if (!m) return null;
  const { status, currentTime, duration, updatedAt } = m.playback;
  if (status === "ended" || status === "error") return null;
  return { status, currentTime, duration, at: updatedAt, ...(m.label !== undefined ? { label: m.label } : {}) };
}

export function buildStageFeed(i: StageFeedInputs): StageFeed {
  const { followed, show, songs, templates } = i;
  const liveRow = followed?.liveRow;
  const idx = show && liveRow ? show.rows.findIndex((r) => r.id === liveRow.rowId) : -1;
  const row = show && idx >= 0 ? show.rows[idx]! : null;
  const nextRowObj = show && idx >= 0 ? show.rows[idx + 1] ?? null : null;

  const current = followed ? currentOf(followed, songs, templates) : NONE_SLIDE;

  let next: SlideView = NONE_SLIDE;
  if (followed) {
    const sess = followed.songSession;
    const song = sess ? songs.get(sess.songId) : undefined;
    if (sess && song) {
      const c = nextLyricCursor(song, sess.arrangement, sess.cursor);
      if (c) next = lyricSlideAt(song, sess.arrangement, c);
    } else if (followed.scriptureSession && row?.kind === "scripture" && row.id === followed.scriptureSession.rowId) {
      const n = followed.scriptureSession.slideIdx + 1;
      if (n < row.slides.length) next = scriptureView(row, n);
    } else if (
      show &&
      row &&
      ((row.kind === "song" && followed.queuedSong?.songRowId === row.id) ||
        (row.kind === "scripture" && followed.queuedScripture?.rowId === row.id))
    ) {
      // An intro is on air with its row armed: next is the row's own first slide.
      next = firstContentOf(row, show, songs, templates);
    }
    if (next.kind === "none" && show && row) {
      next = firstContentOf(nextRowObj, show, songs, templates);
    }
  }

  const notesView = i.notes
    ? {
        id: i.notes.notes.id,
        title: i.notes.notes.title,
        points: i.notes.points,
        pointIdx: Math.min(i.stage.pointIdx, Math.max(0, i.notes.points.length - 1)),
        scrollOffset: i.stage.scrollOffset,
      }
    : null;

  return {
    layout: i.layout,
    current,
    next,
    row: row ? rowView(row, songs, templates) : null,
    nextRow: nextRowObj ? rowView(nextRowObj, songs, templates) : null,
    timers: timersOf(i.stageTimers, i.allStates, templates, followed?.channel ?? null, i.now),
    video: videoOf(followed),
    notes: notesView,
    message: i.stage.message,
    service: i.service ?? null,
    serverNow: i.now,
  };
}
