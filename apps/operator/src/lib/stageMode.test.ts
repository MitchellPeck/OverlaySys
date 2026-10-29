import { describe, it, expect } from "vitest";
import type { ChannelState, Show, SongSessionSummary } from "@overlaysys/core";
import { pinnedRowId, regionRowId, stageModeFor, shortcutHint } from "./stageMode";

const show = {
  id: "sh",
  rows: [
    { id: "g", kind: "graphic", templateId: "l3", data: {} },
    { id: "s", kind: "song", songId: "wm", lyricTemplateId: "lyr" },
    { id: "x", kind: "scripture", reference: "John 3:16" },
    { id: "v", kind: "video", label: "Giving" },
  ],
} as unknown as Show;

const session: SongSessionSummary = {
  songId: "wm", lyricTemplateId: "lyr", arrangement: [], cursor: { sectionIdx: 0, slideIdx: 0 },
  blanked: false, trustMode: false, startedAt: 1,
};

const base = { show, selectedRowId: null, selectedHotcardId: null, songSessions: {}, quickTake: false };

describe("stageModeFor", () => {
  it("is empty with nothing selected", () => {
    expect(stageModeFor(base)).toEqual({ kind: "empty" });
  });

  it("picks the mode from the selected row's kind", () => {
    expect(stageModeFor({ ...base, selectedRowId: "g" }).kind).toBe("graphic");
    expect(stageModeFor({ ...base, selectedRowId: "s" }).kind).toBe("song");
    expect(stageModeFor({ ...base, selectedRowId: "x" }).kind).toBe("scripture");
    expect(stageModeFor({ ...base, selectedRowId: "v" }).kind).toBe("video");
  });

  it("shows the hotcard when a hotcard is selected", () => {
    expect(stageModeFor({ ...base, selectedHotcardId: "h1" })).toEqual({ kind: "hotcard", hotcardId: "h1" });
  });

  it("falls back to empty when the selected row no longer exists", () => {
    expect(stageModeFor({ ...base, selectedRowId: "deleted" })).toEqual({ kind: "empty" });
  });

  it("falls back to empty when there is no show", () => {
    expect(stageModeFor({ ...base, show: null, selectedRowId: "g" })).toEqual({ kind: "empty" });
  });

  it("quick take overrides row selection", () => {
    expect(stageModeFor({ ...base, selectedRowId: "g", quickTake: true })).toEqual({ kind: "quick-take" });
  });

  it("a live song session overrides everything, program first, and carries the selection", () => {
    expect(
      stageModeFor({ ...base, selectedRowId: "g", songSessions: { preview: session } }),
    ).toEqual({ kind: "song-live", channel: "preview", session, selection: { kind: "graphic", row: show.rows[0] } });
    // Quick take is reachable in song mode too (the item bar's far-right toggle).
    expect(
      stageModeFor({ ...base, selectedRowId: "g", quickTake: true, songSessions: { preview: session } }),
    ).toEqual({ kind: "song-live", channel: "preview", session, selection: { kind: "quick-take" } });
    expect(
      stageModeFor({ ...base, songSessions: { program: session, preview: { ...session, songId: "other" } } }),
    ).toEqual({ kind: "song-live", channel: "program", session, selection: { kind: "empty" } });
  });

  it("keeps a selected scripture row reachable while a PVW-only session exists", () => {
    const m = stageModeFor({ ...base, selectedRowId: "x", songSessions: { preview: session } });
    expect(m.kind).toBe("song-live");
    if (m.kind !== "song-live") throw new Error("unreachable");
    expect(m.channel).toBe("preview");
    expect(m.selection.kind).toBe("scripture");
    expect(m.selection).toEqual({ kind: "scripture", row: show.rows[2] });
  });

  it("keeps a selected graphic row reachable while a PGM session exists", () => {
    const m = stageModeFor({ ...base, selectedRowId: "g", songSessions: { program: session } });
    expect(m).toEqual({ kind: "song-live", channel: "program", session, selection: { kind: "graphic", row: show.rows[0] } });
  });

  it("carries a selected hotcard under a live session", () => {
    const m = stageModeFor({ ...base, selectedHotcardId: "h1", songSessions: { program: session } });
    expect(m).toEqual({ kind: "song-live", channel: "program", session, selection: { kind: "hotcard", hotcardId: "h1" } });
  });

  it("treats a null session entry as no session", () => {
    expect(stageModeFor({ ...base, songSessions: { program: null } })).toEqual({ kind: "empty" });
  });
});

