import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { DeckSchema, MediaItemSchema, ShowSchema, type MediaItem } from "@overlaysys/core";
import * as media from "./media";
import * as mediaStore from "./mediaStore";
import * as decks from "./decks";
import * as shows from "./shows";

let tmpDir: string;
let prevData: string | undefined;
let prevFix: string | undefined;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "overlaysys-media-"));
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
    assetUrl: "/assets/welcome.png",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...p,
  });
}

describe("media registry", () => {
  it("save then list returns the item with usedBy 0", async () => {
    await media.saveMediaItem(item());
    const metas = await media.listMediaMetas();
    expect(metas).toHaveLength(1);
    expect(metas[0]!.id).toBe("m1");
    expect(metas[0]!.usedBy).toBe(0);
    expect(metas[0]!.updatedAt).toBeTruthy();
  });

  it("usedBy counts a show image row, a deck media slide and a live-folder deck referencing it", async () => {
    await media.saveMediaItem(item());
    await media.saveMediaItem(item({ id: "f1", kind: "live-folder", mediaType: undefined, assetUrl: undefined }));
    await shows.saveShow(
      ShowSchema.parse({
        id: "s1",
        name: "S",
        projectId: "p",
        rows: [{ kind: "media", id: "r1", mediaType: "image", mediaItemId: "m1", assetUrl: "/assets/welcome.png" }],
        songs: [],
      }),
    );
    await decks.saveDeck(
      DeckSchema.parse({
        id: "d1",
        name: "D",
        defaultTemplateId: "t1",
        licensing: { kind: "own" },
        slides: [{ id: "x1", data: {}, media: { mediaItemId: "m1", assetUrl: "/assets/welcome.png", mediaType: "image" } }],
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    await decks.saveDeck(
      DeckSchema.parse({
        id: "d2",
        name: "Folder deck",
        defaultTemplateId: "t1",
        licensing: { kind: "own" },
        slides: [],
        liveFolderId: "f1",
        createdAt: "2026-01-01T00:00:00.000Z",
      }),
    );
    const metas = await media.listMediaMetas();
    expect(metas.find((m) => m.id === "m1")!.usedBy).toBe(2);
    expect(metas.find((m) => m.id === "f1")!.usedBy).toBe(1);
  });

  it("delete tombstones; restore revives", async () => {
    await media.saveMediaItem(item());
    expect(await media.deleteMediaItem("m1")).toBe(true);
    expect(await media.getMediaItem("m1")).toBeNull();
    expect(await media.listMediaMetas()).toEqual([]);
    expect((await mediaStore.loadMediaItem("m1"))!.deletedAt).toBeTruthy();
    expect((await media.restoreMediaItem("m1"))!.deletedAt).toBeUndefined();
    expect(await media.getMediaItem("m1")).not.toBeNull();
  });

  it("rejects an unsafe id with statusCode 400", async () => {
    await expect(media.saveMediaItem(item({ id: "../evil" }))).rejects.toMatchObject({ statusCode: 400 });
  });
});
