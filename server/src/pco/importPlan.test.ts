import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { PCO_SONG_ID_KEY, SongSchema, type Song } from "@overlaysys/core";
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

function configuredDraft(overrides: Partial<Song> = {}): Song {
  return SongSchema.parse({
    id: "client-supplied-id",
    title: "Brand New Song",
    sections: [{ id: "c1", kind: "chorus", label: "Chorus", slides: [{ id: "c1s1", lines: ["edited line"] }] }],
    defaultArrangement: ["c1"],
    customFields: { hymn_number: "42" },
    defaultLyricTemplateId: "tpl-lyric",
    defaultIntroTemplateId: "tpl-intro",
    defaultIntroFieldLiterals: { line1: "{title}" },
    defaultChannel: "main",
    ...overrides,
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
  listSongArrangements: async () => [],
};

// A plan that lists the SAME PCO song twice — e.g. a reprise later in the
// service. Both items are separate plan rows; both point at `pco-song-D`.
const DUPLICATE_SONG_ITEMS: PcoPlanItem[] = [
  {
    id: "item-D1",
    title: "Great Are You Lord",
    sequence: 1,
    itemType: "song",
    song: { id: "pco-song-D", title: "Great Are You Lord" },
    arrangement: { id: "arr-D", lyrics: "Verse 1\nyou give life" },
  },
  {
    id: "item-D2",
    title: "Great Are You Lord (reprise)",
    sequence: 2,
    itemType: "song",
    song: { id: "pco-song-D", title: "Great Are You Lord" },
    arrangement: { id: "arr-D", lyrics: "Verse 1\nyou give life" },
  },
];

const duplicateSongClient: PcoClient = {
  listServiceTypes: async () => [],
  listPlans: async () => [],
  getPlanItems: async () => DUPLICATE_SONG_ITEMS,
  listSongArrangements: async () => [],
};

/** A configured draft for `pco-song-D` whose only slide carries `line`. */
function repriseDraft(line: string): Song {
  return configuredDraft({
    title: "Great Are You Lord",
    sections: [{ id: "c1", kind: "chorus", label: "Chorus", slides: [{ id: "c1s1", lines: [line] }] }],
    defaultArrangement: ["c1"],
  });
}

// Default config: songs as song rows (auto-match), header as graphic.
const baseReq: Omit<ImportPlanRequest, "target"> = {
  serviceTypeId: "st-1",
  planId: "plan-1",
  planTitle: "Sunday AM — 7/19/26",
  defaultLyricTemplateId: "tpl-lyric",
  defaultGraphicTemplateId: "tpl-graphic",
  items: [
    { itemId: "item-A", kind: "song", templateId: "tpl-lyric" },
    { itemId: "item-B", kind: "song", templateId: "tpl-lyric" },
    { itemId: "item-C", kind: "graphic", templateId: "tpl-graphic", data: { headline: "Welcome & Offering" } },
  ],
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

  it("imports a song item as a graphic row when kind=graphic (no library song touched)", async () => {
    const result = await importPlan(
      fakeClient,
      {
        ...baseReq,
        target: { mode: "new", name: "Sunday" },
        items: [
          { itemId: "item-A", kind: "graphic", templateId: "tpl-graphic", data: { headline: "Amazing Grace" } },
        ],
      },
      NOW,
    );

    expect(result.counts).toMatchObject({ rows: 1, songsCreated: 0, songsLinked: 0, songsUpdated: 0 });
    const show = await shows.getShow(result.showId!);
    expect(show?.rows).toHaveLength(1);
    expect(show?.rows[0]).toMatchObject({
      kind: "graphic",
      templateId: "tpl-graphic",
      data: { headline: "Amazing Grace" },
    });
    expect(show?.songs).toHaveLength(0);
    // The song item's PCO song was NOT imported into the library.
    expect(
      (await songs.listSongs()).some((s) => s.customFields["pco_song_id"] === "pco-song-A"),
    ).toBe(false);
  });

  it("persists a client-configured song draft instead of rebuilding it", async () => {
    const result = await importPlan(
      fakeClient,
      {
        ...baseReq,
        target: { mode: "new", name: "Sunday" },
        items: [{ itemId: "item-B", kind: "song", songAction: "create", templateId: "tpl-lyric", song: configuredDraft() }],
      },
      NOW,
    );

    expect(result.ok).toBe(true);
    expect(result.counts).toMatchObject({ rows: 1, songsCreated: 1, songsUpdated: 0 });

    // The client id is ignored; the server derives the id from the PCO title.
    // (`songs.getSong` resolves to `Song | null`, so assert null, not undefined.)
    expect(await songs.getSong("client-supplied-id")).toBeNull();
    const saved = await songs.getSong("brand-new-song");
    expect(saved?.sections[0]?.slides[0]?.lines).toEqual(["edited line"]);
    expect(saved?.defaultIntroTemplateId).toBe("tpl-intro");
    expect(saved?.defaultIntroFieldLiterals).toEqual({ line1: "{title}" });
    expect(saved?.defaultChannel).toBe("main");
    expect(saved?.customFields["hymn_number"]).toBe("42");
    // PCO stamps are still applied on top of the draft.
    expect(saved?.customFields[PCO_SONG_ID_KEY]).toBe("pco-song-B");
    expect(saved?.customFields["pco_arrangement_id"]).toBe("arr-B");
    expect(saved?.updatedAt).toBe(NOW);
  });

  it("re-resolves a draft id that collides with an unrelated library song", async () => {
    await songs.saveSong(existingLibrarySong()); // id: amazing-grace

    const result = await importPlan(
      fakeClient,
      {
        ...baseReq,
        target: { mode: "new", name: "Sunday" },
        items: [{ itemId: "item-A", kind: "song", songAction: "create", templateId: "tpl-lyric", song: configuredDraft({ id: "amazing-grace", title: "Amazing Grace" }) }],
      },
      NOW,
    );

    expect(result.counts).toMatchObject({ songsCreated: 1 });
    // The pre-existing library song is untouched...
    const untouched = await songs.getSong("amazing-grace");
    expect(untouched?.sections[0]?.slides[0]?.lines).toEqual(["x"]);
    // ...and the draft landed on a collision-free id.
    const created = await songs.getSong("amazing-grace-2");
    expect(created?.customFields[PCO_SONG_ID_KEY]).toBe("pco-song-A");
  });

  it("reuses the library id of a previously imported song and counts it as an update", async () => {
    await songs.saveSong(
      SongSchema.parse({
        id: "legacy-id",
        title: "Brand New Song",
        sections: [{ id: "v1", kind: "verse", label: "Verse 1", slides: [{ id: "v1s1", lines: ["old"] }] }],
        defaultArrangement: ["v1"],
        customFields: { [PCO_SONG_ID_KEY]: "pco-song-B", keep_me: "yes" },
      }),
    );

    const result = await importPlan(
      fakeClient,
      {
        ...baseReq,
        target: { mode: "new", name: "Sunday" },
        items: [{ itemId: "item-B", kind: "song", songAction: "create", templateId: "tpl-lyric", song: configuredDraft() }],
      },
      NOW,
    );

    expect(result.counts).toMatchObject({ songsCreated: 0, songsUpdated: 1 });
    const saved = await songs.getSong("legacy-id");
    expect(saved?.sections[0]?.slides[0]?.lines).toEqual(["edited line"]);
    // Pre-existing custom fields survive underneath the draft's own.
    expect(saved?.customFields["keep_me"]).toBe("yes");
    expect(saved?.customFields["hymn_number"]).toBe("42");
    expect(await songs.getSong("brand-new-song")).toBeNull();
  });

  it("collapses two plan rows referencing one PCO song into a single library song (last draft wins)", async () => {
    // The client models drafts per PLAN ITEM but the server persists per PCO
    // SONG ID, so two rows for one song write the same library song twice.
    // This pins the server half of that asymmetry: nothing is duplicated, both
    // rows import, and the LAST draft written is what survives. The operator
    // UI dedupes its editable drafts by PCO song id (see `creatingSongItems`
    // in apps/operator/src/app/pco/page.tsx) precisely so that both payload
    // entries carry the *same* draft and last-write-wins is harmless.
    const result = await importPlan(
      duplicateSongClient,
      {
        ...baseReq,
        target: { mode: "new", name: "Sunday" },
        items: [
          { itemId: "item-D1", kind: "song", songAction: "create", templateId: "tpl-lyric", song: repriseDraft("first draft") },
          { itemId: "item-D2", kind: "song", songAction: "create", templateId: "tpl-lyric", song: repriseDraft("second draft") },
        ],
      },
      NOW,
    );

    expect(result.ok).toBe(true);
    // One PCO song → exactly one library song, written twice.
    expect(result.counts).toMatchObject({ rows: 2, songsCreated: 1, songsUpdated: 1 });
    const written = (await songs.listSongs()).filter(
      (s) => s.customFields[PCO_SONG_ID_KEY] === "pco-song-D",
    );
    expect(written).toHaveLength(1);
    expect(result.writtenSongIds).toEqual([written[0]!.id]);

    // Both plan rows still import, and both reference that one library song.
    const show = await shows.getShow(result.showId!);
    expect(show?.rows.map((r) => r.sourceRef?.itemId)).toEqual(["item-D1", "item-D2"]);
    expect(show?.rows.every((r) => r.kind === "song" && r.songId === written[0]!.id)).toBe(true);
    expect(show?.songs).toHaveLength(1);

    // Documented behaviour: the second write lands on the same library song,
    // so the second draft is what persists. The first draft is NOT merged.
    expect(written[0]?.sections[0]?.slides[0]?.lines).toEqual(["second draft"]);
  });

  it("reports an invalid song draft and skips the row entirely", async () => {
    const result = await importPlan(
      fakeClient,
      {
        ...baseReq,
        target: { mode: "new", name: "Sunday" },
        items: [
          { itemId: "item-B", kind: "song", songAction: "create", templateId: "tpl-lyric", song: { id: "x", title: "y" } as unknown as Song },
          { itemId: "item-C", kind: "graphic", templateId: "tpl-graphic", data: { headline: "Welcome" } },
        ],
      },
      NOW,
    );

    expect(result.ok).toBe(false);
    expect(result.errors[0]?.itemId).toBe("item-B");
    expect(result.counts.songsCreated).toBe(0);
    const show = await shows.getShow(result.showId!);
    // The bad item produced no row at all (not a silent graphic row), and the
    // healthy item still imported.
    expect(show?.rows.map((r) => r.sourceRef?.itemId)).toEqual(["item-C"]);
  });
});
