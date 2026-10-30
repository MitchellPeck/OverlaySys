import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Deck, LiveFolderFile } from "@overlaysys/core";

// Injected live-folder source: tests set the folder's settled files and fire changes.
const folder = vi.hoisted(() => ({
  files: new Map<string, LiveFolderFile[]>(),
  listeners: new Set<(id: string, files: LiveFolderFile[]) => void>(),
}));
vi.mock("./liveFolders", () => ({
  listLiveFolderFiles: (id: string) => folder.files.get(id) ?? [],
  onLiveFolderChange: (cb: (id: string, files: LiveFolderFile[]) => void) => {
    folder.listeners.add(cb);
    return () => folder.listeners.delete(cb);
  },
}));
vi.mock("./songUsage", () => ({ recordSongUse: vi.fn(async () => false) }));

import * as channels from "./channels";
import * as mediaDeckSession from "./mediaDeckSession";
import * as slidesSession from "./slidesSession";
import { rowsOnAir } from "./itemEnd";

const EMPTY = "This folder has no photos or videos yet.";

const img = (name: string): LiveFolderFile => ({ name, mediaType: "image", size: 1, mtimeMs: 1 });
const vid = (name: string): LiveFolderFile => ({ name, mediaType: "video", size: 1, mtimeMs: 1 });

function setFolder(id: string, files: LiveFolderFile[]): void {
  folder.files.set(id, files);
  for (const cb of folder.listeners) cb(id, files);
}

const mediaSlide = (id: string, mediaType: "image" | "video", over: Partial<Deck["slides"][number]> = {}) => ({
  id,
  data: {},
  media: { assetUrl: `/assets/${id}.${mediaType === "image" ? "png" : "mp4"}`, mediaType },
  ...over,
});

const deck = (over: Partial<Deck> = {}): Deck => ({
  id: "deck1",
  name: "Announcements",
  tags: [],
  defaultTemplateId: "t",
  licensing: { kind: "own" },
  slides: [mediaSlide("a", "image"), mediaSlide("b", "image"), mediaSlide("c", "image")],
  createdAt: "2026-10-30T00:00:00.000Z",
  defaultHoldSec: 5,
  loop: true,
  ...over,
});

const folderDeck = (over: Partial<Deck> = {}): Deck =>
  deck({ slides: [], liveFolderId: "lf1", folderOrder: [], defaultHoldSec: 5, loop: true, ...over });

const onAir = (channel = "program") => channels.getState(channel).media?.assetUrl;
const sec = (n: number) => vi.advanceTimersByTime(n * 1000);

function reportEnded(channel = "program"): void {
  const m = channels.getState(channel).media!;
  channels.mediaStatus(channel, m.takenAt, { status: "ended", currentTime: 10, duration: 10 });
}

function reportError(channel = "program"): void {
  const m = channels.getState(channel).media!;
  channels.mediaStatus(channel, m.takenAt, { status: "error", currentTime: 0, duration: 0, error: "decode failed" });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-30T12:00:00.000Z"));
  mediaDeckSession.resetAll();
  slidesSession.resetAll();
  folder.files.clear();
  for (const ch of ["program", "preview"]) {
    channels.mediaClear(ch);
    channels.setSlidesSessionSummary(ch, null);
    channels.setActiveNull(ch);
  }
});

afterEach(() => {
  mediaDeckSession.resetAll();
  vi.useRealTimers();
});

