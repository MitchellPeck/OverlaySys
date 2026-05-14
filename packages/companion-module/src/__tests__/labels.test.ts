import { describe, expect, it } from "vitest";
import { initialState } from "../types";
import {
  rowDisplayLabel,
  sectionDisplayLabel,
  songTitleForChannel,
} from "../labels";
import type { GraphicRow, SongRow, Song } from "@overlaysys/core";

describe("rowDisplayLabel", () => {
  it("returns song title for a song row", () => {
    const state = initialState();
    state.songs = [{ id: "s1", title: "Be Thou My Vision" }];
    const row: SongRow = {
      kind: "song",
      id: "row1",
      songId: "s1",
      lyricTemplateId: "lyric-default",
    };
    expect(rowDisplayLabel(state, row)).toBe("Be Thou My Vision");
  });

  it("returns the song id if title is not yet loaded", () => {
    const state = initialState();
    const row: SongRow = {
      kind: "song",
      id: "row1",
      songId: "unknown",
      lyricTemplateId: "lyric-default",
    };
    expect(rowDisplayLabel(state, row)).toBe("unknown");
  });

  it("returns notes for a graphic row when set", () => {
    const state = initialState();
    const row: GraphicRow = {
      kind: "graphic",
      id: "row1",
      templateId: "tpl-1",
      data: { title: "Welcome" },
      notes: "Opening title",
    };
    expect(rowDisplayLabel(state, row)).toBe("Opening title");
  });

  it("falls back to template name for graphic row without notes", () => {
    const state = initialState();
    state.templates = [
      { id: "tpl-1", name: "Lower Third", size: { w: 1920, h: 1080 } },
    ];
    const row: GraphicRow = {
      kind: "graphic",
      id: "row1",
      templateId: "tpl-1",
      data: { title: "Welcome" },
    };
    expect(rowDisplayLabel(state, row)).toBe("Lower Third");
  });

  it("falls back to templateId when template meta is missing", () => {
    const state = initialState();
    const row: GraphicRow = {
      kind: "graphic",
      id: "row1",
      templateId: "tpl-x",
      data: {},
    };
    expect(rowDisplayLabel(state, row)).toBe("tpl-x");
  });
});

describe("sectionDisplayLabel", () => {
  const song: Song = {
    id: "s1",
    title: "Test",
    sections: [
      {
        id: "sec1",
        kind: "verse",
        label: "Verse 1",
        slides: [{ id: "sl1", text: "line one" }],
      },
      {
        id: "sec2",
        kind: "chorus",
        label: "Chorus",
        slides: [{ id: "sl2", text: "chorus line" }],
      },
    ],
    defaultArrangement: ["sec1", "sec2"],
  };

  it("returns the label for the section at the cursor", () => {
    expect(sectionDisplayLabel(song, ["sec1", "sec2", "sec1"], 1)).toBe(
      "Chorus",
    );
  });

  it("returns empty string when sectionIdx is out of range", () => {
    expect(sectionDisplayLabel(song, ["sec1"], 5)).toBe("");
  });

  it("returns empty string when section id is unknown", () => {
    expect(sectionDisplayLabel(song, ["nope"], 0)).toBe("");
  });
});

describe("songTitleForChannel", () => {
  it("returns title when songSession.songId is in cache", () => {
    const state = initialState();
    state.songs = [{ id: "s1", title: "Amazing Grace" }];
    state.channelStates.set("program", {
      channel: "program",
      active: null,
      songSession: {
        songId: "s1",
        lyricTemplateId: "lt",
        arrangement: ["sec1"],
        cursor: { sectionIdx: 0, slideIdx: 0 },
        blanked: false,
        trustMode: false,
        startedAt: 0,
      },
    });
    expect(songTitleForChannel(state, "program")).toBe("Amazing Grace");
  });

  it("returns empty when no songSession", () => {
    const state = initialState();
    state.channelStates.set("program", {
      channel: "program",
      active: null,
    });
    expect(songTitleForChannel(state, "program")).toBe("");
  });
});
