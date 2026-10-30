import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as songSession from "./songSession";
import type { Song, DeckLicensing, ResolvedSlide, Template } from "@overlaysys/core";
import * as channels from "./channels";
import * as slidesSession from "./slidesSession";
import { recordSongUse } from "./songUsage";

vi.mock("./songUsage", () => ({ recordSongUse: vi.fn(async () => false) }));

const rs = (position: number, slideId: string, templateId: string, text: string): ResolvedSlide => ({
  key: `${slideId}:${position}`,
  slideId,
  position,
  templateId,
  data: { text },
});
const slides = [rs(0, "a", "T1", "Line A"), rs(1, "b", "T1", "Line B"), rs(2, "c", "T2", "Line C")];
const args = (over: Partial<{ licensing: DeckLicensing | null; slides: ResolvedSlide[] }> = {}) => ({
  showId: "show",
  rowId: "row",
  deckId: "deck",
  title: "Deck",
  slides,
  licensing: null as DeckLicensing | null,
  templates: new Map<string, Template>(),
  ...over,
});

beforeEach(() => {
  channels.take("program", "other", {});
  channels.take("preview", "other", {});
  slidesSession.resetAll();
  vi.mocked(recordSongUse).mockClear();
});

describe("slidesSession", () => {
  it("start renders slide 0, sets summary, liveRow and next", () => {
    expect(slidesSession.start("program", args(), 0)).toBe(true);
    const st = channels.getState("program");
    expect(st.active).toMatchObject({ templateId: "T1", data: { text: "Line A" } });
    expect(st.slidesSession).toMatchObject({
      rowId: "row", slideIdx: 0, slideCount: 3, lines: ["Line A"], nextLines: ["Line B"], atEnd: false, blanked: false,
    });
    expect(st.liveRow).toEqual({ showId: "show", rowId: "row" });
  });

  it("same template advances with update (no remount); a template change remounts", () => {
    slidesSession.start("program", args());
    const t0 = channels.getState("program").active!.takenAt;
    slidesSession.advance("program", 1);
    expect(channels.getState("program").active!.takenAt).toBe(t0);
    expect(channels.getState("program").active!.data.text).toBe("Line B");
    slidesSession.advance("program", 1);
    expect(channels.getState("program").active!.templateId).toBe("T2");
  });

  it("[I3] a same-design advance never carries the previous slide's image/colour over", () => {
    const tpl = {
      id: "T1",
      fields: [
        { key: "text", type: "text", label: "Text", default: "Sample text" },
        { key: "image", type: "image", label: "Image", default: "/design-bg.png" },
        { key: "tint", type: "color", label: "Tint" },
      ],
    } as unknown as Template;
    const two: ResolvedSlide[] = [
      { key: "a:0", slideId: "a", position: 0, templateId: "T1", data: { text: "Line A", image: "/own.png", tint: "#ff0000" } },
      { key: "b:1", slideId: "b", position: 1, templateId: "T1", data: { text: "Line B" } },
    ];
    slidesSession.start("program", { ...args({ slides: two }), templates: new Map([["T1", tpl]]) });
    expect(channels.getState("program").active!.data).toMatchObject({ image: "/own.png", tint: "#ff0000" });
    const t0 = channels.getState("program").active!.takenAt;
    slidesSession.advance("program", 1);
    const a = channels.getState("program").active!;
    expect(a.takenAt).toBe(t0); // still an update, not a remount
    expect(a.data).toEqual({ text: "Line B", image: "/design-bg.png", tint: "" });
  });

  it("Space on the last slide arms end-of-deck, a second Space clears", () => {
    slidesSession.start("program", args(), 2);
    slidesSession.advance("program", 1);
    expect(channels.getState("program").slidesSession!.atEnd).toBe(true);
    expect(channels.getState("program").active!.data.text).toBe("Line C");
    slidesSession.advance("program", 1);
    expect(channels.getState("program").slidesSession).toBeUndefined();
    expect(channels.getState("program").active?.phase).toBe("out");
  });

  it("Shift+Space from the armed end disarms and steps back", () => {
    slidesSession.start("program", args(), 2);
    slidesSession.advance("program", 1);
    slidesSession.advance("program", -1);
    const s = channels.getState("program").slidesSession!;
    expect(s.atEnd).toBe(false);
    expect(s.slideIdx).toBe(1);
    expect(channels.getState("program").active!.data.text).toBe("Line B");
  });

  it("Shift+Space on slide 0 does nothing", () => {
    slidesSession.start("program", args(), 0);
    const t0 = channels.getState("program").active!.takenAt;
    slidesSession.advance("program", -1);
    expect(channels.getState("program").slidesSession!.slideIdx).toBe(0);
    expect(channels.getState("program").active!.takenAt).toBe(t0);
  });

  it("blank toggles: out animation, session kept; again re-shows the same slide", () => {
    slidesSession.start("program", args(), 1);
    slidesSession.blank("program");
    expect(channels.getState("program").active?.phase).toBe("out");
    expect(channels.getState("program").slidesSession).toMatchObject({ blanked: true, slideIdx: 1 });
    slidesSession.blank("program");
    expect(channels.getState("program").active).toMatchObject({ phase: "in", data: { text: "Line B" } });
    expect(channels.getState("program").slidesSession!.blanked).toBe(false);
  });

  it("advance while blanked unblanks onto the next slide", () => {
    slidesSession.start("program", args(), 0);
    slidesSession.blank("program");
    slidesSession.advance("program", 1);
    expect(channels.getState("program").active).toMatchObject({ phase: "in", data: { text: "Line B" } });
    expect(channels.getState("program").slidesSession).toMatchObject({ blanked: false, slideIdx: 1 });
  });

  it("an external take ends the slides session", () => {
    slidesSession.start("program", args());
    channels.take("program", "other", {});
    expect(slidesSession.getSession("program")).toBeNull();
    expect(channels.getState("program").slidesSession).toBeUndefined();
  });

  it("an external clear ends the slides session", () => {
    slidesSession.start("program", args());
    channels.clear("program");
    expect(slidesSession.getSession("program")).toBeNull();
    expect(channels.getState("program").slidesSession).toBeUndefined();
  });

  it("PVW→PGM carries the cursor and ends the preview session", () => {
    slidesSession.start("preview", args(), 1);
    channels.takePvwToPgm("preview", "program");
    expect(channels.getState("program").slidesSession!.slideIdx).toBe(1);
    expect(channels.getState("program").active!.data.text).toBe("Line B");
    expect(slidesSession.getSession("preview")).toBeNull();
    expect(channels.getState("preview").slidesSession).toBeUndefined();
  });

  it("CCLI usage only for ccli decks and never on preview", () => {
    slidesSession.start("program", args({ licensing: { kind: "public-domain" } }));
    expect(recordSongUse).not.toHaveBeenCalled();
    slidesSession.start("preview", args({ licensing: { kind: "ccli", ccliNumber: "1" } }));
    expect(recordSongUse).not.toHaveBeenCalled();
    slidesSession.start("program", args({ licensing: { kind: "ccli", ccliNumber: "1" } }));
    expect(recordSongUse).toHaveBeenCalledWith({ id: "deck", title: "Deck", ccliNumber: "1" }, "program");
  });

  it("start on an empty slide list returns false and leaves the channel alone", () => {
    expect(slidesSession.start("program", args({ slides: [] }))).toBe(false);
    expect(channels.getState("program").slidesSession).toBeUndefined();
    expect(channels.getState("program").active?.templateId).toBe("other");
  });

  it("promoting a graphic over live PGM slides ends the slides session", () => {
    slidesSession.start("program", args(), 1);
    channels.take("preview", "gfx", { a: "1" });
    channels.takePvwToPgm("preview", "program");
    expect(slidesSession.getSession("program")).toBeNull();
    expect(channels.getState("program").slidesSession).toBeUndefined();
    slidesSession.advance("program", 1);
    expect(channels.getState("program").active).toMatchObject({ templateId: "gfx", phase: "in" });
  });

  describe("blanked end", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());
    it("Esc after the out-sweep still emits the dropped session", () => {
      slidesSession.start("program", args(), 0);
      slidesSession.blank("program");
      vi.advanceTimersByTime(2000);
      expect(channels.getState("program").active).toBeNull();
      const seen: Array<unknown> = [];
      const off = channels.subscribe("program", (st) => seen.push(st.slidesSession));
      seen.length = 0;
      channels.clear("program");
      off();
      expect(seen).toContain(undefined);
      expect(seen.length).toBeGreaterThan(0);
    });
    it("second Space at armed end while blanked emits the end", () => {
      slidesSession.start("program", args(), 2);
      slidesSession.advance("program", 1);
      slidesSession.blank("program");
      vi.advanceTimersByTime(2000);
      const seen: Array<unknown> = [];
      const off = channels.subscribe("program", (st) => seen.push(st.slidesSession));
      seen.length = 0;
      slidesSession.advance("program", 1);
      off();
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.at(-1)).toBeUndefined();
    });
  });

  describe("song/slides exclusion", () => {
    const song = {
      id: "s", title: "S", customFields: {}, defaultArrangement: ["v"],
      sections: [{ id: "v", kind: "verse", label: "V", slides: [{ id: "x", lines: ["L"] }] }],
    } as unknown as Song;
    const sargs = { song, lyricTemplateId: "lyr", arrangement: ["v"], trustMode: false };
    it("slides start ends a live song session", () => {
      songSession.start("program", sargs);
      slidesSession.start("program", args());
      expect(songSession.getSession("program")).toBeNull();
      expect(channels.getState("program").songSession).toBeUndefined();
      expect(channels.getState("program").slidesSession).toBeDefined();
    });
    it("song start ends live slides", () => {
      slidesSession.start("program", args());
      songSession.start("program", sargs);
      expect(slidesSession.getSession("program")).toBeNull();
      expect(channels.getState("program").slidesSession).toBeUndefined();
      expect(channels.getState("program").songSession).toBeDefined();
      songSession.endAll();
    });
  });

  describe("auto-advance", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());
    const timed = (holdSecs: (number | undefined)[], loop: boolean) => ({ ...args(), timing: { holdSecs, loop } });
    const idx = (ch = "program") => channels.getState(ch).slidesSession?.slideIdx;

    it("auto-advances on hold and wraps when loop", () => {
      slidesSession.start("program", timed([5, 5, 5], true), 0);
      vi.advanceTimersByTime(4999);
      expect(idx()).toBe(0);
      vi.advanceTimersByTime(1);
      expect(idx()).toBe(1);
      expect(channels.getState("program").active!.data.text).toBe("Line B");
      vi.advanceTimersByTime(5000);
      expect(idx()).toBe(2);
      vi.advanceTimersByTime(5000);
      expect(idx()).toBe(0);
      expect(channels.getState("program").active).toMatchObject({ templateId: "T1", data: { text: "Line A" } });
      expect(channels.getState("program").slidesSession!.atEnd).toBe(false);
    });

    it("non-looping deck stops at the last slide with atEnd", () => {
      slidesSession.start("program", timed([5, 5, 5], false), 0);
      vi.advanceTimersByTime(10000);
      expect(idx()).toBe(2);
      expect(channels.getState("program").slidesSession!.atEnd).toBe(false);
      vi.advanceTimersByTime(5000);
      const st = channels.getState("program");
      expect(st.slidesSession).toMatchObject({ slideIdx: 2, atEnd: true });
      expect(st.slidesSession!.nextAdvanceAt).toBeUndefined();
      expect(st.active).toMatchObject({ phase: "in", data: { text: "Line C" } });
      vi.advanceTimersByTime(60000);
      expect(channels.getState("program").slidesSession).toMatchObject({ slideIdx: 2, atEnd: true });
      expect(channels.getState("program").active!.data.text).toBe("Line C");
    });

    it("a slide without a hold waits for the operator", () => {
      slidesSession.start("program", timed([5, undefined, 5], true), 0);
      vi.advanceTimersByTime(5000);
      expect(idx()).toBe(1);
      expect(channels.getState("program").slidesSession!.nextAdvanceAt).toBeUndefined();
      vi.advanceTimersByTime(60000);
      expect(idx()).toBe(1);
      slidesSession.advance("program", 1);
      expect(idx()).toBe(2);
      vi.advanceTimersByTime(5000);
      expect(idx()).toBe(0);
    });

    it("no timer on preview; promote starts it", () => {
      slidesSession.start("preview", timed([5, 5, 5], true), 1);
      expect(channels.getState("preview").slidesSession!.nextAdvanceAt).toBeUndefined();
      vi.advanceTimersByTime(60000);
      expect(idx("preview")).toBe(1);
      channels.takePvwToPgm("preview", "program");
      const now = Date.now();
      expect(channels.getState("program").slidesSession).toMatchObject({ slideIdx: 1, nextAdvanceAt: now + 5000 });
      vi.advanceTimersByTime(5000);
      expect(idx()).toBe(2);
      expect(channels.getState("program").active!.data.text).toBe("Line C");
    });

    it("dropAll cancels the timer", () => {
      slidesSession.start("program", timed([5, 5, 5], true), 0);
      const before = vi.getTimerCount();
      expect(slidesSession.dropAll("program")).toBe(true);
      expect(vi.getTimerCount()).toBe(before - 1);
      // An external take (which drops the session) leaves the new graphic alone.
      slidesSession.start("program", timed([5, 5, 5], true), 0);
      channels.take("program", "gfx", { a: "1" });
      vi.advanceTimersByTime(60000);
      expect(channels.getState("program").active).toMatchObject({ templateId: "gfx", data: { a: "1" } });
      expect(slidesSession.getSession("program")).toBeNull();
    });

    it("end cancels the timer", () => {
      slidesSession.start("program", timed([5, 5, 5], true), 0);
      slidesSession.end("program");
      vi.advanceTimersByTime(60000);
      expect(slidesSession.getSession("program")).toBeNull();
      expect(channels.getState("program").slidesSession).toBeUndefined();
    });

    it("manual goTo restarts the timer", () => {
      slidesSession.start("program", timed([5, 5, 5], true), 0);
      vi.advanceTimersByTime(3000);
      expect(slidesSession.goTo("program", 2)).toBe(true);
      expect(channels.getState("program").slidesSession!.nextAdvanceAt).toBe(Date.now() + 5000);
      vi.advanceTimersByTime(3000);
      expect(idx()).toBe(2);
      vi.advanceTimersByTime(2000);
      expect(idx()).toBe(0);
    });

    it("manual next/previous restarts the timer; next on the last slide of a looping deck wraps", () => {
      slidesSession.start("program", timed([5, 5, 5], true), 0);
      vi.advanceTimersByTime(4000);
      slidesSession.advance("program", 1);
      vi.advanceTimersByTime(4000);
      expect(idx()).toBe(1);
      slidesSession.advance("program", -1);
      vi.advanceTimersByTime(4000);
      expect(idx()).toBe(0);
      slidesSession.goTo("program", 2);
      slidesSession.advance("program", 1);
      expect(channels.getState("program").slidesSession).toMatchObject({ slideIdx: 0, atEnd: false });
    });

    it("a re-take on the same channel replaces the old timer", () => {
      slidesSession.start("program", timed([5, 5, 5], true), 0);
      vi.advanceTimersByTime(3000);
      slidesSession.start("program", timed([5, 5, 5], true), 0);
      vi.advanceTimersByTime(3000);
      expect(idx()).toBe(0);
      vi.advanceTimersByTime(2000);
      expect(idx()).toBe(1);
    });

    it("blank pauses the timer; unblank restarts the hold", () => {
      slidesSession.start("program", timed([5, 5, 5], true), 0);
      slidesSession.blank("program");
      expect(channels.getState("program").slidesSession!.nextAdvanceAt).toBeUndefined();
      vi.advanceTimersByTime(60000);
      expect(channels.getState("program").slidesSession).toMatchObject({ slideIdx: 0, blanked: true });
      slidesSession.blank("program");
      vi.advanceTimersByTime(5000);
      expect(channels.getState("program").slidesSession).toMatchObject({ slideIdx: 1, blanked: false });
    });

    it("summary carries nextAdvanceAt and loops", () => {
      slidesSession.start("program", timed([5, 8, 5], true), 0);
      const t0 = Date.now();
      expect(channels.getState("program").slidesSession).toMatchObject({
        nextAdvanceAt: t0 + 5000, loops: true, slot: "graphics",
      });
      vi.advanceTimersByTime(5000);
      expect(channels.getState("program").slidesSession).toMatchObject({ slideIdx: 1, nextAdvanceAt: t0 + 13000 });
      expect(slidesSession.getSession("program")).toMatchObject({ nextAdvanceAt: t0 + 13000, loops: true });
    });

    it("autoEnded marks only an auto-advanced end; a manual move or re-take clears it", () => {
      slidesSession.start("program", timed([5, 5, 5], false), 2);
      expect(channels.getState("program").slidesSession!.autoEnded).toBeUndefined();
      vi.advanceTimersByTime(5000);
      expect(channels.getState("program").slidesSession).toMatchObject({ atEnd: true, autoEnded: true });
      slidesSession.advance("program", -1);
      expect(channels.getState("program").slidesSession!.autoEnded).toBeUndefined();
      slidesSession.goTo("program", 2);
      slidesSession.advance("program", 1);
      expect(channels.getState("program").slidesSession).toMatchObject({ atEnd: true });
      expect(channels.getState("program").slidesSession!.autoEnded).toBeUndefined();
      slidesSession.start("program", timed([5, 5, 5], false), 2);
      vi.advanceTimersByTime(5000);
      slidesSession.goTo("program", 2);
      expect(channels.getState("program").slidesSession!.autoEnded).toBeUndefined();
      vi.advanceTimersByTime(5000);
      slidesSession.start("program", timed([5, 5, 5], false), 2);
      expect(channels.getState("program").slidesSession!.autoEnded).toBeUndefined();
    });

    it("a render that throws in the timer stops the timer and keeps the session", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      slidesSession.start("program", timed([5, 5, 5], true), 0);
      const spy = vi.spyOn(channels, "update").mockImplementation(() => {
        throw new Error("boom");
      });
      try {
        vi.advanceTimersByTime(5000);
        expect(spy).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalled();
        expect(slidesSession.getSession("program")).not.toBeNull();
        expect(slidesSession.getSession("program")!.nextAdvanceAt).toBeUndefined();
        vi.advanceTimersByTime(60000);
        expect(spy).toHaveBeenCalledTimes(1);
      } finally {
        spy.mockRestore();
        warn.mockRestore();
      }
    });

    it("a deck without timing never auto-advances and reports no nextAdvanceAt", () => {
      slidesSession.start("program", args(), 0);
      expect(channels.getState("program").slidesSession).toMatchObject({ loops: false, slot: "graphics" });
      expect(channels.getState("program").slidesSession!.nextAdvanceAt).toBeUndefined();
      vi.advanceTimersByTime(600000);
      expect(idx()).toBe(0);
    });
  });

  it("text fields the slide doesn't supply air as \"\" (never the design's sample text), also on advance", () => {
    const lt = {
      id: "LT",
      fields: [
        { key: "header", type: "text", label: "Header", default: "Rev Sample Name" },
        { key: "subtitle", type: "text", label: "Subtitle", default: "Sample title" },
      ],
    } as unknown as Template;
    const only = (position: number, data: Record<string, string>): ResolvedSlide => ({
      key: `k${position}`,
      slideId: `s${position}`,
      position,
      templateId: "LT",
      data,
    });
    slidesSession.start(
      "program",
      { ...args({ slides: [only(0, { subtitle: "Line D" }), only(1, { header: "Line A" })] }), templates: new Map([["LT", lt]]) },
      0,
    );
    expect(channels.getState("program").active?.data).toEqual({ header: "", subtitle: "Line D" });
    slidesSession.advance("program", 1);
    expect(channels.getState("program").active?.data).toMatchObject({ header: "Line A", subtitle: "" });
  });
});
