import { describe, expect, it, vi } from "vitest";
import type { ChannelState, Section, Show, Song, SongSessionSummary } from "@overlaysys/core";

const slidesMock = vi.fn();
vi.mock("./slidesRowView", () => ({
  slidesRowViewFor: (...a: unknown[]) => slidesMock(...a),
  slidesAirState: (row: { id: string }, st: Record<string, ChannelState>) =>
    st.program?.slidesSession?.rowId === row.id ? "program" : st.preview?.slidesSession?.rowId === row.id ? "preview" : null,
  slidesThumbState: (row: { id: string }, pos: number, st: Record<string, ChannelState>) =>
    st.program?.slidesSession?.rowId === row.id && st.program.slidesSession.slideIdx === pos ? "live" : null,
  slidesThumbMessages: (showId: string, row: { id: string }, pos: number, target: string) =>
    target === "program-live"
      ? [{ type: "slides_goto", channel: "program", slideIdx: pos }]
      : [{ type: "slides_take", showId, rowId: row.id, slideIdx: pos, channel: "preview" }],
}));

import { thumbActivate, thumbsFor, type ThumbCtx } from "./thumbClick";

const sec = (id: string, kind: Section["kind"], slides: string[][]): Section => ({
  id,
  kind,
  label: id,
  slides: slides.map((lines, i) => ({ id: `${id}-${i}`, lines })),
});

const song = (id: string, sections: Section[], defaultArrangement: string[]): Song =>
  ({ id, title: id, sections, defaultArrangement, customFields: {} }) as unknown as Song;

const songA = song(
  "A",
  [
    sec("v1", "verse", [["Line one of verse one", "Line two of verse one"], ["Verse one slide two"]]),
    sec("c1", "chorus", [["Chorus line"]]),
    sec("v2", "verse", [["Verse two line"]]),
  ],
  ["v1", "c1", "v2", "c1"],
);
const songB = song("B", [sec("v1", "verse", [["B one"], ["B two"], ["B three"]])], ["v1"]);

const songRowA = { kind: "song", id: "rowA", songId: "A", lyricTemplateId: "lyric" };
const songRowB = { kind: "song", id: "rowB", songId: "B", lyricTemplateId: "lyric" };

const session = (songId: string, arrangement: string[], cursor = { sectionIdx: 0, slideIdx: 0 }, blanked = false): SongSessionSummary => ({
  songId,
  lyricTemplateId: "lyric-live",
  arrangement,
  cursor,
  blanked,
  trustMode: false,
  startedAt: 0,
});

const mkCtx = (o: Partial<ThumbCtx> & { rows?: unknown[] } = {}): ThumbCtx => ({
  show: { id: "show1", name: "S", projectId: "p", rows: o.rows ?? [songRowA, songRowB], songs: [] } as unknown as Show,
  songs: [],
  songCache: { A: songA, B: songB },
  templates: [],
  templateCache: {},
  overrides: {},
  deckCache: {},
  channelStates: {},
  songSessions: {},
  ...o,
});

const liveState = (rowId: string): Record<string, ChannelState> => ({
  program: { liveRow: { showId: "show1", rowId } } as unknown as ChannelState,
});

