import { describe, expect, it } from "vitest";
import type { RundownRow, ScriptureRow, Show, Song, TemplateMeta, VideoRow } from "@overlaysys/core";
import {
  addSongsLabel,
  applyPassage,
  arrangementAppend,
  arrangementMove,
  arrangementRemove,
  cueNoteRows,
  itemHeading,
  lastUsedGraphicTemplate,
  lengthFieldHint,
  newSongRows,
  outputOptions,
  overrideSeed,
  patchRow,
  pickRange,
  recentSongIds,
  recentTemplateIds,
  songIntroOutroChip,
  templateGroups,
  toggleSongPick,
  withSongDefaults,
  withVideoLengthPrefill,
} from "./itemFormModel";

const metas = [
  { id: "lt", name: "Lower Third" },
  { id: "ly", name: "Lyrics Clean" },
  { id: "ly2", name: "Lyrics Bold" },
  { id: "sc", name: "Scripture Card" },
  { id: "in", name: "Song Intro" },
] as TemplateMeta[];

function show(rows: unknown[], extra: Record<string, unknown> = {}): Show {
  return { id: "s", name: "S", projectId: "p", songs: [], rows, ...extra } as unknown as Show;
}

describe("common fields", () => {
  it("cue note grows 1–4 rows", () => {
    expect(cueNoteRows("")).toBe(1);
    expect(cueNoteRows("a\nb")).toBe(2);
    expect(cueNoteRows("a\nb\nc\nd\ne\nf")).toBe(4);
  });
  it("length hint: echo when valid, 'Use M:SS' when not", () => {
    expect(lengthFieldHint("5")).toEqual({ invalid: false, hint: "= 5:00" });
    expect(lengthFieldHint("")).toEqual({ invalid: false, hint: null });
    expect(lengthFieldHint("abc")).toEqual({ invalid: true, hint: "Use M:SS" });
  });
  it("output options start with Program (auto) and keep a missing value", () => {
    const ch = [{ id: "program", name: "Program" }, { id: "lower", name: "Lower" }];
    expect(outputOptions(ch, undefined).map((o) => o.label)).toEqual(["Program (auto)", "Program", "Lower"]);
    expect(outputOptions(ch, "gone")).toContainEqual({ value: "gone", label: "gone (missing)" });
  });
  it("patchRow keeps unknown keys and deletes undefined ones", () => {
    const r = { id: "a", kind: "graphic", templateId: "t", data: {}, futureKey: 1, notes: "x" } as unknown as RundownRow;
    const next = patchRow(r, { notes: undefined, channelHint: "lower" }) as unknown as Record<string, unknown>;
    expect(next).toEqual({ id: "a", kind: "graphic", templateId: "t", data: {}, futureKey: 1, channelHint: "lower" });
  });
  it("heading reads '<Kind> · <name>'", () => {
    expect(itemHeading("graphic", "Lower Third")).toBe("Graphic · Lower Third");
    expect(itemHeading("weird", "")).toBe("Item");
  });
});

describe("templates", () => {
  it("groups by use with recent first and flags a missing value", () => {
    const g = templateGroups(metas, "lyric", "nope", ["ly2"]);
    expect(g.suggested.map((m) => m.id)).toEqual(["ly2", "ly"]);
    expect(g.others.map((m) => m.id)).toEqual(["lt", "sc", "in"]);
    expect(g.missing).toBe(true);
    expect(templateGroups(metas, "lyric", "ly", []).missing).toBe(false);
  });
  it("recent template ids come from the show, last used first", () => {
    const s = show([
      { id: "1", kind: "graphic", templateId: "lt", data: {} },
      { id: "2", kind: "graphic", templateId: "sc", data: {} },
      { id: "3", kind: "song", songId: "x", lyricTemplateId: "ly2" },
      { id: "4", kind: "graphic", templateId: "lt", data: {} },
    ]);
    expect(recentTemplateIds(s, "graphic")).toEqual(["lt", "sc"]);
    expect(recentTemplateIds(s, "lyric")).toEqual(["ly2"]);
    expect(recentTemplateIds(s, "scripture")).toEqual([]);
  });
  it("new graphic uses the last used graphic template, else the first suggested", () => {
    expect(lastUsedGraphicTemplate(show([{ id: "1", kind: "graphic", templateId: "sc", data: {} }]), metas)?.id).toBe("sc");
    expect(lastUsedGraphicTemplate(show([]), metas)?.id).toBe("lt");
    expect(lastUsedGraphicTemplate(show([{ id: "1", kind: "graphic", templateId: "deleted", data: {} }]), metas)?.id).toBe("lt");
  });
});

