import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Deck, LiveFolderFile, MediaItem } from "@overlaysys/core";
import type { ServerMessage } from "@overlaysys/ws-protocol";

const fx = vi.hoisted(() => ({
  files: new Map<string, LiveFolderFile[]>(),
  items: new Map<string, MediaItem>(),
  decks: [] as Deck[],
  /** Live folders with no path on this machine. */
  unset: new Set<string>(),
}));
vi.mock("./liveFolders", () => ({
  listLiveFolderFiles: (id: string) => fx.files.get(id) ?? [],
  onLiveFolderChange: () => () => {},
  getLiveFolderPath: async (id: string) => (fx.unset.has(id) ? null : `/folders/${id}`),
}));
vi.mock("./media", () => ({
  getMediaItem: async (id: string) => fx.items.get(id) ?? null,
  listMediaMetas: async () => [],
}));
vi.mock("./decks", () => ({ listDecks: async () => fx.decks }));
vi.mock("./broadcast", () => ({ broadcast: () => {}, registerSender: () => () => {} }));
vi.mock("./cloudSync", () => ({ scheduleSync: () => {} }));
vi.mock("./stageFeedHub", () => ({ invalidateAll: () => {} }));
vi.mock("./songUsage", () => ({ recordSongUse: vi.fn(async () => false) }));

import * as channels from "./channels";
import * as mediaDeckSession from "./mediaDeckSession";
import { handleMediaMessage } from "./mediaHandlers";

const img = (name: string): LiveFolderFile => ({ name, mediaType: "image", size: 1, mtimeMs: 1 });
const folderItem = (id: string, name = "Baptisms"): MediaItem => ({ id, name, kind: "live-folder", createdAt: "2026-10-30T00:00:00.000Z" });

let sent: ServerMessage[];
const send = (m: ServerMessage) => void sent.push(m);
const onAir = (channel = "program") => channels.getState(channel).media?.assetUrl;
const sec = (n: number) => vi.advanceTimersByTime(n * 1000);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-30T12:00:00.000Z"));
  mediaDeckSession.resetAll();
  fx.files.clear();
  fx.items.clear();
  fx.decks = [];
  fx.unset.clear();
  sent = [];
  for (const ch of ["program", "preview"]) {
    channels.mediaClear(ch);
    channels.setActiveNull(ch);
  }
});

afterEach(() => {
  mediaDeckSession.resetAll();
  vi.useRealTimers();
});

