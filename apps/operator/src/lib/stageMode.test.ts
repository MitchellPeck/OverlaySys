import { describe, it, expect } from "vitest";
import type { Show, SongSessionSummary } from "@overlaysys/core";
import { stageModeFor, shortcutHint } from "./stageMode";

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

  // The Quick take toggle is hidden in song mode, so the selection ignores it.
  it("a live song session overrides everything, program first, and carries the selection", () => {
    expect(
      stageModeFor({ ...base, selectedRowId: "g", quickTake: true, songSessions: { preview: session } }),
    ).toEqual({ kind: "song-live", channel: "preview", session, selection: { kind: "graphic", row: show.rows[0] } });
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
    expect(h).toContain("Esc end song");
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

  it("does not claim Enter/Space work for scripture", () => {
    expect(shortcutHint({ kind: "scripture", row: show.rows[2] as never })).toBe(
      "↑/↓ select · Use the slide strip to take · ⌘Enter PVW → PGM · Esc clear program",
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