describe("song picker", () => {
  it("toggles keep the picked order", () => {
    expect(toggleSongPick(toggleSongPick(toggleSongPick([], "b"), "a"), "b")).toEqual(["a"]);
    expect(toggleSongPick(["a"], "c")).toEqual(["a", "c"]);
  });
  it("shift-click picks the range from the anchor, in list order, keeping earlier picks first", () => {
    const list = ["a", "b", "c", "d", "e"];
    expect(pickRange(["x"], list, 1, 3)).toEqual(["x", "b", "c", "d"]);
    expect(pickRange(["c"], list, 3, 1)).toEqual(["c", "d", "b"]);
  });
  it("button label", () => {
    expect(addSongsLabel(0)).toBe("Add songs");
    expect(addSongsLabel(1)).toBe("Add 1 song");
    expect(addSongsLabel(8)).toBe("Add 8 songs");
  });
  it("recent songs from the show, last first", () => {
    const s = show([
      { id: "1", kind: "song", songId: "a", lyricTemplateId: "ly" },
      { id: "2", kind: "song", songId: "b", lyricTemplateId: "ly" },
      { id: "3", kind: "song", songId: "a", lyricTemplateId: "ly" },
    ]);
    expect(recentSongIds(s)).toEqual(["a", "b"]);
  });
  it("new song rows cascade the lyric template: show → song → first lyric template", () => {
    const s = show([], { songs: [{ songId: "a", lyricTemplateId: "ly2" }] });
    const cache = { b: { id: "b", defaultLyricTemplateId: "ly" } as Song };
    let n = 0;
    const rows = newSongRows(["a", "b", "c"], s, cache, metas, () => `r${++n}`);
    expect(rows).toEqual([
      { kind: "song", id: "r1", songId: "a", lyricTemplateId: "ly2" },
      { kind: "song", id: "r2", songId: "b", lyricTemplateId: "ly" },
      { kind: "song", id: "r3", songId: "c", lyricTemplateId: "ly2" },
    ]);
  });
  it("withSongDefaults adds a bare entry per new song once", () => {
    const s = show([], { songs: [{ songId: "a", lyricTemplateId: "x" }] });
    expect(withSongDefaults(s, ["a", "b", "b"]).songs).toEqual([{ songId: "a", lyricTemplateId: "x" }, { songId: "b" }]);
  });
});

describe("arrangement chips", () => {
  it("move, remove, append", () => {
    expect(arrangementMove(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(arrangementMove(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    expect(arrangementRemove(["a", "b", "a"], 2)).toEqual(["a", "b"]);
    expect(arrangementAppend(["a"], "c")).toEqual(["a", "c"]);
  });
});

describe("intro / outro chips", () => {
  const song = { id: "x", defaultIntroTemplateId: "in" } as Song;
  it("names the level the value comes from", () => {
    expect(songIntroOutroChip("intro", {}, undefined, song, metas)).toBe("Intro: Song Intro (song)");
    expect(songIntroOutroChip("intro", {}, { songId: "x", introTemplateId: "lt" }, song, metas)).toBe("Intro: Lower Third (show)");
    expect(songIntroOutroChip("intro", { introTemplateId: "sc" }, undefined, song, metas)).toBe("Intro: Scripture Card (item)");
    expect(songIntroOutroChip("outro", {}, undefined, song, metas)).toBe("Outro: none");
    expect(songIntroOutroChip("intro", { skipIntro: true }, undefined, song, metas)).toBe("Intro: skipped (item)");
  });
});

describe("override seed", () => {
  it("first real template id; never an empty string", () => {
    expect(overrideSeed("", undefined, "a")).toBe("a");
    expect(overrideSeed(undefined, "b")).toBe("b");
    expect(overrideSeed("", undefined)).toBeUndefined();
  });
});

describe("video", () => {
  it("prefills length from the probed duration only when unset", () => {
    const v = { id: "v", kind: "video", assetUrl: "a.mp4", durationSec: 61.6 } as VideoRow;
    expect(withVideoLengthPrefill(v).lengthSec).toBe(62);
    expect(withVideoLengthPrefill({ ...v, lengthSec: 10 }).lengthSec).toBe(10);
    expect(withVideoLengthPrefill({ ...v, durationSec: undefined }).lengthSec).toBeUndefined();
  });
});

describe("scripture passage change", () => {
  it("keeps id, length, notes link and unknown keys", () => {
    const row = {
      kind: "scripture",
      id: "keep",
      reference: "John 1:1",
      translation: "kjv",
      slides: [{ id: "s1", verses: [] }],
      templateId: "sc",
      lengthSec: 90,
      sermonNotesId: "n1",
      notes: "cue",
      sectionId: "A",
      futureKey: 1,
      introTemplateId: "old",
      source: { provider: "api.bible", bibleId: "b", fetchedAt: "x", usageTokens: [] },
    } as unknown as ScriptureRow;
    const next = applyPassage(row, {
      reference: "Psalm 23:1",
      translation: "web",
      translationAbbreviation: "WEB",
      attribution: "Public domain",
      source: undefined,
      slides: [{ id: "n1", verses: [] }],
      templateId: "sc",
      intro: {},
    }) as unknown as Record<string, unknown>;
    expect(next).toMatchObject({
      id: "keep",
      reference: "Psalm 23:1",
      translation: "web",
      translationAbbreviation: "WEB",
      lengthSec: 90,
      sermonNotesId: "n1",
      notes: "cue",
      sectionId: "A",
      futureKey: 1,
    });
    expect("introTemplateId" in next).toBe(false);
    // The old passage's licensed-API provenance must not follow a public-domain replacement.
    expect("source" in next).toBe(false);
  });
});