describe("thumbsFor", () => {
  it("song thumbs: one per slide in arrangement order with group labels", () => {
    const t = thumbsFor(songRowA as never, mkCtx());
    expect(t.map((x) => x.label)).toEqual(["V1 · 1", "V1 · 2", "C · 1", "V2 · 1", "C · 1"]);
    expect(t[0]!.render).toEqual({
      kind: "template",
      templateId: "lyric",
      data: { text: "Line one of verse one\nLine two of verse one" },
    });
    expect(t[2]!.group).toEqual({ label: "C", sectionKind: "chorus" });
  });

  it("live song: the slide under the cursor is live and blanked state follows the session; preview cursor is cued", () => {
    const arr = ["v1", "c1", "v2", "c1"];
    const live = mkCtx({
      channelStates: liveState("rowA"),
      songSessions: { program: session("A", arr, { sectionIdx: 1, slideIdx: 0 }, true) },
    });
    const t = thumbsFor(songRowA as never, live);
    expect(t.map((x) => x.state)).toEqual([null, null, "live", null, null]);
    expect(t[2]!.blanked).toBe(true);
    expect(t[2]!.render).toMatchObject({ templateId: "lyric-live" });

    const pvw = mkCtx({
      channelStates: { preview: { liveRow: { showId: "show1", rowId: "rowA" } } as unknown as ChannelState },
      songSessions: { preview: session("A", arr, { sectionIdx: 3, slideIdx: 0 }) },
    });
    const p = thumbsFor(songRowA as never, pvw);
    expect(p[4]!.state).toBe("cued");
    expect(p[4]!.blanked).toBe(false);
  });

  it("video thumb is the poster frame", () => {
    const v = { kind: "video", id: "v", assetUrl: "/assets/abc.mp4" };
    expect(thumbsFor(v as never, mkCtx())[0]!.render).toEqual({ kind: "poster", src: "/api/assets/poster/abc.mp4" });
    expect(thumbsFor({ ...v, assetUrl: "https://x/y.mp4" } as never, mkCtx())[0]!.render).toEqual({ kind: "poster", src: null });
  });

  it("slides without plan 3: placeholder thumb, click sends nothing", () => {
    slidesMock.mockReturnValue(null);
    const row = { kind: "slides", id: "s1", deckId: "d" };
    expect(thumbsFor(row as never, mkCtx())[0]!.render.kind).toBe("placeholder");
    slidesMock.mockReset();
  });

  it("slides thumbs come from the adapter view", () => {
    slidesMock.mockReturnValue({ slides: [{ key: "k1", slideId: "a", position: 0, templateId: "t", data: { x: "1" } }, { key: "k2", slideId: "b", position: 1, templateId: "t", data: {}, label: "Hi" }] });
    const row = { kind: "slides", id: "s1", deckId: "d" };
    const t = thumbsFor(row as never, mkCtx());
    expect(t.map((x) => x.label)).toEqual(["Slide 1", "Hi"]);
    slidesMock.mockReset();
  });

  it("slides thumbs match program: unsupplied text fields render \"\", not the design's sample", () => {
    slidesMock.mockReturnValue({
      slides: [{ key: "k1", slideId: "a", position: 0, templateId: "LT", data: { subtitle: "Line D" } }],
    });
    const lt = {
      id: "LT",
      fields: [
        { key: "header", type: "text", label: "Header", default: "Rev Sample Name" },
        { key: "subtitle", type: "text", label: "Subtitle", default: "Sample title" },
      ],
    };
    const row = { kind: "slides", id: "s1", deckId: "d" };
    const t = thumbsFor(row as never, mkCtx({ templateCache: { LT: lt } as never }));
    expect(t[0]!.render).toEqual({ kind: "template", templateId: "LT", data: { header: "", subtitle: "Line D" } });
    slidesMock.mockReset();
  });
});

