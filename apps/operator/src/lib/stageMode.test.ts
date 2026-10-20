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

  it("a live song session overrides everything, program first", () => {
    expect(
      stageModeFor({ ...base, selectedRowId: "g", quickTake: true, songSessions: { preview: session } }),
    ).toEqual({ kind: "song-live", channel: "preview", session });
    expect(
      stageModeFor({ ...base, songSessions: { program: session, preview: { ...session, songId: "other" } } }),
    ).toEqual({ kind: "song-live", channel: "program", session });
  });

  it("treats a null session entry as no session", () => {
    expect(stageModeFor({ ...base, songSessions: { program: null } })).toEqual({ kind: "empty" });
  });
});

describe("shortcutHint", () => {
  it("describes song-mode keys while a song is live", () => {
    const h = shortcutHint({ kind: "song-live", channel: "program", session });
    expect(h).toContain("Space next");
    expect(h).toContain("Esc end song");
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