describe("mediaDeckForRow", () => {
  const row = (over: Record<string, unknown> = {}) => ({ kind: "slides" as const, id: "row", deckId: "deck1", ...over });

  it("a media-only deck honours the row's slide selection, repeats included", () => {
    const d = mediaDeckSession.mediaDeckForRow(row({ slideIds: ["c", "a", "gone", "c"] }), deck());
    expect(d?.slides.map((s) => s.id)).toEqual(["c", "a", "c"]);
    expect(d).toMatchObject({ id: "deck1", defaultHoldSec: 5, loop: true });
  });

  it("one-off local slides play as a media deck when they are all media", () => {
    const d = mediaDeckSession.mediaDeckForRow(
      row({ deckId: undefined, localSlides: [mediaSlide("x", "image"), mediaSlide("y", "image")], slideIds: ["y"] }),
      null,
    );
    expect(d?.slides.map((s) => s.id)).toEqual(["y"]);
    expect(d?.id).toBe("");
  });

  it("a live-folder deck ignores the row's selection and local slides", () => {
    const fd = folderDeck();
    expect(mediaDeckSession.mediaDeckForRow(row({ slideIds: ["a"], localSlides: [mediaSlide("x", "image")] }), fd)).toBe(fd);
  });

  it("template slides, or a selection that leaves nothing, are not a media deck", () => {
    const mixed = deck({ slides: [mediaSlide("a", "image"), { id: "t", data: { text: "Hi" } }] });
    expect(mediaDeckSession.mediaDeckForRow(row(), mixed)).toBeNull();
    expect(mediaDeckSession.mediaDeckForRow(row({ slideIds: ["a"] }), mixed)?.slides.map((s) => s.id)).toEqual(["a"]);
    expect(mediaDeckSession.mediaDeckForRow(row({ slideIds: ["gone"] }), deck())).toBeNull();
    expect(mediaDeckSession.mediaDeckForRow(row(), null)).toBeNull();
  });

  it("a one-off media deck's summary has no deck id", () => {
    const d = mediaDeckSession.mediaDeckForRow(row({ deckId: undefined, localSlides: [mediaSlide("x", "image")] }), null)!;
    mediaDeckSession.start("program", { rowId: "row", deck: d });
    expect(mediaDeckSession.summary("program")?.deckId).toBeUndefined();
  });
});