describe("thumbActivate", () => {
  const arr = ["v1", "c1", "v2", "c1"];

  it("live song jumps to the clicked slide", () => {
    const ctx = mkCtx({ channelStates: liveState("rowA"), songSessions: { program: session("A", arr, { sectionIdx: 1, slideIdx: 0 }) } });
    // thumb 3 = v2 (arrIdx 2); from c1 (1 slide) the delta is 1
    expect(thumbActivate(songRowA as never, 3, ctx).messages).toEqual([{ type: "song_advance", channel: "program", delta: 1 }]);
  });

  it("live song: clicking the slide already on air sends nothing", () => {
    const ctx = mkCtx({ channelStates: liveState("rowA"), songSessions: { program: session("A", arr, { sectionIdx: 1, slideIdx: 0 }) } });
    expect(thumbActivate(songRowA as never, 2, ctx)).toEqual({ messages: [] });
  });

  it("repeated chorus lands on the clicked occurrence", () => {
    const ctx = mkCtx({ channelStates: liveState("rowA"), songSessions: { program: session("A", arr) } });
    // entries: v1s0 v1s1 c1 v2 c1(arrIdx 3) v1 has 2 slides: 2 + 1 (c1) + 1 (v2) = 4
    const msgs = thumbActivate(songRowA as never, 4, ctx).messages;
    expect(msgs).toEqual([{ type: "song_advance", channel: "program", delta: 4 }]);
    expect(msgs.some((m) => m.type === "song_jump")).toBe(false);
  });

  it("slide within a multi-slide section adds the slide offset", () => {
    const ctx = mkCtx({ channelStates: liveState("rowA"), songSessions: { program: session("A", arr) } });
    expect(thumbActivate(songRowA as never, 1, ctx).messages).toEqual([{ type: "song_advance", channel: "program", delta: 1 }]);
  });

  it("song not live while another song is on program cues preview only", () => {
    const ctx = mkCtx({ channelStates: liveState("rowA"), songSessions: { program: session("A", arr, { sectionIdx: 1, slideIdx: 0 }) } });
    const msgs = thumbActivate(songRowB as never, 2, ctx).messages;
    expect(msgs).toEqual([
      { type: "song_take", channel: "preview", showId: "show1", songRowId: "rowB" },
      { type: "song_advance", channel: "preview", delta: 2 },
    ]);
    expect(msgs.every((m) => !("channel" in m) || m.channel === "preview")).toBe(true);
  });

  it("not live, first slide: take on preview, no advance", () => {
    expect(thumbActivate(songRowB as never, 0, mkCtx()).messages).toEqual([
      { type: "song_take", channel: "preview", showId: "show1", songRowId: "rowB" },
    ]);
  });

  it("not live but already on preview: advance preview only", () => {
    const ctx = mkCtx({
      channelStates: { preview: { liveRow: { showId: "show1", rowId: "rowB" } } as unknown as ChannelState },
      songSessions: { preview: session("B", ["v1"], { sectionIdx: 0, slideIdx: 1 }) },
    });
    expect(thumbActivate(songRowB as never, 2, ctx).messages).toEqual([{ type: "song_advance", channel: "preview", delta: 1 }]);
  });

  it("stale live arrangement falls back safely", () => {
    const stale = [...arr, "c9"];
    const ctx = mkCtx({ channelStates: liveState("rowA"), songSessions: { program: session("A", stale) } });
    expect(thumbActivate(songRowA as never, 5, ctx)).toEqual({ messages: [], toast: "That section is no longer in this song" });
    // a thumb after the removed section jumps by id rather than walking across it
    const after = ["v1", "c9", "v2"];
    const ctx2 = mkCtx({ channelStates: liveState("rowA"), songSessions: { program: session("A", after) } });
    expect(thumbActivate(songRowA as never, 3, ctx2).messages).toEqual([
      { type: "song_jump", channel: "program", sectionId: "v2", slideIdx: 0 },
    ]);
  });

  it("same song live on program from a different row or show never moves that session", () => {
    const sess = { program: session("A", arr, { sectionIdx: 1, slideIdx: 0 }) };
    const otherRow = mkCtx({ rows: [songRowA, { ...songRowA, id: "rowA2" }], channelStates: liveState("rowA2"), songSessions: sess });
    const otherShow = mkCtx({
      channelStates: { program: { liveRow: { showId: "other", rowId: "rowA" } } as unknown as ChannelState },
      songSessions: sess,
    });
    for (const ctx of [otherRow, otherShow]) {
      const msgs = thumbActivate(songRowA as never, 3, ctx).messages;
      expect(msgs[0]).toEqual({ type: "song_take", channel: "preview", showId: "show1", songRowId: "rowA" });
      expect(msgs.every((m) => !("channel" in m) || m.channel === "preview")).toBe(true);
    }
  });

  it("song live on program with liveRow on a video (lyrics over video) still advances program", () => {
    const video = { kind: "video", id: "vid", assetUrl: "/assets/a.mp4" };
    const ctx = mkCtx({
      rows: [songRowA, video],
      channelStates: liveState("vid"),
      songSessions: { program: session("A", arr, { sectionIdx: 1, slideIdx: 0 }) },
    });
    expect(thumbActivate(songRowA as never, 3, ctx).messages).toEqual([{ type: "song_advance", channel: "program", delta: 1 }]);
  });

  it("reprise (same song twice) after a video take: the other row cues to PVW and isn't shown live", () => {
    const video = { kind: "video", id: "vid", assetUrl: "/assets/a.mp4" };
    const reprise = { ...songRowA, id: "rowA2" };
    const ctx = mkCtx({
      rows: [songRowA, video, reprise],
      channelStates: liveState("vid"),
      songSessions: { program: session("A", arr, { sectionIdx: 1, slideIdx: 0 }) },
    });
    for (const row of [songRowA, reprise]) {
      const msgs = thumbActivate(row as never, 3, ctx).messages;
      expect(msgs[0]).toEqual({ type: "song_take", channel: "preview", showId: "show1", songRowId: row.id });
      expect(msgs.every((m) => !("channel" in m) || m.channel === "preview")).toBe(true);
      expect(thumbsFor(row as never, ctx).some((t) => t.state === "live")).toBe(false);
    }
  });

  it("reprise after a video take with a session naming its row: that row advances, the other cues", () => {
    const video = { kind: "video", id: "vid", assetUrl: "/assets/a.mp4" };
    const reprise = { ...songRowA, id: "rowA2" };
    const ctx = mkCtx({
      rows: [songRowA, video, reprise],
      channelStates: liveState("vid"),
      songSessions: { program: { ...session("A", arr, { sectionIdx: 1, slideIdx: 0 }), rowId: "rowA2", showId: "show1" } },
    });
    expect(thumbActivate(reprise as never, 3, ctx).messages).toEqual([{ type: "song_advance", channel: "program", delta: 1 }]);
    expect(thumbsFor(reprise as never, ctx).some((t) => t.state === "live")).toBe(true);
    const msgs = thumbActivate(songRowA as never, 3, ctx).messages;
    expect(msgs[0]).toEqual({ type: "song_take", channel: "preview", showId: "show1", songRowId: "rowA" });
    expect(thumbsFor(songRowA as never, ctx).some((t) => t.state === "live")).toBe(false);
  });

  it("no liveRow: a song's only row advances program; a reprise row cues to PVW", () => {
    const sess = { program: session("A", arr, { sectionIdx: 1, slideIdx: 0 }) };
    const alone = mkCtx({ channelStates: { program: {} as unknown as ChannelState }, songSessions: sess });
    expect(thumbActivate(songRowA as never, 3, alone).messages).toEqual([{ type: "song_advance", channel: "program", delta: 1 }]);
    const twice = mkCtx({ rows: [songRowA, { ...songRowA, id: "rowA2" }], songSessions: sess });
    const msgs = thumbActivate(songRowA as never, 3, twice).messages;
    expect(msgs[0]).toEqual({ type: "song_take", channel: "preview", showId: "show1", songRowId: "rowA" });
    expect(msgs.every((m) => !("channel" in m) || m.channel === "preview")).toBe(true);
  });

  it("scripture live with liveRow on a video still goes to the slide", () => {
    const row = { kind: "scripture", id: "sc", reference: "R", translation: "kjv", slides: [{ verses: [] }, { verses: [] }], templateId: "st" };
    const ctx = mkCtx({
      rows: [row, { kind: "video", id: "vid", assetUrl: "/assets/a.mp4" }],
      channelStates: { program: { scriptureSession: { rowId: "sc", slideIdx: 0 }, liveRow: { showId: "show1", rowId: "vid" } } as unknown as ChannelState },
    });
    expect(thumbActivate(row as never, 1, ctx).messages).toEqual([{ type: "scripture_goto", channel: "program", slideIdx: 1 }]);
  });

  it("scripture live from another show cues preview", () => {
    const row = { kind: "scripture", id: "sc", reference: "R", translation: "kjv", slides: [{ verses: [] }, { verses: [] }], templateId: "st" };
    const ctx = mkCtx({
      channelStates: { program: { scriptureSession: { rowId: "sc", slideIdx: 0 }, liveRow: { showId: "other", rowId: "sc" } } as unknown as ChannelState },
    });
    expect(thumbActivate(row as never, 1, ctx).messages[0]).toMatchObject({ type: "scripture_take_slide", channel: "preview" });
  });

  const scrip = { kind: "scripture", id: "sc", reference: "R", translation: "kjv", slides: [{ verses: [] }, { verses: [] }, { verses: [] }], templateId: "st" };
  it("scripture: live goes to the slide, not live cues it on preview", () => {
    const live = mkCtx({ channelStates: { program: { scriptureSession: { rowId: "sc", slideIdx: 0 }, liveRow: { showId: "show1", rowId: "sc" } } as unknown as ChannelState } });
    expect(thumbActivate(scrip as never, 2, live).messages).toEqual([{ type: "scripture_goto", channel: "program", slideIdx: 2 }]);
    expect(thumbActivate(scrip as never, 2, mkCtx()).messages).toEqual([
      { type: "scripture_take_slide", showId: "show1", rowId: "sc", slideIdx: 2, channel: "preview" },
    ]);
  });

  it("graphic hinted to program: a click on a non-live graphic cues preview", () => {
    const g = { kind: "graphic", id: "g", templateId: "t", data: { a: "b" }, channelHint: "program" };
    expect(thumbActivate(g as never, 0, mkCtx()).messages[0]).toMatchObject({ type: "cue", channel: "preview" });
  });

  it("graphic already on program says so", () => {
    const g = { kind: "graphic", id: "g", templateId: "t", data: { a: "b" } };
    const ctx = mkCtx({ channelStates: { program: { active: { phase: "in", templateId: "t", data: { a: "b" } } } as unknown as ChannelState } });
    expect(thumbActivate(g as never, 0, ctx)).toEqual({ messages: [], toast: "Already on air" });
  });

  it("video never sends from a thumbnail", () => {
    const v = { kind: "video", id: "v", assetUrl: "/assets/abc.mp4" };
    expect(thumbActivate(v as never, 0, mkCtx())).toEqual({ messages: [], toast: "Videos play straight to their output: use Take" });
  });

  it("slides: live goes to the slide on program, otherwise cues preview", () => {
    const row = { kind: "slides", id: "s1", deckId: "d" };
    const live = mkCtx({ channelStates: { program: { slidesSession: { rowId: "s1", slideIdx: 0 } } as unknown as ChannelState } });
    expect(thumbActivate(row as never, 2, live).messages).toEqual([{ type: "slides_goto", channel: "program", slideIdx: 2 }]);
    expect(thumbActivate(row as never, 2, mkCtx()).messages).toEqual([
      { type: "slides_take", showId: "show1", rowId: "s1", slideIdx: 2, channel: "preview" },
    ]);
  });
});
