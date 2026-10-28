import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScriptureRow, Song } from "@overlaysys/core";
import * as channels from "./channels";
import * as scriptureSession from "./scriptureSession";
import * as songSession from "./songSession";
import * as fums from "./apiBible/fums";
import * as templates from "./templates";

// CCLI usage logging writes to the data dir; keep tests off disk.
vi.mock("./songUsage", () => ({ recordSongUse: vi.fn(async () => false) }));

const CH = "program";
const v = (verse: number, text: string) => ({ book: "JHN", chapter: 3, verse, text });
const row: ScriptureRow = {
  kind: "scripture",
  id: "row-s",
  reference: "John 3:16-18",
  translation: "KJV",
  templateId: "body",
  slides: [
    { id: "slide-0", verses: [v(16, "For God")] },
    { id: "slide-1", verses: [v(17, "For God sent")] },
    { id: "slide-2", verses: [v(18, "He that")] },
  ],
} as ScriptureRow;
const intro = { templateId: "intro-tpl", fieldValues: { title: "John 3:16-18" } };
const song: Song = {
  id: "song", title: "Song", customFields: {}, defaultArrangement: ["v"],
  sections: [{ id: "v", kind: "verse", label: "Verse 1", slides: [{ id: "s", lines: ["L"] }] }],
} as Song;

beforeEach(() => {
  songSession.endAll();
  songSession.clearQueued(CH);
  scriptureSession.resetAll();
  channels.take(CH, "other", {});
});

