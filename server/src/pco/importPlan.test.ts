import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { SongSchema, type Song } from "@overlaysys/core";
import type { PcoPlanItem } from "@overlaysys/core";
import * as storage from "../storage";
import * as songs from "../songs";
import * as shows from "../shows";
import { reloadTemplates } from "../templates";
import type { PcoClient } from "./pcoClient";
import { importPlan, type ImportPlanRequest } from "./importPlan";

let tmpDir: string;
let prevDataDir: string | undefined;

const NOW = "2026-07-14T00:00:00.000Z";

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "overlaysys-pco-"));
  prevDataDir = process.env["OVERLAYSYS_DATA_DIR"];
  process.env["OVERLAYSYS_DATA_DIR"] = tmpDir;
  await storage.ensureSeeded();
  // Reset in-memory registries to the fresh temp dir.
  await songs.reloadSongs();
  await shows.reloadShows();
  await reloadTemplates();
});

afterEach(async () => {
  if (prevDataDir === undefined) delete process.env["OVERLAYSYS_DATA_DIR"];
  else process.env["OVERLAYSYS_DATA_DIR"] = prevDataDir;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function existingLibrarySong(): Song {
  return SongSchema.parse({
    id: "amazing-grace",
    title: "Amazing Grace",
    ccliNumber: "22025",
    sections: [{ id: "v1", kind: "verse", label: "Verse 1", slides: [{ id: "v1s1", lines: ["x"] }] }],
    defaultArrangement: ["v1"],
    customFields: {},
  });
}

const ITEMS: PcoPlanItem[] = [
  {
    id: "item-A",
    title: "Amazing Grace",
    sequence: 1,
    itemType: "song",
    song: { id: "pco-song-A", title: "Amazing Grace", ccliNumber: "22025" },
    arrangement: { id: "arr-A", lyrics: "Verse 1\nAmazing grace" },
  },
  {
    id: "item-B",
    title: "Brand New Song",
    sequence: 2,
    itemType: "song",
    song: { id: "pco-song-B", title: "Brand New Song", author: "Someone" },
    arrangement: { id: "arr-B", lyrics: "Verse 1\nfresh lyric line", sequence: ["Verse 1"] },
  },
  { id: "item-C", title: "Welcome & Offering", sequence: 3, itemType: "header", description: "3 min" },
];

const fakeClient: PcoClient = {
  listServiceTypes: async () => [],
  listPlans: async () => [],
  getPlanItems: async () => ITEMS,
};

const baseReq: Omit<ImportPlanRequest, "target"> = {
  serviceTypeId: "st-1",
  planId: "plan-1",
  planTitle: "Sunday AM — 7/19/26",
  lyricTemplateId: "tpl-lyric",
  graphicTemplateId: "tpl-graphic",
  selectedItemIds: ["item-A", "item-B", "item-C"],
};

describe("importPlan", () => {
  it("creates a new show: links by CCLI, creates a missing song, maps a header to a graphic row", async () => {
    await songs.saveSong(existingLibrarySong());

    const result = await importPlan(fakeClient, { ...baseReq, target: { mode: "new", name: "Sunday" } }, NOW);

    expect(result.ok).toBe(true);
    expect(result.counts).toMatchObject({ rows: 3, songsLinked: 1, songsCreated: 1, songsUpdated: 0 });

    const show = await shows.getShow(result.showId!);
    expect(show?.rows).toHaveLength(3);
    expect(show?.rows[0]).toMatchObject({ kind: "song", songId: "amazing-grace" });
    expect(show?.rows[1]).toMatchObject({ kind: "song", songId: "brand-new-song" });
    expect(show?.rows[2]).toMatchObject({ kind: "graphic", notes: "3 min" });
    // Every imported row carries a sourceRef for idempotency.
    expect(show?.rows.map((r) => r.sourceRef?.itemId)).toEqual(["item-A", "item-B", "item-C"]);
    // ShowSong entries seeded for both song rows.
    expect(show?.songs.map((s) => s.songId).sort()).toEqual(["amazing-grace", "brand-new-song"]);

    // Created song has lyrics + pco custom fields.
    const created = await songs.getSong("brand-new-song");
    expect(created?.customFields["pco_song_id"]).toBe("pco-song-B");
    expect(created?.author).toBe("Someone");
    expect(created?.sections[0]?.slides[0]?.lines).toEqual(["fresh lyric line"]);
  });

  it("re-importing the same plan updates rows/songs in place instead of duplicating", async () => {
    await songs.saveSong(existingLibrarySong());

    const first = await importPlan(fakeClient, { ...baseReq, target: { mode: "new", name: "Sunday" } }, NOW);
    const showId = first.showId!;
    const rowIdsBefore = (await shows.getShow(showId))!.rows.map((r) => r.id);

    // Re-run into the SAME show.
    const second = await importPlan(
      fakeClient,
      { ...baseReq, target: { mode: "existing", showId } },
      "2026-07-15T00:00:00.000Z",
    );

    expect(second.counts).toMatchObject({ rows: 3, songsLinked: 1, songsUpdated: 1, songsCreated: 0 });

    const show = await shows.getShow(showId);
    // No duplicate rows — same count, same row ids (updated in place).
    expect(show?.rows).toHaveLength(3);
    expect(show?.rows.map((r) => r.id)).toEqual(rowIdsBefore);
    // Only one library song was created total for item-B.
    const allNew = (await songs.listSongs()).filter((s) => s.customFields["pco_song_id"] === "pco-song-B");
    expect(allNew).toHaveLength(1);
  });
});
