import { describe, expect, it } from "vitest";
import type { Show } from "@overlaysys/core";
import type { AirState } from "../../../lib/rowAirState";
import {
  doubleClickAction,
  rowCanFire,
  dropHalf,
  headerLine,
  liveRowState,
  liveRowSurface,
  nudgeTarget,
  slidesTakeable,
  takeableNextRowId,
} from "./rundownModel";

const row = (id: string, sectionId?: string, lengthSec?: number) =>
  ({ kind: "graphic", id, templateId: "t", data: {}, sectionId, lengthSec }) as never;
const showWith = (o: object): Show =>
  ({ id: "s", name: "Sunday", projectId: "p", songs: [], rows: [], ...o }) as unknown as Show;

describe("takeableNextRowId", () => {
  const rows = [row("r1"), row("r2"), row("r3"), row("r4")];
  const air = (o: Record<string, AirState>) => o;
  it("keeps liveNext's answer when that row can be taken", () => {
    expect(takeableNextRowId(rows, air({ r1: "program" }), "r1", () => true)).toBe("r2");
  });
  it("skips a row that can't be taken to the next takeable one", () => {
    expect(takeableNextRowId(rows, air({ r1: "program" }), "r1", (id) => id !== "r2")).toBe("r3");
  });
  it("skips an unsupported selection too", () => {
    expect(takeableNextRowId(rows, air({}), "r2", (id) => id === "r4")).toBe("r4");
  });
  it("never offers a row already on program", () => {
    expect(takeableNextRowId(rows, air({ r3: "program" }), "r2", (id) => id === "r3")).toBe(null);
  });
  it("is null when nothing after can be taken", () => {
    expect(takeableNextRowId(rows, air({ r1: "program" }), "r1", () => false)).toBe(null);
  });
});

describe("liveRowState", () => {
  const base = { air: null as AirState, isNext: false, selected: false, canCue: true };
  it("offers Take only on the next row", () => {
    expect(liveRowState({ ...base, isNext: true }).showTake).toBe(true);
    expect(liveRowState({ ...base, selected: true }).showTake).toBe(false);
  });
  it("offers Cue on the selected row when it isn't on air", () => {
    expect(liveRowState({ ...base, selected: true }).showCue).toBe(true);
    expect(liveRowState({ ...base, selected: true, air: "program" }).showCue).toBe(false);
    expect(liveRowState({ ...base, selected: true, air: "preview" }).showCue).toBe(false);
    expect(liveRowState({ ...base, selected: true, canCue: false }).showCue).toBe(false);
    expect(liveRowState({ ...base, selected: false }).showCue).toBe(false);
  });
  it("marks on air, cued and other-show", () => {
    expect(liveRowState({ ...base, air: "program" }).chip).toBe("onair");
    expect(liveRowState({ ...base, air: "preview" }).chip).toBe("cued");
    const other = liveRowState({ ...base, air: "other-show" });
    expect(other.chip).toBe(null);
    expect(other.otherShow).toBe(true);
    expect(other.tooltip).toBe("On air in another show");
  });
  it("a row on program is never next", () => {
    expect(liveRowState({ ...base, air: "program", isNext: true }).showTake).toBe(false);
  });
});

describe("liveRowSurface", () => {
  it("on air: red inset and tint", () => {
    expect(liveRowSurface({ air: "program", next: false, selected: false })).toEqual({
      boxShadow: "inset 3px 0 0 var(--onair)",
      background: "rgba(229,72,77,0.10)",
    });
  });
  it("next: green inset; selected: control background", () => {
    expect(liveRowSurface({ air: null, next: true, selected: true })).toEqual({
      boxShadow: "inset 3px 0 0 var(--ok)",
      background: "var(--control)",
    });
  });
  it("plain row has no inset", () => {
    expect(liveRowSurface({ air: null, next: false, selected: false })).toEqual({
      boxShadow: "none",
      background: "transparent",
    });
  });
});

describe("dropHalf", () => {
  it("splits at the middle", () => {
    expect(dropHalf(5, 40)).toBe("before");
    expect(dropHalf(25, 40)).toBe("after");
  });
});

describe("headerLine", () => {
  it("names the show, counts items and totals the length", () => {
    expect(headerLine(showWith({ rows: [row("a", undefined, 60), row("b", undefined, 90)] }))).toBe(
      "Sunday · 2 items · Total 2:30",
    );
  });
  it("one item, no lengths", () => {
    expect(headerLine(showWith({ rows: [row("a")] }))).toBe("Sunday · 1 item");
  });
});