describe("scriptureSession", () => {
  it("intro goes on air with context and queues the row", () => {
    scriptureSession.takeIntro(CH, "show", row, intro);
    const s = channels.getState(CH);
    expect(s.active?.templateId).toBe("intro-tpl");
    expect(s.active?.scriptureContext).toEqual({ rowId: "row-s", sub: "intro" });
    expect(s.queuedScripture).toEqual({ rowId: "row-s", reference: "John 3:16-18" });
    expect(s.scriptureSession).toBeUndefined();
  });

  it("scripture intro and slide takes set the channel liveRow", () => {
    scriptureSession.takeIntro(CH, "show", row, intro);
    expect(channels.getState(CH).liveRow).toEqual({ showId: "show", rowId: "row-s" });
    scriptureSession.takeSlide(CH, "show", row, 1);
    expect(channels.getState(CH).liveRow).toEqual({ showId: "show", rowId: "row-s" });
  });

  it("Next after an intro starts the queued row at slide 1 in one take", () => {
    scriptureSession.takeIntro(CH, "show", row, intro);
    const takes = vi.spyOn(channels, "take");
    scriptureSession.advance(CH, 1);
    expect(takes).toHaveBeenCalledTimes(1);
    takes.mockRestore();
    const s = channels.getState(CH);
    expect(s.active?.templateId).toBe("body");
    expect(s.active?.data).toMatchObject({ text: "For God", reference: "John 3:16", translation: "KJV" });
    expect(s.active?.scriptureContext).toEqual({ rowId: "row-s", sub: "slide", slideIdx: 0 });
    expect(s.scriptureSession).toMatchObject({ rowId: "row-s", slideIdx: 0, slideCount: 3, slideReference: "John 3:16" });
    expect(s.queuedScripture).toBeUndefined();
  });

  it("goTo after an intro starts at that slide", () => {
    scriptureSession.takeIntro(CH, "show", row, intro);
    scriptureSession.goTo(CH, 2);
    expect(channels.getState(CH).scriptureSession?.slideIdx).toBe(2);
  });

  it("Previous with only a queue does nothing", () => {
    scriptureSession.takeIntro(CH, "show", row, intro);
    scriptureSession.advance(CH, -1);
    const s = channels.getState(CH);
    expect(s.active?.templateId).toBe("intro-tpl");
    expect(s.queuedScripture?.rowId).toBe("row-s");
  });

  it("Next / Previous move within bounds and stop at the ends", () => {
    scriptureSession.takeSlide(CH, "show", row, 0);
    scriptureSession.advance(CH, -1);
    expect(channels.getState(CH).scriptureSession?.slideIdx).toBe(0);
    scriptureSession.advance(CH, 1);
    scriptureSession.advance(CH, 1);
    scriptureSession.advance(CH, 1);
    expect(channels.getState(CH).scriptureSession?.slideIdx).toBe(2);
  });

  it("goTo out of range is a no-op (Review Focus 2)", () => {
    scriptureSession.takeSlide(CH, "show", row, 1);
    expect(() => scriptureSession.goTo(CH, 11)).not.toThrow();
    expect(channels.getState(CH).scriptureSession?.slideIdx).toBe(1);
    expect(scriptureSession.takeSlide(CH, "show", row, 9)).toBe(false);
  });

  it("Next with nothing live or queued is a no-op (Review Focus 5)", () => {
    scriptureSession.advance(CH, 1);
    const s = channels.getState(CH);
    expect(s.active?.templateId).toBe("other");
    expect(s.scriptureSession).toBeUndefined();
  });

  it("end with only a queue cancels it and leaves the intro up", () => {
    scriptureSession.takeIntro(CH, "show", row, intro);
    scriptureSession.end(CH);
    const s = channels.getState(CH);
    expect(s.queuedScripture).toBeUndefined();
    expect(s.active?.templateId).toBe("intro-tpl");
    expect(s.active?.phase).toBe("in");
  });

  it("end with a live session clears the channel and the session", () => {
    scriptureSession.takeSlide(CH, "show", row, 0);
    scriptureSession.end(CH);
    const s = channels.getState(CH);
    expect(s.scriptureSession).toBeUndefined();
    expect(s.active?.phase).toBe("out");
  });

  it("an external take or operator clear drops session and queue", () => {
    scriptureSession.takeIntro(CH, "show", row, intro);
    channels.take(CH, "lower-third", {});
    expect(channels.getState(CH).queuedScripture).toBeUndefined();
    scriptureSession.takeSlide(CH, "show", row, 0);
    channels.clear(CH);
    expect(channels.getState(CH).scriptureSession).toBeUndefined();
    expect(scriptureSession.getLive(CH)).toBeUndefined();
  });

  it("an auto-out clear keeps the queue", () => {
    scriptureSession.takeIntro(CH, "show", row, intro);
    channels.clear(CH, { keepQueuedSong: true });
    expect(channels.getState(CH).queuedScripture?.rowId).toBe("row-s");
    expect(scriptureSession.getQueued(CH)).toBeDefined();
  });

  it("PVW→PGM of a scripture intro carries the queue to program", () => {
    scriptureSession.takeIntro("preview", "show", row, intro);
    channels.takePvwToPgm("preview", CH);
    expect(channels.getState(CH).queuedScripture?.rowId).toBe("row-s");
    expect(channels.getState(CH).active?.scriptureContext).toEqual({ rowId: "row-s", sub: "intro" });
    expect(channels.getState("preview").queuedScripture).toBeUndefined();
    scriptureSession.advance(CH, 1);
    expect(channels.getState(CH).scriptureSession?.slideIdx).toBe(0);
  });

  it("a scripture intro ends a live song on that channel (Review Focus 3)", () => {
    songSession.start(CH, { song, lyricTemplateId: "lyric", arrangement: ["v"], trustMode: false });
    scriptureSession.takeIntro(CH, "show", row, intro);
    const s = channels.getState(CH);
    expect(s.songSession).toBeUndefined();
    expect(s.queuedScripture?.rowId).toBe("row-s");
  });

  it("starting a song ends live scripture on that channel", () => {
    scriptureSession.takeSlide(CH, "show", row, 0);
    songSession.start(CH, { song, lyricTemplateId: "lyric", arrangement: ["v"], trustMode: false });
    expect(channels.getState(CH).scriptureSession).toBeUndefined();
    expect(scriptureSession.getLive(CH)).toBeUndefined();
  });

  it("an operator clear drops the queued scripture", () => {
    scriptureSession.takeIntro(CH, "show", row, intro);
    channels.clear(CH);
    expect(channels.getState(CH).queuedScripture).toBeUndefined();
    expect(scriptureSession.getQueued(CH)).toBeUndefined();
  });

  it("promoting a plain graphic to program ends live scripture there", () => {
    scriptureSession.takeSlide(CH, "show", row, 0);
    channels.take("preview", "lower-third", {});
    channels.takePvwToPgm("preview", CH);
    expect(channels.getState(CH).scriptureSession).toBeUndefined();
    expect(scriptureSession.getLive(CH)).toBeUndefined();
  });

  it("promoting a non-intro graphic to program drops program's queued scripture", () => {
    scriptureSession.takeIntro(CH, "show", row, intro);
    channels.take("preview", "lower-third", {});
    channels.takePvwToPgm("preview", CH);
    expect(channels.getState(CH).queuedScripture).toBeUndefined();
    expect(scriptureSession.getQueued(CH)).toBeUndefined();
  });

  it("reports api.bible usage on slide takes", () => {
    const spy = vi.spyOn(fums, "reportViews").mockResolvedValue();
    const niv = { ...row, source: { provider: "api.bible", bibleId: "B", fetchedAt: "x", usageTokens: ["t1"] } } as ScriptureRow;
    scriptureSession.takeSlide(CH, "show", niv, 0);
    expect(spy).toHaveBeenCalledWith(["t1"]);
    spy.mockRestore();
  });

  describe("auto-out", () => {
    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });
    const mockAutoOut = () =>
      vi.spyOn(templates, "getTemplate").mockImplementation(
        async (id: string) => ({ id, autoOutMs: 1 }) as Awaited<ReturnType<typeof templates.getTemplate>>,
      );

    it("a slide template with autoOutMs does not end the scripture session", async () => {
      vi.useFakeTimers();
      mockAutoOut();
      scriptureSession.takeSlide(CH, "show", row, 0);
      await vi.advanceTimersByTimeAsync(50);
      expect(scriptureSession.getLive(CH)).toBeDefined();
      const s = channels.getState(CH);
      expect(s.scriptureSession).toBeDefined();
      expect(s.active?.phase).toBe("in");
    });

    it("an intro template with autoOutMs still auto-outs but keeps the queue", async () => {
      vi.useFakeTimers();
      mockAutoOut();
      scriptureSession.takeIntro(CH, "show", row, intro);
      await vi.advanceTimersByTimeAsync(50);
      const s = channels.getState(CH);
      expect(s.active?.phase).not.toBe("in");
      expect(s.queuedScripture).toEqual({ rowId: "row-s", reference: "John 3:16-18" });
    });
  });
});
