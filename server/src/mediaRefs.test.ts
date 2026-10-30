import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { DeckSchema, MediaItemSchema, ShowSchema, type MediaItem } from "@overlaysys/core";
import * as media from "./media";
import * as decks from "./decks";
import * as shows from "./shows";
import * as channels from "./channels";
import { rewriteMediaRefs } from "./mediaRefs";

let tmpDir: string;
let prevData: string | undefined;
let prevFix: string | undefined;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "overlaysys-mediarefs-"));
  prevData = process.env["OVERLAYSYS_DATA_DIR"];
  prevFix = process.env["OVERLAYSYS_FIXTURES_DIR"];
  process.env["OVERLAYSYS_DATA_DIR"] = tmpDir;
  process.env["OVERLAYSYS_FIXTURES_DIR"] = tmpDir;
  await media.reloadMedia();
  await decks.reloadDecks();
  await shows.reloadShows();
});

afterEach(async () => {
  if (prevData === undefined) delete process.env["OVERLAYSYS_DATA_DIR"];
  else process.env["OVERLAYSYS_DATA_DIR"] = prevData;
  if (prevFix === undefined) delete process.env["OVERLAYSYS_FIXTURES_DIR"];
  else process.env["OVERLAYSYS_FIXTURES_DIR"] = prevFix;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function item(p: Partial<MediaItem> = {}): MediaItem {
  return MediaItemSchema.parse({
    id: "m1",
    name: "Welcome",
    kind: "file",
    mediaType: "image",
    assetUrl: "/assets/old.png",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...p,
  });
}

async function seed(): Promise<void> {
  await shows.saveShow(
    ShowSchema.parse({
      id: "s1",
      name: "S",
      projectId: "p",
      rows: [
        { kind: "media", id: "r1", mediaType: "image", mediaItemId: "m1", assetUrl: "/assets/old.png" },
        { kind: "media", id: "r2", mediaType: "image", mediaItemId: "other", assetUrl: "/assets/other.png" },
        { kind: "video", id: "r3", mediaItemId: "m1", assetUrl: "/assets/old.png" },
      ],
      songs: [],
    }),
  );
  await decks.saveDeck(
    DeckSchema.parse({
      id: "d1",
      name: "D",
      defaultTemplateId: "t1",
      licensing: { kind: "own" },
      slides: [
        { id: "x1", data: {}, media: { mediaItemId: "m1", assetUrl: "/assets/old.png", mediaType: "image" } },
        { id: "x2", data: {}, media: { mediaItemId: "other", assetUrl: "/assets/other.png", mediaType: "image" } },
      ],
      createdAt: "2026-01-01T00:00:00.000Z",
    }),
  );
}

describe("rewriteMediaRefs", () => {
  it("rewrites a show image row and a deck media slide that reference the item", async () => {
    await seed();
    const res = await rewriteMediaRefs("m1", "/assets/new.png", "image");
    expect(res).toEqual({ shows: 1, decks: 1 });
    const show = (await shows.getShow("s1"))!;
    expect(show.rows.find((r) => r.id === "r1")).toMatchObject({ assetUrl: "/assets/new.png" });
    // A video row keeps its kind, so a photo replacement leaves it alone.
    expect(show.rows.find((r) => r.id === "r3")).toMatchObject({ assetUrl: "/assets/old.png" });
    const deck = (await decks.getDeck("d1"))!;
    expect(deck.slides[0]!.media).toMatchObject({ mediaItemId: "m1", assetUrl: "/assets/new.png", mediaType: "image" });
  });

  it("rewrites a video row when the replacement is a video", async () => {
    await seed();
    await rewriteMediaRefs("m1", "/assets/new.mp4", "video");
    const show = (await shows.getShow("s1"))!;
    expect(show.rows.find((r) => r.id === "r3")).toMatchObject({ kind: "video", assetUrl: "/assets/new.mp4" });
    expect(show.rows.find((r) => r.id === "r1")).toMatchObject({ assetUrl: "/assets/old.png" });
    expect((await decks.getDeck("d1"))!.slides[0]!.media).toMatchObject({ assetUrl: "/assets/new.mp4", mediaType: "video" });
  });

  it("leaves rows referencing other items untouched", async () => {
    await seed();
    await rewriteMediaRefs("m1", "/assets/new.png", "image");
    const show = (await shows.getShow("s1"))!;
    expect(show.rows.find((r) => r.id === "r2")).toMatchObject({ assetUrl: "/assets/other.png" });
    const deck = (await decks.getDeck("d1"))!;
    expect(deck.slides[1]!.media!.assetUrl).toBe("/assets/other.png");
    expect(await rewriteMediaRefs("nobody", "/assets/x.png", "image")).toEqual({ shows: 0, decks: 0 });
  });

  it("does not change channel state already on air", async () => {
    await seed();
    const ch = "media-refs-test";
    channels.mediaTake(ch, { rowId: "r1", assetUrl: "/assets/old.png", label: "Welcome", volume: 1, endAction: "clear" }, 1000);
    const before = structuredClone(channels.getState(ch));
    await rewriteMediaRefs("m1", "/assets/new.png", "image");
    expect(channels.getState(ch)).toEqual(before);
    expect(channels.getState(ch).media?.assetUrl).toBe("/assets/old.png");
  });

  it("saving a library item with a new assetUrl rewrites its uses; an unchanged assetUrl does not", async () => {
    await media.saveMediaItem(item());
    await seed();
    await media.saveMediaItem(item({ name: "Renamed" }));
    expect((await decks.getDeck("d1"))!.slides[0]!.media!.assetUrl).toBe("/assets/old.png");
    await media.saveMediaItem(item({ assetUrl: "/assets/new.png" }));
    expect((await decks.getDeck("d1"))!.slides[0]!.media!.assetUrl).toBe("/assets/new.png");
    expect((await shows.getShow("s1"))!.rows.find((r) => r.id === "r1")).toMatchObject({ assetUrl: "/assets/new.png" });
  });
});