describe("nudgeTarget", () => {
  const show = showWith({
    sections: [{ id: "a", name: "A" }, { id: "b", name: "B" }],
    rows: [row("1", "a"), row("2", "a"), row("3", "b")],
  });
  it("moves within a section", () => {
    expect(nudgeTarget(show, "2", -1)).toEqual({ toSectionId: "a", toIndex: 0 });
  });
  it("crosses into the next section", () => {
    expect(nudgeTarget(show, "2", 1)).toEqual({ toSectionId: "b", toIndex: 0 });
  });
  it("is null at the very top", () => {
    expect(nudgeTarget(show, "1", -1)).toBe(null);
  });
});

describe("doubleClickAction (D4)", () => {
  const base = { takes: false, air: null as AirState, canTake: true, canCue: true };
  it("cues by default, never takes", () => expect(doubleClickAction(base)).toBe("cue"));
  it("takes only with the setting on", () => expect(doubleClickAction({ ...base, takes: true })).toBe("take"));
  it("a row with no Cue (video) does nothing by default", () =>
    expect(doubleClickAction({ ...base, canCue: false })).toBeNull());
  it("never re-takes a row already on program (a song would restart)", () =>
    expect(doubleClickAction({ ...base, takes: true, air: "program" })).toBeNull());
  it("a row that can't be taken does nothing", () =>
    expect(doubleClickAction({ ...base, takes: true, canTake: false })).toBeNull());
});

describe("rowCanFire (keys and buttons agree)", () => {
  const ok = { supported: true };
  const sv = (o: object) => ({ title: "D", detail: "", slides: [{}], missingDeck: false, missingSlides: 0, licensing: null, ...o }) as never;
  it("graphic / song / video take when supported; never when unsupported", () => {
    expect(rowCanFire(row("g"), "take", ok)).toBe(true);
    expect(rowCanFire({ kind: "song", id: "s" } as never, "take", ok)).toBe(true);
    expect(rowCanFire(row("g"), "take", { supported: false })).toBe(false);
  });
  it("video has no cue", () => {
    expect(rowCanFire({ kind: "video", id: "v" } as never, "take", ok)).toBe(true);
    expect(rowCanFire({ kind: "video", id: "v" } as never, "cue", ok)).toBe(false);
  });
  it("scripture needs slides", () => {
    expect(rowCanFire({ kind: "scripture", id: "x", slides: [] } as never, "cue", ok)).toBe(false);
    expect(rowCanFire({ kind: "scripture", id: "x", slides: [{}] } as never, "take", ok)).toBe(true);
  });
  it("slides need a loaded deck with slides", () => {
    const s = { kind: "slides", id: "s" } as never;
    expect(rowCanFire(s, "take", { supported: true, slidesView: sv({}) })).toBe(true);
    expect(rowCanFire(s, "cue", { supported: true, slidesView: sv({ missingDeck: true, slides: [] }) })).toBe(false);
    expect(rowCanFire(s, "take", { supported: true, slidesView: null })).toBe(false);
  });
  it("unknown kinds never fire", () => expect(rowCanFire({ kind: "mystery", id: "m" } as never, "take", ok)).toBe(false));
});

describe("slidesTakeable", () => {
  const v = (o: object) => ({ title: "Deck", detail: "", slides: [{}], missingDeck: false, missingSlides: 0, licensing: null, ...o }) as never;
  it("a loaded deck with slides can be taken, even with some slides missing", () => {
    expect(slidesTakeable(v({}))).toBe(true);
    expect(slidesTakeable(v({ missingSlides: 2 }))).toBe(true);
  });
  it("a missing deck, a deck still loading (no slides) or no view can't", () => {
    expect(slidesTakeable(v({ missingDeck: true, slides: [] }))).toBe(false);
    expect(slidesTakeable(v({ slides: [] }))).toBe(false);
    expect(slidesTakeable(null)).toBe(false);
  });
  it("the next row skips a missing-deck slides row", () => {
    const rows = [row("r1"), { kind: "slides", id: "s1" } as never, row("r3")];
    const views: Record<string, unknown> = { s1: v({ missingDeck: true, slides: [] }) };
    const canTake = (id: string) => (id in views ? slidesTakeable(views[id] as never) : true);
    expect(takeableNextRowId(rows, { r1: "program" }, "r1", canTake)).toBe("r3");
  });
});