describe("shortcutHint", () => {
  it("describes song-mode keys while a song is live, including 0 for verse 10", () => {
    const h = shortcutHint({ kind: "song-live", channel: "program", session, selection: { kind: "empty" } });
    expect(h).toContain("Space next");
    expect(h).toContain("1–9, 0 verse");
    expect(h).toContain("Esc Esc end song");
  });

  it("keeps the song hint in song-live even with a row selected", () => {
    const h = shortcutHint({
      kind: "song-live", channel: "program", session, selection: { kind: "scripture", row: show.rows[2] as never },
    });
    expect(h).toContain("Space next");
  });

  it("with the song only cued on PVW, describes the selection's keys instead", () => {
    const h = shortcutHint({
      kind: "song-live", channel: "preview", session, selection: { kind: "graphic", row: show.rows[0] as never },
    });
    expect(h).not.toContain("Space next");
    expect(h).toContain("Space take");
  });

  it("says quick take is button-driven", () => {
    expect(shortcutHint({ kind: "quick-take" })).toBe(
      "Keys act on the rundown selection · use the buttons above for Quick take",
    );
  });

  it("describes scripture keys while live, whatever row is selected", () => {
    const m = stageModeFor({ show, selectedRowId: show.rows[0]!.id, selectedHotcardId: null, songSessions: {}, quickTake: false, scriptureLive: true });
    expect(m.kind).toBe("scripture-live");
    expect(shortcutHint(m)).toBe(
      "Space next · Shift+Space previous · Enter cue selection · ⌘Enter take PVW · Esc Esc clear program",
    );
  });

  it("describes rundown keys for a selected scripture row that is not live", () => {
    expect(shortcutHint({ kind: "scripture", row: show.rows[2] as never })).toBe(
      "↑/↓ select · Enter cue · Space take · ⌘Enter take PVW · Esc Esc clear program",
    );
  });

  it("describes graphic keys otherwise", () => {
    const h = shortcutHint({ kind: "empty" });
    expect(h).toContain("Enter cue");
    expect(h).toContain("Space take");
    expect(h).toContain("Esc clear program");
  });

  it("describes Space as play/pause for a video row", () => {
    expect(shortcutHint({ kind: "video", row: show.rows[3] as never })).toContain("Space take / play-pause");
  });
});

describe("regionRowId", () => {
  const two = {
    id: "sh",
    rows: [...show.rows, { id: "s2", kind: "song", songId: "wm", lyricTemplateId: "lyr" }],
  } as unknown as Show;

  it("shows the selected row, even while a song is live", () => {
    expect(regionRowId(stageModeFor({ ...base, show: two, selectedRowId: "g" }), two)).toBe("g");
    expect(regionRowId(stageModeFor({ ...base, show: two, selectedRowId: "x", songSessions: { program: session } }), two)).toBe("x");
  });

  it("with nothing selected under a live song, shows the live song's exact row", () => {
    const m = stageModeFor({ ...base, show: two, songSessions: { program: session } });
    expect(regionRowId(m, two, { showId: "sh", rowId: "s2" })).toBe("s2");
    // Reprise with no usable liveRow (another show, missing, or a video row): never guess.
    expect(regionRowId(m, two, { showId: "other", rowId: "s2" })).toBeNull();
    expect(regionRowId(m, two)).toBeNull();
    expect(regionRowId(m, two, { showId: "sh", rowId: "v" })).toBeNull();
    // The song's only row needs no liveRow.
    expect(regionRowId(stageModeFor({ ...base, songSessions: { program: session } }), show)).toBe("s");
  });

  it("a session naming its row shows that row even when liveRow is on a video", () => {
    const named = { ...session, rowId: "s2", showId: "sh" };
    const m = stageModeFor({ ...base, show: two, songSessions: { program: named } });
    expect(regionRowId(m, two, { showId: "sh", rowId: "v" })).toBe("s2");
    expect(regionRowId(m, two, { showId: "sh", rowId: "s" })).toBe("s2");
    // A session from another show names none of this show's rows.
    const other = stageModeFor({ ...base, show: two, songSessions: { program: { ...named, showId: "other" } } });
    expect(regionRowId(other, two)).toBeNull();
  });

  it("the pinned bar never names a reprise row it can't tell apart", () => {
    const st = { channel: "program", active: null, songSession: session, liveRow: { showId: "sh", rowId: "v" } } as ChannelState;
    expect(pinnedRowId(two, st, "g")).toBeNull();
    expect(pinnedRowId(two, { ...st, liveRow: { showId: "sh", rowId: "s2" } }, "g")).toBe("s2");
  });

  it("is null for quick take, a hotcard or nothing", () => {
    expect(regionRowId(stageModeFor({ ...base, quickTake: true, songSessions: { program: session } }), show)).toBeNull();
    expect(regionRowId(stageModeFor({ ...base, selectedHotcardId: "h1" }), show)).toBeNull();
    expect(regionRowId(stageModeFor(base), show)).toBeNull();
  });
});

describe("pinnedRowId", () => {
  const st = (p: Partial<ChannelState>) => ({ channel: "program", active: null, ...p }) as ChannelState;

  it("pins the program row when it isn't the one shown", () => {
    expect(pinnedRowId(show, st({ songSession: session }), "g")).toBe("s");
    expect(pinnedRowId(show, st({ scriptureSession: { rowId: "x" } as never }), "g")).toBe("x");
    expect(pinnedRowId(show, st({ slidesSession: { rowId: "v" } as never }), null)).toBe("v");
  });

  it("media wins over a song under it", () => {
    expect(pinnedRowId(show, st({ songSession: session, media: { rowId: "v" } as never }), "s")).toBe("v");
  });

  it("nothing pinned when the shown row is the live one, nothing is live, or the row is from another show", () => {
    expect(pinnedRowId(show, st({ songSession: session }), "s")).toBeNull();
    expect(pinnedRowId(show, st({}), "g")).toBeNull();
    expect(pinnedRowId(show, undefined, "g")).toBeNull();
    expect(pinnedRowId(show, st({ scriptureSession: { rowId: "gone" } as never }), "g")).toBeNull();
  });

  it("a song taken from another show is never pinned as this show's row, even its only row", () => {
    expect(pinnedRowId(show, st({ songSession: session, liveRow: { showId: "other", rowId: "s-elsewhere" } }), "g")).toBeNull();
  });
});
