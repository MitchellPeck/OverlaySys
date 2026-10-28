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
});