describe("media_folder_take", () => {
  it("media_folder_take starts a looping folder deck with 8 s hold", async () => {
    fx.items.set("lf1", folderItem("lf1"));
    fx.files.set("lf1", [img("b.png"), img("a.png")]);
    await handleMediaMessage({ type: "media_folder_take", id: "lf1", channel: "program" }, send);
    expect(sent).toEqual([]);
    expect(onAir()).toBe("/media-folders/lf1/a.png");
    expect(channels.getState("program").media).toMatchObject({ rowId: "media-folder:lf1", mediaType: "image", endAction: "hold" });
    expect(mediaDeckSession.summary("program")).toMatchObject({ rowId: "media-folder:lf1", title: "Baptisms", loops: true, slot: "media" });
    sec(7.9);
    expect(onAir()).toBe("/media-folders/lf1/a.png");
    sec(0.1);
    expect(onAir()).toBe("/media-folders/lf1/b.png");
    sec(8);
    expect(onAir()).toBe("/media-folders/lf1/a.png");
  });

  it("plays in the saved order of a deck that links the folder", async () => {
    fx.items.set("lf1", folderItem("lf1"));
    fx.files.set("lf1", [img("a.png"), img("b.png")]);
    fx.decks = [
      {
        id: "d1",
        name: "Loop",
        tags: [],
        defaultTemplateId: "",
        licensing: { kind: "own" },
        slides: [],
        createdAt: "2026-10-30T00:00:00.000Z",
        liveFolderId: "lf1",
        folderOrder: [{ file: "b.png" }, { file: "a.png" }],
        defaultHoldSec: 3,
      },
    ];
    await handleMediaMessage({ type: "media_folder_take", id: "lf1", channel: "program" }, send);
    expect(onAir()).toBe("/media-folders/lf1/b.png");
    // The panel's 8 s hold, not the deck's.
    sec(3);
    expect(onAir()).toBe("/media-folders/lf1/b.png");
    sec(5);
    expect(onAir()).toBe("/media-folders/lf1/a.png");
  });

  it("media_folder_take on an empty folder is refused with the plain message", async () => {
    fx.items.set("lf1", folderItem("lf1"));
    channels.mediaTake("program", { rowId: "r0", assetUrl: "/assets/keep.png", volume: 1, endAction: "hold", mediaType: "image" });
    await handleMediaMessage({ type: "media_folder_take", id: "lf1", channel: "program" }, send);
    expect(sent).toEqual([
      { type: "error", code: "empty", message: "This folder has no photos or videos yet.", op: "media_folder_take", id: "lf1" },
    ]);
    expect(onAir()).toBe("/assets/keep.png");
    expect(mediaDeckSession.has("program")).toBe(false);
  });

  it("a folder not set up on this computer is refused as such, not as empty", async () => {
    fx.items.set("lf1", folderItem("lf1"));
    fx.unset.add("lf1");
    await handleMediaMessage({ type: "media_folder_take", id: "lf1", channel: "program" }, send);
    expect(sent).toEqual([
      { type: "error", code: "not_configured", message: "This folder is set up on another computer.", op: "media_folder_take", id: "lf1" },
    ]);
    expect(mediaDeckSession.has("program")).toBe(false);
  });

  it("uses the placement and order of the most recently updated deck linking the folder", async () => {
    fx.items.set("lf1", folderItem("lf1"));
    fx.files.set("lf1", [img("a.png"), img("b.png")]);
    const linked = (id: string, updatedAt: string, over: Partial<Deck>): Deck => ({
      id, name: id, tags: [], defaultTemplateId: "", licensing: { kind: "own" }, slides: [],
      createdAt: "2026-10-01T00:00:00.000Z", updatedAt, liveFolderId: "lf1", ...over,
    });
    fx.decks = [
      linked("old", "2026-10-02T00:00:00.000Z", { folderOrder: [{ file: "a.png" }, { file: "b.png" }], mediaFit: "fill" }),
      linked("new", "2026-10-29T00:00:00.000Z", {
        folderOrder: [{ file: "b.png" }, { file: "a.png" }], mediaFit: "contain", mediaPosition: "top-left",
      }),
      linked("mid", "2026-10-10T00:00:00.000Z", { mediaFit: "scale-down" }),
    ];
    await handleMediaMessage({ type: "media_folder_take", id: "lf1", channel: "program" }, send);
    expect(sent).toEqual([]);
    expect(channels.getState("program").media).toMatchObject({
      assetUrl: "/media-folders/lf1/b.png", fit: "contain", position: "top-left",
    });
    // Same answer whatever order the decks are listed in.
    fx.decks.reverse();
    await handleMediaMessage({ type: "media_folder_take", id: "lf1", channel: "program" }, send);
    expect(channels.getState("program").media).toMatchObject({
      assetUrl: "/media-folders/lf1/b.png", fit: "contain", position: "top-left",
    });
  });

  it("a chosen fit/position overrides the deck default for every slide of that loop", async () => {
    fx.items.set("lf1", folderItem("lf1"));
    fx.files.set("lf1", [img("a.png"), img("b.png")]);
    fx.decks = [
      {
        id: "d1", name: "Loop", tags: [], defaultTemplateId: "", licensing: { kind: "own" }, slides: [],
        createdAt: "2026-10-30T00:00:00.000Z", liveFolderId: "lf1", mediaFit: "fill", mediaPosition: "top-left",
      },
    ];
    await handleMediaMessage({ type: "media_folder_take", id: "lf1", channel: "program", fit: "contain", position: "bottom-right" }, send);
    expect(sent).toEqual([]);
    expect(channels.getState("program").media).toMatchObject({ assetUrl: "/media-folders/lf1/a.png", fit: "contain", position: "bottom-right" });
    sec(8);
    expect(channels.getState("program").media).toMatchObject({ assetUrl: "/media-folders/lf1/b.png", fit: "contain", position: "bottom-right" });
    // Only fit chosen: the deck's position still applies.
    await handleMediaMessage({ type: "media_folder_take", id: "lf1", channel: "program", fit: "cover" }, send);
    expect(channels.getState("program").media).toMatchObject({ fit: "cover", position: "top-left" });
  });

  it("a panel-chosen fit/position tops a folderOrder entry's own and the deck default; untouched fields fall back", async () => {
    fx.items.set("lf1", folderItem("lf1"));
    fx.files.set("lf1", [img("a.png"), img("b.png")]);
    fx.decks = [
      {
        id: "d1", name: "Loop", tags: [], defaultTemplateId: "", licensing: { kind: "own" }, slides: [],
        createdAt: "2026-10-30T00:00:00.000Z", liveFolderId: "lf1", mediaPosition: "top-left",
        folderOrder: [{ file: "a.png", fit: "fill", position: "right" }, { file: "b.png" }],
      },
    ];
    await handleMediaMessage({ type: "media_folder_take", id: "lf1", channel: "program", fit: "contain" }, send);
    // a.png: panel fit wins over its own "fill"; its own position still beats the deck's.
    expect(channels.getState("program").media).toMatchObject({ assetUrl: "/media-folders/lf1/a.png", fit: "contain", position: "right" });
    sec(8);
    expect(channels.getState("program").media).toMatchObject({ assetUrl: "/media-folders/lf1/b.png", fit: "contain", position: "top-left" });
    await handleMediaMessage({ type: "media_folder_take", id: "lf1", channel: "program", position: "bottom" }, send);
    expect(channels.getState("program").media).toMatchObject({ assetUrl: "/media-folders/lf1/a.png", fit: "fill", position: "bottom" });
    sec(8);
    expect(channels.getState("program").media).toMatchObject({ assetUrl: "/media-folders/lf1/b.png", fit: "cover", position: "bottom" });
  });

  it("refuses an id that isn't a live folder", async () => {
    fx.items.set("m1", { id: "m1", name: "Photo", kind: "file", mediaType: "image", assetUrl: "/assets/p.png", createdAt: "" });
    await handleMediaMessage({ type: "media_folder_take", id: "m1", channel: "program" }, send);
    await handleMediaMessage({ type: "media_folder_take", id: "gone", channel: "program" }, send);
    expect(sent).toEqual([
      { type: "error", code: "not_found", message: "That live folder is gone.", op: "media_folder_take", id: "m1" },
      { type: "error", code: "not_found", message: "That live folder is gone.", op: "media_folder_take", id: "gone" },
    ]);
    expect(mediaDeckSession.has("program")).toBe(false);
  });

  it("a graphics take leaves a panel-started loop running", async () => {
    fx.items.set("lf1", folderItem("lf1"));
    fx.files.set("lf1", [img("a.png"), img("b.png")]);
    await handleMediaMessage({ type: "media_folder_take", id: "lf1", channel: "program" }, send);
    channels.take("program", "lower-third", { name: "Pastor" });
    expect(mediaDeckSession.has("program")).toBe(true);
    sec(8);
    expect(onAir()).toBe("/media-folders/lf1/b.png");
  });

  it("a cue to preview shows the first file and holds it", async () => {
    fx.items.set("lf1", folderItem("lf1"));
    fx.files.set("lf1", [img("a.png"), img("b.png")]);
    await handleMediaMessage({ type: "media_folder_take", id: "lf1", channel: "preview" }, send);
    expect(onAir("preview")).toBe("/media-folders/lf1/a.png");
    sec(30);
    expect(onAir("preview")).toBe("/media-folders/lf1/a.png");
  });
});