describe("mediaDeckSession", () => {
  it("advances images on their hold and wraps when looping", () => {
    expect(mediaDeckSession.start("program", { rowId: "r1", showId: "s1", deck: deck() })).toEqual({ ok: true });
    expect(onAir()).toBe("/assets/a.png");
    expect(channels.getState("program").media).toMatchObject({ mediaType: "image", owner: "mediaDeck:r1", rowId: "r1" });
    expect(channels.getState("program").slidesSession).toMatchObject({
      rowId: "r1", deckId: "deck1", slideIdx: 0, slideCount: 3, slot: "media", loops: true, atEnd: false,
      nextAdvanceAt: Date.now() + 5000,
    });
    sec(4.9);
    expect(onAir()).toBe("/assets/a.png");
    sec(0.1);
    expect(onAir()).toBe("/assets/b.png");
    sec(5);
    expect(onAir()).toBe("/assets/c.png");
    sec(5);
    expect(onAir()).toBe("/assets/a.png");
    expect(mediaDeckSession.summary("program")).toMatchObject({ slideIdx: 0, atEnd: false });
  });

  it("uses a slide's own hold before the deck's default", () => {
    const d = deck({ slides: [mediaSlide("a", "image", { holdSec: 2 }), mediaSlide("b", "image")] });
    mediaDeckSession.start("program", { rowId: "r1", deck: d });
    sec(2);
    expect(onAir()).toBe("/assets/b.png");
  });

  it("an image with no hold does not advance", () => {
    mediaDeckSession.start("program", { rowId: "r1", deck: deck({ defaultHoldSec: undefined }) });
    expect(mediaDeckSession.summary("program")?.nextAdvanceAt).toBeUndefined();
    sec(600);
    expect(onAir()).toBe("/assets/a.png");
  });

  it("non-looping deck holds the last slide and reports atEnd", () => {
    mediaDeckSession.start("program", { rowId: "r1", deck: deck({ loop: false }) });
    sec(10);
    expect(onAir()).toBe("/assets/c.png");
    expect(mediaDeckSession.summary("program")?.atEnd).toBe(false);
    sec(5);
    expect(onAir()).toBe("/assets/c.png");
    const st = channels.getState("program");
    expect(st.slidesSession).toMatchObject({ slideIdx: 2, atEnd: true, slot: "media" });
    expect(st.slidesSession?.nextAdvanceAt).toBeUndefined();
    // Item-end tracking treats a finished media deck as ended.
    expect(rowsOnAir(st, null).has("r1")).toBe(false);
    sec(60);
    expect(onAir()).toBe("/assets/c.png");
  });

  it("a running media deck counts as on air", () => {
    mediaDeckSession.start("program", { rowId: "r1", deck: deck() });
    expect(rowsOnAir(channels.getState("program"), null).has("r1")).toBe(true);
  });

  it("video with advanceOnEnd advances on ended, not on a timer", () => {
    const d = deck({ slides: [mediaSlide("v", "video"), mediaSlide("b", "image")] });
    mediaDeckSession.start("program", { rowId: "r1", deck: d });
    expect(channels.getState("program").media).toMatchObject({ mediaType: "video", endAction: "hold", loop: false });
    expect(mediaDeckSession.summary("program")?.nextAdvanceAt).toBeUndefined();
    sec(120);
    expect(onAir()).toBe("/assets/v.mp4");
    reportEnded();
    expect(onAir()).toBe("/assets/b.png");
    expect(mediaDeckSession.summary("program")).toMatchObject({ slideIdx: 1 });
  });

  it("a late ended from an earlier slide does not advance", () => {
    const d = deck({ slides: [mediaSlide("v", "video"), mediaSlide("b", "image"), mediaSlide("c", "image")] });
    mediaDeckSession.start("program", { rowId: "r1", deck: d });
    const oldTakenAt = channels.getState("program").media!.takenAt;
    mediaDeckSession.step("program", 1);
    channels.mediaStatus("program", oldTakenAt, { status: "ended", currentTime: 1, duration: 1 });
    expect(onAir()).toBe("/assets/b.png");
  });

  it("a video without advanceOnEnd advances on its hold", () => {
    const d = deck({ slides: [mediaSlide("v", "video", { advanceOnEnd: false, holdSec: 3 }), mediaSlide("b", "image")] });
    mediaDeckSession.start("program", { rowId: "r1", deck: d });
    reportEnded();
    expect(onAir()).toBe("/assets/v.mp4");
    sec(3);
    expect(onAir()).toBe("/assets/b.png");
  });

  it("preview take does not start the timer; promote starts it from the current slide", () => {
    mediaDeckSession.start("preview", { rowId: "r1", showId: "s1", deck: deck(), slideIdx: 1 });
    expect(onAir("preview")).toBe("/assets/b.png");
    expect(mediaDeckSession.summary("preview")?.nextAdvanceAt).toBeUndefined();
    sec(60);
    expect(onAir("preview")).toBe("/assets/b.png");

    channels.takePvwToPgm("preview", "program");
    expect(onAir("program")).toBe("/assets/b.png");
    expect(channels.getState("program").liveRow).toEqual({ showId: "s1", rowId: "r1" });
    expect(mediaDeckSession.summary("program")).toMatchObject({ slideIdx: 1, nextAdvanceAt: Date.now() + 5000 });
    expect(mediaDeckSession.summary("preview")).toBeNull();
    expect(channels.getState("preview").media).toBeNull();
    sec(5);
    expect(onAir("program")).toBe("/assets/c.png");
  });

  it("manual step restarts the hold timer", () => {
    mediaDeckSession.start("program", { rowId: "r1", deck: deck() });
    sec(4);
    mediaDeckSession.step("program", 1);
    expect(onAir()).toBe("/assets/b.png");
    expect(mediaDeckSession.summary("program")?.nextAdvanceAt).toBe(Date.now() + 5000);
    sec(4);
    expect(onAir()).toBe("/assets/b.png");
    sec(1);
    expect(onAir()).toBe("/assets/c.png");
    mediaDeckSession.step("program", -1);
    expect(onAir()).toBe("/assets/b.png");
    expect(mediaDeckSession.goTo("program", 0)).toBe(true);
    expect(onAir()).toBe("/assets/a.png");
    expect(mediaDeckSession.goTo("program", 7)).toBe(false);
  });

  it("graphics take leaves the loop running", () => {
    mediaDeckSession.start("program", { rowId: "r1", deck: deck() });
    channels.take("program", "lower-third", { name: "Pastor" });
    channels.clear("program");
    sec(5);
    expect(onAir()).toBe("/assets/b.png");
    expect(channels.getState("program").slidesSession).toMatchObject({ rowId: "r1", slot: "media" });
  });

  it("a template deck over the loop owns the summary until it ends, and the loop keeps running", () => {
    mediaDeckSession.start("program", { rowId: "r1", deck: deck() });
    slidesSession.start("program", {
      showId: "s1", rowId: "tpl", title: "Words", licensing: null, templates: new Map(),
      slides: [{ key: "x:0", slideId: "x", position: 0, templateId: "T1", data: { text: "Hi" } }],
    });
    sec(5);
    expect(onAir()).toBe("/assets/b.png");
    expect(channels.getState("program").slidesSession).toMatchObject({ rowId: "tpl" });
    slidesSession.end("program");
    expect(channels.getState("program").slidesSession).toMatchObject({ rowId: "r1", slot: "media", slideIdx: 1 });
  });

  it("media take stops the loop", () => {
    mediaDeckSession.start("program", { rowId: "r1", deck: deck() });
    channels.mediaTake("program", { rowId: "other", assetUrl: "/assets/x.mp4", volume: 1, endAction: "hold" });
    expect(mediaDeckSession.summary("program")).toBeNull();
    expect(channels.getState("program").slidesSession).toBeUndefined();
    sec(60);
    expect(onAir()).toBe("/assets/x.mp4");
  });

  it("media clear stops the loop", () => {
    mediaDeckSession.start("program", { rowId: "r1", deck: deck() });
    channels.mediaClear("program");
    expect(mediaDeckSession.summary("program")).toBeNull();
    expect(channels.getState("program").slidesSession).toBeUndefined();
    sec(60);
    expect(channels.getState("program").media).toBeNull();
  });

  it("another media deck take replaces the loop", () => {
    mediaDeckSession.start("program", { rowId: "r1", deck: deck() });
    mediaDeckSession.start("program", { rowId: "r2", deck: deck({ slides: [mediaSlide("z", "image")] }) });
    expect(onAir()).toBe("/assets/z.png");
    sec(5);
    expect(onAir()).toBe("/assets/z.png");
    expect(mediaDeckSession.summary("program")).toMatchObject({ rowId: "r2" });
  });

  it("end clears the media slot and the summary", () => {
    mediaDeckSession.start("program", { rowId: "r1", deck: deck() });
    mediaDeckSession.end("program");
    expect(channels.getState("program").media).toBeNull();
    expect(channels.getState("program").slidesSession).toBeUndefined();
    sec(60);
    expect(channels.getState("program").media).toBeNull();
  });

  it("dropAll stops the timer and leaves the media on air", () => {
    mediaDeckSession.start("program", { rowId: "r1", deck: deck() });
    expect(mediaDeckSession.dropAll("program")).toBe(true);
    expect(channels.getState("program").slidesSession).toBeUndefined();
    sec(60);
    expect(onAir()).toBe("/assets/a.png");
  });

  it("onSummaryChange reports each slide and the stop", () => {
    const seen: (number | null)[] = [];
    const off = mediaDeckSession.onSummaryChange((ch, s) => {
      if (ch === "program") seen.push(s ? s.slideIdx : null);
    });
    mediaDeckSession.start("program", { rowId: "r1", deck: deck() });
    sec(5);
    channels.mediaClear("program");
    off();
    expect(seen).toEqual([0, 1, null]);
  });

  it("skips a slide whose file disappeared", () => {
    folder.files.set("lf1", [img("1.png"), img("2.png"), img("3.png")]);
    mediaDeckSession.start("program", { rowId: "r1", deck: folderDeck() });
    expect(onAir()).toBe("/media-folders/lf1/1.png");
    setFolder("lf1", [img("1.png"), img("3.png")]);
    sec(5);
    expect(onAir()).toBe("/media-folders/lf1/3.png");
  });

  it("the current file disappearing stays on air until its hold ends", () => {
    folder.files.set("lf1", [img("1.png"), img("2.png")]);
    mediaDeckSession.start("program", { rowId: "r1", deck: folderDeck() });
    setFolder("lf1", [img("2.png")]);
    sec(4.9);
    expect(onAir()).toBe("/media-folders/lf1/1.png");
    sec(0.1);
    expect(onAir()).toBe("/media-folders/lf1/2.png");
  });

  it("new folder file appears only after the wrap", () => {
    folder.files.set("lf1", [img("1.png"), img("2.png")]);
    mediaDeckSession.start("program", { rowId: "r1", deck: folderDeck() });
    setFolder("lf1", [img("0-new.png"), img("1.png"), img("2.png")]);
    sec(5);
    expect(onAir()).toBe("/media-folders/lf1/2.png");
    sec(5);
    expect(onAir()).toBe("/media-folders/lf1/1.png");
    expect(mediaDeckSession.summary("program")).toMatchObject({ slideIdx: 0, slideCount: 3 });
    sec(5);
    expect(onAir()).toBe("/media-folders/lf1/2.png");
    sec(5);
    expect(onAir()).toBe("/media-folders/lf1/0-new.png");
  });

  it("a folder video advances on ended", () => {
    folder.files.set("lf1", [vid("1.mp4"), img("2.png")]);
    mediaDeckSession.start("program", { rowId: "r1", deck: folderDeck() });
    expect(channels.getState("program").media).toMatchObject({ mediaType: "video" });
    reportEnded();
    expect(onAir()).toBe("/media-folders/lf1/2.png");
  });

  it("empty folder deck refuses to take", () => {
    expect(mediaDeckSession.start("program", { rowId: "r1", deck: folderDeck() })).toEqual({ ok: false, error: EMPTY });
    expect(channels.getState("program").media).toBeNull();
    expect(mediaDeckSession.summary("program")).toBeNull();
  });

  it("when every file is gone the deck holds what's on air and refuses the next take", () => {
    folder.files.set("lf1", [img("1.png"), img("2.png")]);
    mediaDeckSession.start("program", { rowId: "r1", deck: folderDeck() });
    setFolder("lf1", []);
    sec(5);
    expect(onAir()).toBe("/media-folders/lf1/1.png");
    expect(mediaDeckSession.summary("program")?.nextAdvanceAt).toBeUndefined();
    sec(60);
    expect(onAir()).toBe("/media-folders/lf1/1.png");
    expect(mediaDeckSession.start("program", { rowId: "r1", deck: folderDeck() })).toEqual({ ok: false, error: EMPTY });
    // The refused take leaves the held loop alone.
    expect(onAir()).toBe("/media-folders/lf1/1.png");
  });

  it("a held empty folder resumes when files return", () => {
    folder.files.set("lf1", [img("1.png")]);
    mediaDeckSession.start("program", { rowId: "r1", deck: folderDeck() });
    setFolder("lf1", []);
    sec(5);
    setFolder("lf1", [img("9.png")]);
    expect(onAir()).toBe("/media-folders/lf1/9.png");
    expect(mediaDeckSession.summary("program")?.nextAdvanceAt).toBe(Date.now() + 5000);
  });

  it("a video that reports an error is skipped like a missing file", () => {
    const d = deck({ slides: [mediaSlide("v", "video"), mediaSlide("b", "image")] });
    mediaDeckSession.start("program", { rowId: "r1", deck: d });
    reportError();
    expect(onAir()).toBe("/assets/b.png");
    // On the wrap the failed slide stays skipped.
    sec(5);
    expect(onAir()).toBe("/assets/b.png");
    expect(mediaDeckSession.summary("program")).toMatchObject({ slideIdx: 1, nextAdvanceAt: Date.now() + 5000 });
  });

  it("when every slide errors the deck holds what's on air and stops its timer", () => {
    const d = deck({ slides: [mediaSlide("v", "video"), mediaSlide("w", "video")] });
    mediaDeckSession.start("program", { rowId: "r1", deck: d });
    const takes: string[] = [];
    const off = channels.subscribe("program", (st) => {
      if (st.media && !takes.includes(`${st.media.takenAt}`)) takes.push(`${st.media.takenAt}`);
    });
    reportError();
    expect(onAir()).toBe("/assets/w.mp4");
    reportError();
    reportError();
    expect(onAir()).toBe("/assets/w.mp4");
    expect(mediaDeckSession.summary("program")?.nextAdvanceAt).toBeUndefined();
    sec(600);
    off();
    // The first error moved to w; nothing re-took after w failed too.
    expect(takes.length).toBe(2);
    expect(mediaDeckSession.has("program")).toBe(true);
  });

  it("an error on preview does not advance", () => {
    const d = deck({ slides: [mediaSlide("v", "video"), mediaSlide("b", "image")] });
    mediaDeckSession.start("preview", { rowId: "r1", deck: d });
    reportError("preview");
    expect(onAir("preview")).toBe("/assets/v.mp4");
  });

  it("failed and deleted files at the wrap hold the last slide without throwing; graphics still take", () => {
    folder.files.set("lf1", [img("a.png"), img("b.png"), img("c.png")]);
    mediaDeckSession.start("program", { rowId: "r1", deck: folderDeck() });
    reportError();
    expect(onAir()).toBe("/media-folders/lf1/b.png");
    reportError();
    expect(onAir()).toBe("/media-folders/lf1/c.png");
    setFolder("lf1", [img("a.png"), img("b.png")]);
    expect(() => sec(5)).not.toThrow();
    expect(onAir()).toBe("/media-folders/lf1/c.png");
    expect(mediaDeckSession.summary("program")).toMatchObject({ slideIdx: 2, slideCount: 3, label: "c.png" });
    expect(mediaDeckSession.summary("program")?.nextAdvanceAt).toBeUndefined();
    expect(() => channels.take("program", "lower-third", { name: "Pastor" })).not.toThrow();
    expect(() => mediaDeckSession.step("program", -1)).not.toThrow();
    expect(channels.getState("program").slidesSession).toMatchObject({ rowId: "r1", slot: "media" });
  });

  it("a wrap onto the photo already on air re-arms its hold without a re-take", () => {
    folder.files.set("lf1", [img("only.png")]);
    mediaDeckSession.start("program", { rowId: "r1", deck: folderDeck() });
    const takenAt = channels.getState("program").media!.takenAt;
    sec(5);
    expect(channels.getState("program").media!.takenAt).toBe(takenAt);
    expect(mediaDeckSession.summary("program")?.nextAdvanceAt).toBe(Date.now() + 5000);
    sec(5);
    expect(channels.getState("program").media!.takenAt).toBe(takenAt);
  });

  it("a wrap onto the video already on air restarts it in place", () => {
    mediaDeckSession.start("program", { rowId: "r1", deck: deck({ slides: [mediaSlide("v", "video")] }) });
    const takenAt = channels.getState("program").media!.takenAt;
    reportEnded();
    const m = channels.getState("program").media!;
    expect(m.takenAt).toBe(takenAt);
    expect(m.seek?.time).toBe(0);
    expect(m.paused).toBe(false);
  });

  it("the next label names the slide that will actually play", () => {
    folder.files.set("lf1", [img("1.png"), img("2.png"), img("3.png")]);
    mediaDeckSession.start("program", { rowId: "r1", deck: folderDeck() });
    expect(mediaDeckSession.summary("program")?.nextLabel).toBe("2.png");
    setFolder("lf1", [img("1.png"), img("3.png")]);
    expect(mediaDeckSession.summary("program")?.nextLabel).toBe("3.png");
    sec(5);
    // Looping: after the last slide comes the first again.
    expect(mediaDeckSession.summary("program")?.nextLabel).toBe("1.png");
  });

  it("promoting a held (starved) preview deck never re-takes a missing file on program", () => {
    folder.files.set("lf1", [img("1.png"), img("2.png")]);
    mediaDeckSession.start("preview", { rowId: "r1", deck: folderDeck() });
    setFolder("lf1", []);
    mediaDeckSession.step("preview", 1);
    mediaDeckSession.step("preview", 1);
    expect(onAir("preview")).toBe("/media-folders/lf1/1.png"); // held: nothing left to play
    folder.files.set("lf1", [img("2.png")]); // seen at promote, before any change notice
    channels.takePvwToPgm("preview", "program");
    expect(onAir("program")).toBe("/media-folders/lf1/2.png");
    expect(mediaDeckSession.summary("program")).toMatchObject({ label: "2.png", nextAdvanceAt: Date.now() + 5000 });
    expect(channels.getState("preview").media).toBeNull();
  });

  it("promoting a preview deck with nothing playable promotes nothing", () => {
    folder.files.set("lf1", [img("1.png")]);
    mediaDeckSession.start("preview", { rowId: "r1", deck: folderDeck() });
    setFolder("lf1", []);
    mediaDeckSession.step("preview", 1);
    channels.takePvwToPgm("preview", "program");
    expect(channels.getState("program").media).toBeNull();
    expect(mediaDeckSession.has("program")).toBe(false);
    expect(onAir("preview")).toBe("/media-folders/lf1/1.png");
  });

  it("refuses an out-of-range start slide", () => {
    expect(mediaDeckSession.start("program", { rowId: "r1", deck: deck(), slideIdx: 3 })).toEqual({
      ok: false, error: "slide 3",
    });
  });
});
