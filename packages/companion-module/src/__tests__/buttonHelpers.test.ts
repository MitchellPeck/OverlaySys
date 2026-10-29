import { describe, expect, it } from "vitest";
import { initialState } from "../types";
import { apply } from "../state";
import { projectVariables, rundownPageVariables, variableDefinitions } from "../variables";
import { rowKindColor } from "../feedbacks";
import { configFields, defaultConfig, rowKindPages } from "../config";

function loaded() {
  let s = apply(initialState(), { type: "song_list", songs: [{ id: "s1", title: "Song A" }] });
  s = apply(s, { type: "local_load_show", showId: "show-1" });
  return apply(s, {
    type: "show",
    show: {
      id: "show-1",
      name: "S",
      rows: [
        { kind: "song", id: "r1", songId: "s1", lyricTemplateId: "lt" },
        { kind: "graphic", id: "r2", templateId: "t", data: { title: "Welcome" }, notes: "Card" },
        { kind: "graphic", id: "r3", templateId: "t", data: { title: "  " }, notes: "Logo" },
        { kind: "scripture", id: "r4", reference: "John 3:16" },
      ],
    },
  } as never);
}

describe("rundown_<n>_label", () => {
  it("uses a graphic's title field, else the row's display label", () => {
    const v = projectVariables(loaded(), []);
    expect(v.rundown_1_label).toBe("Song A");
    expect(v.rundown_2_label).toBe("Welcome");
    expect(v.rundown_3_label).toBe("Logo");
    expect(v.rundown_4_label).toBe("John 3:16");
    expect(v.rundown_5_label).toBe("");
  });

  it("is defined for every rundown slot", () => {
    const ids = new Set(variableDefinitions([]).map((d) => d.variableId));
    expect(ids.has("rundown_1_label")).toBe(true);
    expect(ids.has("rundown_1_page")).toBe(true);
  });
});

describe("rundown_<n>_page", () => {
  it("maps each row's kind to the configured page, blank when unset", () => {
    const pages = rowKindPages({ ...defaultConfig, pageSong: "5", pageScripture: " 7 ", pageGraphic: "" });
    const v = rundownPageVariables(loaded(), pages);
    expect(v.rundown_1_page).toBe("5");
    expect(v.rundown_2_page).toBe("");
    expect(v.rundown_4_page).toBe("7");
    expect(v.rundown_5_page).toBe("");
  });

  it("offers a page field per row kind in the config", () => {
    const ids = configFields().map((f) => f.id);
    for (const k of ["pageSong", "pageGraphic", "pageScripture", "pageVideo", "pageSlides"]) expect(ids).toContain(k);
  });
});

describe("rowKindColor", () => {
  const colors = { song: 1, graphic: 2, scripture: 3, video: 4, slides: 5 };
  it("returns the colour for the kind of the row at the index", () => {
    expect(rowKindColor(loaded(), 1, colors)).toBe(1);
    expect(rowKindColor(loaded(), 2, colors)).toBe(2);
    expect(rowKindColor(loaded(), 4, colors)).toBe(3);
  });
  it("returns undefined past the end or with no show loaded", () => {
    expect(rowKindColor(loaded(), 9, colors)).toBeUndefined();
    expect(rowKindColor(initialState(), 1, colors)).toBeUndefined();
  });
});
