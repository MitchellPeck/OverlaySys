import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { PCO_SONG_ID_KEY, SongSchema, type Song } from "@overlaysys/core";
import type { PcoPlanItem } from "@overlaysys/core";
// [P3.11]
import type { Deck } from "@overlaysys/core";
import * as decks from "../decks";
import { reloadDecks } from "../decks";
import { listItemMappings, reloadItemMappings } from "./itemMappings";
// [/P3.11]
import * as storage from "../storage";
import * as songs from "../songs";
import * as shows from "../shows";
import { reloadTemplates } from "../templates";
import type { PcoClient } from "./pcoClient";
import { findImportedItems, importPlan, type ImportPlanRequest } from "./importPlan";

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
  { id: "item-H", title: "Service", sequence: 0, itemType: "header" },
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
  { id: "item-C", title: "Welcome & Offering", sequence: 3, itemType: "item", description: "3 min" },
  {
    id: "item-D",
    title: "Fallback Song",
    sequence: 4,
    itemType: "song",
    song: { id: "pco-song-D", title: "Fallback Song" },
    arrangement: { id: "arr-D-empty", name: "Default", lyrics: "" },
    lyricsArrangement: {
      id: "arr-D-acoustic",
      name: "Acoustic",
      lyrics: "Chorus\nfallback line",
      sequence: ["Chorus"],
    },
  },
];

const fakeClient: PcoClient = {
  listServiceTypes: async () => [],
  listPlans: async () => [],
  getPlanItems: async () => ITEMS,
  listSongArrangements: async () => [],
  getLive: async () => { throw new Error("unused"); },
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
  getLive: async () => { throw new Error("unused"); },
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
  it("creates a new show: links by CCLI, creates a missing song, maps a plain item to a graphic row", async () => {
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

  it("dates a new show with the plan's service date", async () => {
    await songs.saveSong(existingLibrarySong());
    const result = await importPlan(
      fakeClient,
      { ...baseReq, planDate: "2026-07-19T09:00:00Z", target: { mode: "new", name: "Sunday" } },
      NOW,
    );
    expect((await shows.getShow(result.showId!))?.scheduledFor).toBe("2026-07-19");
  });

  it("dates an existing undated show but keeps an existing show's own date", async () => {
    await songs.saveSong(existingLibrarySong());
    const first = await importPlan(fakeClient, { ...baseReq, target: { mode: "new", name: "Sunday" } }, NOW);
    const showId = first.showId!;
    expect((await shows.getShow(showId))?.scheduledFor).toBeUndefined();

    await importPlan(fakeClient, { ...baseReq, planDate: "2026-07-19T09:00:00Z", target: { mode: "existing", showId } }, NOW);
    expect((await shows.getShow(showId))?.scheduledFor).toBe("2026-07-19");

    await importPlan(fakeClient, { ...baseReq, planDate: "2026-08-02T09:00:00Z", target: { mode: "existing", showId } }, NOW);
    expect((await shows.getShow(showId))?.scheduledFor).toBe("2026-07-19");
  });

  it("ignores an unparseable plan date", async () => {
    await songs.saveSong(existingLibrarySong());
    const result = await importPlan(
      fakeClient,
      { ...baseReq, planDate: "next Sunday", target: { mode: "new", name: "Sunday" } },
      NOW,
    );
    expect((await shows.getShow(result.showId!))?.scheduledFor).toBeUndefined();
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

  it("re-importing keeps a replaced row's sermon notes link", async () => {
    await songs.saveSong(existingLibrarySong());
    const first = await importPlan(fakeClient, { ...baseReq, target: { mode: "new", name: "Sunday" } }, NOW);
    const showId = first.showId!;
    const before = (await shows.getShow(showId))!;
    await shows.saveShow({
      ...before,
      sermonNotes: [{ id: "n1", title: "Grace", body: "# One" }],
      rows: before.rows.map((r, i) => (i === 0 ? { ...r, sermonNotesId: "n1" } : r)),
    });

    await importPlan(fakeClient, { ...baseReq, target: { mode: "existing", showId } }, "2026-07-15T00:00:00.000Z");

    const after = (await shows.getShow(showId))!;
    expect(after.rows[0]?.id).toBe(before.rows[0]?.id);
    expect(after.rows[0]?.sermonNotesId).toBe("n1");
    expect(after.rows[1]?.sermonNotesId).toBeUndefined();
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
    expect(saved?.updatedAt).toEqual(expect.any(String));
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

  it("imports lyrics from the fallback arrangement and stamps its id", async () => {
    const result = await importPlan(
      fakeClient,
      {
        ...baseReq,
        target: { mode: "new", name: "Sunday" },
        items: [{ itemId: "item-D", kind: "song", songAction: "create", templateId: "tpl-lyric" }],
      },
      NOW,
    );

    expect(result.counts).toMatchObject({ songsCreated: 1 });
    const song = await songs.getSong("fallback-song");
    expect(song?.sections[0]?.slides[0]?.lines).toEqual(["fallback line"]);
    // Provenance points at the arrangement the lyrics actually came from.
    expect(song?.customFields["pco_arrangement_id"]).toBe("arr-D-acoustic");
  });

  it("stamps the fallback arrangement id on the client-draft path too", async () => {
    const draft = SongSchema.parse({
      id: "whatever",
      title: "Fallback Song",
      sections: [{ id: "c1", kind: "chorus", label: "Chorus", slides: [{ id: "c1s1", lines: ["edited"] }] }],
      defaultArrangement: ["c1"],
      customFields: {},
    });

    await importPlan(
      fakeClient,
      {
        ...baseReq,
        target: { mode: "new", name: "Sunday" },
        items: [{ itemId: "item-D", kind: "song", songAction: "create", templateId: "tpl-lyric", song: draft }],
      },
      NOW,
    );

    const song = await songs.getSong("fallback-song");
    expect(song?.sections[0]?.slides[0]?.lines).toEqual(["edited"]);
    expect(song?.customFields["pco_arrangement_id"]).toBe("arr-D-acoustic");
  });
});

describe("importPlan — scripture kind", () => {
  const scriptureItems: PcoPlanItem[] = [
    { id: "item-S1", title: "Scripture: John 3:16", sequence: 1, itemType: "item", description: "Read by Pat" },
    { id: "item-S2", title: "Bad ref", sequence: 2, itemType: "item" },
    { id: "item-C", title: "Welcome", sequence: 3, itemType: "item", description: "3 min" },
  ];
  const scriptureClient: PcoClient = {
    listServiceTypes: async () => [],
    listPlans: async () => [],
    getPlanItems: async () => scriptureItems,
    listSongArrangements: async () => [],
    getLive: async () => { throw new Error("unused"); },
  };
  const req: ImportPlanRequest = {
    serviceTypeId: "st-1",
    planId: "plan-1",
    target: { mode: "new", name: "Scripture Sunday" },
    defaultGraphicTemplateId: "tpl-graphic",
    items: [
      { itemId: "item-S1", kind: "scripture", reference: "John 3:16", translation: "KJV", templateId: "tpl-scripture" },
      { itemId: "item-S2", kind: "scripture", reference: "Not a ref", translation: "KJV", templateId: "tpl-scripture" },
      { itemId: "item-C", kind: "graphic", templateId: "tpl-graphic", data: { headline: "Welcome" } },
    ],
  };

  it("imports a scripture item as a scripture row with sourceRef and PCO description notes", async () => {
    const result = await importPlan(scriptureClient, { ...req, items: [req.items[0]!] }, NOW);
    expect(result.ok).toBe(true);
    expect(result.counts.rows).toBe(1);
    const show = await shows.getShow(result.showId!);
    expect(show?.rows[0]).toMatchObject({
      kind: "scripture",
      reference: "John 3:16",
      translation: "KJV",
      templateId: "tpl-scripture",
      notes: "Read by Pat",
      sourceRef: { itemId: "item-S1" },
    });
  });

  it("reports a bad reference as an error and still imports the other rows", async () => {
    const result = await importPlan(scriptureClient, { ...req }, NOW);
    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ itemId: "item-S2" });
    expect(result.errors[0]!.message).toContain('Scripture "Not a ref"');
    const show = await shows.getShow(result.showId!);
    expect(show?.rows.map((r) => r.kind)).toEqual(["scripture", "graphic"]);
  });

  it("errors when reference or translation is missing", async () => {
    const result = await importPlan(
      scriptureClient,
      { ...req, items: [{ itemId: "item-S1", kind: "scripture", templateId: "tpl-scripture" }] },
      NOW,
    );
    expect(result.errors[0]).toEqual({
      itemId: "item-S1",
      message: "Scripture item needs a reference and translation.",
    });
  });

  it("keeps operator slide edits when re-importing the same reference", async () => {
    const first = await importPlan(scriptureClient, { ...req, items: [req.items[0]!] }, NOW);
    const show = (await shows.getShow(first.showId!))!;
    const row = show.rows[0]!;
    if (row.kind !== "scripture") throw new Error("expected scripture row");
    row.slides = [{ id: "edited", verses: row.slides[0]!.verses }];
    await shows.saveShow(show);
    const again = await importPlan(
      scriptureClient,
      { ...req, target: { mode: "existing", showId: first.showId }, items: [req.items[0]!] },
      NOW,
    );
    const after = await shows.getShow(again.showId!);
    expect(after?.rows).toHaveLength(1);
    expect(after?.rows[0]).toMatchObject({ kind: "scripture", slides: [{ id: "edited" }] });
  });
});

describe("importPlan row length", () => {
  const headerItem = (lengthSec?: number): PcoPlanItem => ({
    id: "item-C",
    title: "Welcome",
    sequence: 1,
    itemType: "item",
    ...(lengthSec ? { lengthSec } : {}),
  });
  const req: ImportPlanRequest = {
    serviceTypeId: "st-1",
    planId: "plan-1",
    defaultGraphicTemplateId: "tpl-graphic",
    target: { mode: "new", name: "Sunday" },
    items: [{ itemId: "item-C", kind: "graphic", templateId: "tpl-graphic", data: { headline: "Welcome" } }],
  };
  const clientWith = (lengthSec?: number): PcoClient => ({
    ...fakeClient,
    getPlanItems: async () => [headerItem(lengthSec)],
  });

  it("new graphic row gets the item's length; re-import refreshes it", async () => {
    const first = await importPlan(clientWith(300), req, NOW);
    expect((await shows.getShow(first.showId!))?.rows[0]?.lengthSec).toBe(300);
    await importPlan(clientWith(420), { ...req, target: { mode: "existing", showId: first.showId } }, NOW);
    expect((await shows.getShow(first.showId!))?.rows[0]?.lengthSec).toBe(420);
  });

  it("keeps a manual length on re-import", async () => {
    const first = await importPlan(clientWith(300), req, NOW);
    const show = (await shows.getShow(first.showId!))!;
    await shows.saveShow({ ...show, rows: show.rows.map((r) => ({ ...r, lengthSec: 600, lengthSecManual: true })) });
    await importPlan(clientWith(420), { ...req, target: { mode: "existing", showId: first.showId } }, NOW);
    expect((await shows.getShow(first.showId!))?.rows[0]).toMatchObject({ lengthSec: 600, lengthSecManual: true });
  });

  it("drops the length when PCO no longer has one", async () => {
    const first = await importPlan(clientWith(300), req, NOW);
    await importPlan(clientWith(undefined), { ...req, target: { mode: "existing", showId: first.showId } }, NOW);
    expect((await shows.getShow(first.showId!))?.rows[0]?.lengthSec).toBeUndefined();
  });
});

describe("importPlan — re-sync", () => {
  function previouslyImported(extra: Partial<Song> = {}): Song {
    return SongSchema.parse({
      id: "legacy-id",
      title: "Brand New Song",
      sections: [{ id: "v1", kind: "verse", label: "Verse 1", slides: [{ id: "v1s1", lines: ["old"] }] }],
      defaultArrangement: ["v1"],
      customFields: { [PCO_SONG_ID_KEY]: "pco-song-B" },
      defaultLyricTemplateId: "tpl-mine",
      defaultIntroTemplateId: "tpl-intro-mine",
      defaultIntroFieldMap: { line1: "title" },
      defaultOutroTemplateId: "tpl-outro-mine",
      defaultChannel: "ch-mine",
      ...extra,
    });
  }

  const onlyB = (song?: Song): Omit<ImportPlanRequest, "target"> => ({
    ...baseReq,
    items: [{ itemId: "item-B", kind: "song", songAction: "create", templateId: "tpl-lyric", ...(song ? { song } : {}) }],
  });

  it("keeps library song defaults when a re-import rebuilds the song from PCO", async () => {
    await songs.saveSong(previouslyImported());
    await importPlan(fakeClient, { ...onlyB(), target: { mode: "new", name: "S" } }, NOW);
    const saved = await songs.getSong("legacy-id");
    expect(saved?.sections[0]?.slides[0]?.lines).toEqual(["fresh lyric line"]);
    expect(saved).toMatchObject({
      defaultLyricTemplateId: "tpl-mine",
      defaultIntroTemplateId: "tpl-intro-mine",
      defaultIntroFieldMap: { line1: "title" },
      defaultOutroTemplateId: "tpl-outro-mine",
      defaultChannel: "ch-mine",
    });
  });

  it("a client draft's own defaults win; ones it leaves unset are kept", async () => {
    await songs.saveSong(previouslyImported());
    const draft = configuredDraft({ defaultChannel: undefined, defaultOutroTemplateId: undefined });
    await importPlan(fakeClient, { ...onlyB(draft), target: { mode: "new", name: "S" } }, NOW);
    const saved = await songs.getSong("legacy-id");
    expect(saved).toMatchObject({
      defaultLyricTemplateId: "tpl-lyric",
      defaultIntroTemplateId: "tpl-intro",
      defaultOutroTemplateId: "tpl-outro-mine",
      defaultChannel: "ch-mine",
    });
  });

  it("flags rows whose item was removed from the plan, leaving them in place", async () => {
    await songs.saveSong(existingLibrarySong());
    const first = await importPlan(fakeClient, { ...baseReq, target: { mode: "new", name: "S" } }, NOW);
    const withoutC: PcoClient = { ...fakeClient, getPlanItems: async () => ITEMS.filter((i) => i.id !== "item-C") };
    const second = await importPlan(
      withoutC,
      { ...baseReq, items: baseReq.items.filter((i) => i.itemId !== "item-C"), target: { mode: "existing", showId: first.showId } },
      NOW,
    );
    expect(second.removedRows).toEqual([
      { rowId: expect.any(String), itemId: "item-C", label: "Welcome & Offering" },
    ]);
    expect(second.warnings.join(" ")).toMatch(/removed from the plan/);
    expect((await shows.getShow(first.showId!))?.rows).toHaveLength(3);
  });

  it("findImportedItems maps plan items to the shows that hold them", async () => {
    await songs.saveSong(existingLibrarySong());
    const first = await importPlan(fakeClient, { ...baseReq, target: { mode: "new", name: "Sunday" } }, NOW);
    const show = (await shows.getShow(first.showId!))!;
    const imported = findImportedItems([show], "st-1", "plan-1");
    expect(Object.keys(imported).sort()).toEqual(["item-A", "item-B", "item-C"]);
    expect(imported["item-A"]).toEqual([{ showId: show.id, showName: "Sunday" }]);
    expect(findImportedItems([show], "st-1", "other-plan")).toEqual({});
  });

  it("reorders plan rows to plan order only when asked, keeping manual rows in their slots", async () => {
    await songs.saveSong(existingLibrarySong());
    const first = await importPlan(fakeClient, { ...baseReq, target: { mode: "new", name: "S" } }, NOW);
    const showId = first.showId!;
    // Operator moved item-C to the top and added a manual row in slot 1.
    const show = (await shows.getShow(showId))!;
    const [a, b, c] = show.rows;
    const manual = { ...c!, id: "manual", sourceRef: undefined };
    await shows.saveShow({ ...show, rows: [c!, manual, a!, b!] });

    const keep = await importPlan(fakeClient, { ...baseReq, target: { mode: "existing", showId } }, NOW);
    expect(keep.reordered).toBe(false);
    expect((await shows.getShow(showId))!.rows.map((r) => r.sourceRef?.itemId ?? r.id)).toEqual([
      "item-C", "manual", "item-A", "item-B",
    ]);

    const re = await importPlan(fakeClient, { ...baseReq, reorderToPlan: true, target: { mode: "existing", showId } }, NOW);
    expect(re.reordered).toBe(true);
    expect((await shows.getShow(showId))!.rows.map((r) => r.sourceRef?.itemId ?? r.id)).toEqual([
      "item-A", "manual", "item-B", "item-C",
    ]);
  });
});

describe("importPlan — header sections", () => {
  const PLAN: PcoPlanItem[] = [
    { id: "i1", title: "Prelude", sequence: 1, itemType: "item" },
    { id: "h2", title: " Worship ", sequence: 2, itemType: "header" },
    { id: "i3", title: "Welcome", sequence: 3, itemType: "item" },
    { id: "h4", title: "Message", sequence: 4, itemType: "header" },
    { id: "i5", title: "Closing", sequence: 5, itemType: "item" },
  ];
  const client: PcoClient = { ...fakeClient, getPlanItems: async () => PLAN };
  const cfg = (id: string) => ({ itemId: id, kind: "graphic" as const, templateId: "tpl-graphic", data: { headline: id } });
  const req = (ids: string[]): Omit<ImportPlanRequest, "target"> => ({
    ...baseReq,
    items: ids.map(cfg),
  });

  it("imports headers as sections, never as rows", async () => {
    const r = await importPlan(client, { ...req(["i1", "h2", "i3", "h4", "i5"]), target: { mode: "new", name: "S" } }, NOW);
    expect(r.counts).toMatchObject({ rows: 3, sections: 2, headerRowsConverted: 0 });
    const show = (await shows.getShow(r.showId!))!;
    expect(show.rows.map((x) => x.sourceRef?.itemId)).toEqual(["i1", "i3", "i5"]);
    expect(show.rows.map((x) => x.sectionId)).toEqual([undefined, "pco-h2", "pco-h4"]);
    expect(show.sections).toEqual([{ id: "pco-h2", name: "Worship" }, { id: "pco-h4", name: "Message" }]);
  });

  it("re-import removes header rows left by an older import", async () => {
    const first = await importPlan(client, { ...req(["i1", "i3"]), target: { mode: "new", name: "S" } }, NOW);
    const show = (await shows.getShow(first.showId!))!;
    const old = { ...show.rows[0]!, id: "old-header", sourceRef: { ...show.rows[0]!.sourceRef!, itemId: "h2" } };
    await shows.saveShow({ ...show, rows: [...show.rows, old] });
    const r = await importPlan(client, { ...req(["i1", "i3"]), target: { mode: "existing", showId: first.showId } }, NOW);
    expect(r.counts.headerRowsConverted).toBe(1);
    expect((await shows.getShow(first.showId!))!.rows.map((x) => x.id)).not.toContain("old-header");
  });

  it("keeps a row the operator moved into a manual section", async () => {
    const first = await importPlan(client, { ...req(["i3"]), target: { mode: "new", name: "S" } }, NOW);
    const show = (await shows.getShow(first.showId!))!;
    await shows.saveShow({
      ...show,
      sections: [{ id: "mine", name: "Mine" }, ...(show.sections ?? [])],
      rows: show.rows.map((x) => ({ ...x, sectionId: "mine" })),
    });
    await importPlan(client, { ...req(["i3"]), target: { mode: "existing", showId: first.showId } }, NOW);
    const after = (await shows.getShow(first.showId!))!;
    expect(after.rows[0]!.sectionId).toBe("mine");
    expect(after.sections?.map((s) => s.id)).toEqual(["mine", "pco-h2"]);
  });

  it("does not create a section with no imported rows", async () => {
    const r = await importPlan(client, { ...req(["i1", "i5"]), target: { mode: "new", name: "S" } }, NOW);
    const show = (await shows.getShow(r.showId!))!;
    expect(show.sections?.map((s) => s.id)).toEqual(["pco-h4"]);
    expect(r.counts.sections).toBe(1);
  });

  it("re-import keeps sectionless operator rows in place (carry-forward)", async () => {
    const first = await importPlan(client, { ...req(["i3", "i5"]), target: { mode: "new", name: "S" } }, NOW);
    const show = (await shows.getShow(first.showId!))!;
    const [r3, r5] = show.rows;
    const man = (id: string) => ({ ...r3!, id, sectionId: undefined, sourceRef: undefined });
    await shows.saveShow({ ...show, rows: [man("manual-top"), r3!, man("manual-mid"), r5!, man("manual-end")] });
    await importPlan(client, { ...req(["i3", "i5"]), target: { mode: "existing", showId: first.showId } }, NOW);
    const after = (await shows.getShow(first.showId!))!;
    expect(after.rows.map((x) => x.sourceRef?.itemId ?? x.id)).toEqual(["manual-top", "i3", "manual-mid", "i5", "manual-end"]);
    expect(after.rows.map((x) => x.sectionId)).toEqual([undefined, "pco-h2", "pco-h2", "pco-h4", "pco-h4"]);
  });

  it("keeps rows in display order after import", async () => {
    const r = await importPlan(client, { ...req(["i5", "i3", "i1"]), target: { mode: "new", name: "S" } }, NOW);
    const show = (await shows.getShow(r.showId!))!;
    expect(show.rows.map((x) => x.sourceRef?.itemId)).toEqual(["i1", "i3", "i5"]);
  });
});

describe("importPlan — linked song arrangement [P2b.27]", () => {
  const sec = (id: string, label: string) => ({ id, kind: "verse", label, slides: [{ id: `${id}s`, lines: ["x"] }] });
  const linked = () =>
    SongSchema.parse({
      id: "amazing-grace",
      title: "Amazing Grace",
      ccliNumber: "22025",
      sections: [sec("v1", "Verse 1"), sec("c1", "Chorus"), sec("v2", "Verse 2"), sec("b1", "Bridge")],
      defaultArrangement: ["v1", "c1"],
      customFields: {},
      updatedAt: "2020-01-01T00:00:00.000Z",
    });
  const clientWith = (sequence: string[] | undefined): PcoClient => ({
    ...fakeClient,
    getPlanItems: async () => [
      {
        id: "item-A",
        title: "Amazing Grace",
        sequence: 1,
        itemType: "song",
        song: { id: "pco-song-A", title: "Amazing Grace", ccliNumber: "22025" },
        arrangement: { id: "arr-A", lyrics: "Verse 1\nline", ...(sequence ? { sequence } : {}) },
      },
    ],
  });
  const SEQ = ["Verse 1", "Chorus", "Chorus", "Bridge"];

  async function run(client: PcoClient, cfg: Record<string, unknown>, target: ImportPlanRequest["target"]) {
    const request = {
      ...baseReq,
      items: [{ itemId: "item-A", kind: "song", templateId: "tpl-lyric", ...cfg }],
      target,
    } as ImportPlanRequest;
    const result = await importPlan(client, request, NOW);
    return { result, show: await shows.getShow(result.showId!) };
  }

  for (const [name, cfg] of [
    ["explicit link", { songAction: "link", songId: "amazing-grace" }],
    ["auto CCLI match", {}],
  ] as const) {
    it(`${name}: row follows the sequence, library song untouched`, async () => {
      await songs.saveSong(linked());
      const before = await songs.getSong("amazing-grace");
      const { result, show } = await run(clientWith(SEQ), cfg, { mode: "new", name: "S" });
      expect(result.writtenSongIds).toEqual([]);
      const row = show?.rows[0];
      expect(row?.kind === "song" && row.arrangement).toEqual(["v1", "c1", "c1", "b1"]);
      const after = await songs.getSong("amazing-grace");
      expect(after?.defaultArrangement).toEqual(["v1", "c1"]);
      expect(after?.updatedAt).toBe(before?.updatedAt);
    });
  }

  it("leaves arrangement undefined when no labels match", async () => {
    await songs.saveSong(linked());
    const { show } = await run(clientWith(["Tag"]), {}, { mode: "new", name: "S" });
    const row = show?.rows[0];
    expect(row?.kind === "song" && row.arrangement).toBeUndefined();
  });

  it("re-import keeps the operator's edit to the row arrangement", async () => {
    await songs.saveSong(linked());
    const first = await run(clientWith(SEQ), {}, { mode: "new", name: "S" });
    const showId = first.result.showId!;
    const edited = structuredClone(first.show!);
    const r0 = edited.rows[0]!;
    if (r0.kind === "song") r0.arrangement = ["v2", "b1"];
    await shows.saveShow(edited);

    const second = await run(clientWith(["Verse 2"]), {}, { mode: "existing", showId });
    const row = second.show?.rows[0];
    expect(row?.kind === "song" && row.arrangement).toEqual(["v2", "b1"]);
  });

  it("re-import follows PCO's new sequence when the operator didn't edit", async () => {
    await songs.saveSong(linked());
    const first = await run(clientWith(SEQ), {}, { mode: "new", name: "S" });
    const second = await run(clientWith(["Verse 2"]), {}, { mode: "existing", showId: first.result.showId! });
    const row = second.show?.rows[0];
    expect(row?.kind === "song" && row.arrangement).toEqual(["v2"]);
  });
});

// [P3.11]
describe("importPlan — slides kind [P3.11]", () => {
  const PLAN: PcoPlanItem[] = [
    { id: "s1", title: "Call to Worship", sequence: 1, itemType: "item", lengthSec: 120 },
    {
      id: "s2",
      title: "Doxology",
      sequence: 2,
      itemType: "song",
      song: { id: "pco-song-X", title: "Doxology" },
      arrangement: { id: "arr-X", lyrics: "Verse 1\nLine A" },
    },
    { id: "g3", title: "Welcome", sequence: 3, itemType: "item" },
  ];
  const client: PcoClient = { ...fakeClient, getPlanItems: async () => PLAN };
  const deck = (id: string, name: string): Deck => ({
    id,
    name,
    tags: [],
    defaultTemplateId: "tpl-graphic",
    licensing: { kind: "own" },
    slides: [
      { id: `${id}-a`, data: { headline: "Line A" } },
      { id: `${id}-b`, data: { headline: "Line B" } },
    ],
    createdAt: NOW,
  });
  const req = (items: ImportPlanRequest["items"]): ImportPlanRequest => ({
    serviceTypeId: "st-1",
    planId: "plan-1",
    defaultGraphicTemplateId: "tpl-graphic",
    target: { mode: "new", name: "Sunday" },
    items,
  });
  const reimport = (showId: string, items: ImportPlanRequest["items"]): ImportPlanRequest => ({
    ...req(items),
    target: { mode: "existing", showId },
  });

  beforeEach(async () => {
    await reloadDecks();
    await reloadItemMappings();
    await decks.saveDeck(deck("deck-cw", "Call to Worship"));
    await decks.saveDeck(deck("deck-dox", "Doxology"));
  });

  it("a slides-kind item becomes a slides row with sourceRef and PCO length", async () => {
    const result = await importPlan(client, req([{ itemId: "s1", kind: "slides", deckId: "deck-cw" }]), NOW);
    expect(result.ok).toBe(true);
    const row = (await shows.getShow(result.showId!))!.rows[0]!;
    expect(row.kind).toBe("slides");
    if (row.kind !== "slides") throw new Error("expected slides row");
    expect(row.deckId).toBe("deck-cw");
    expect(row.sourceRef).toMatchObject({ provider: "pco", serviceTypeId: "st-1", planId: "plan-1", itemId: "s1" });
    expect(row.lengthSec).toBe(120);
    expect(row.templateId).toBeUndefined();
  });

  it("uses the config templateId as the row template override", async () => {
    const result = await importPlan(
      client,
      req([{ itemId: "s1", kind: "slides", deckId: "deck-cw", templateId: "tpl-lyric" }]),
      NOW,
    );
    expect((await shows.getShow(result.showId!))!.rows[0]).toMatchObject({ kind: "slides", templateId: "tpl-lyric" });
  });

  it("re-import keeps the operator's slideIds and fieldOverrides for the same deck", async () => {
    const first = await importPlan(client, req([{ itemId: "s1", kind: "slides", deckId: "deck-cw" }]), NOW);
    const show = (await shows.getShow(first.showId!))!;
    await shows.saveShow({
      ...show,
      rows: show.rows.map((r) =>
        r.kind === "slides"
          ? {
              ...r,
              slideIds: ["deck-cw-b", "deck-cw-a", "deck-cw-b"],
              fieldOverrides: { "deck-cw-a": { headline: "Line C" } },
            }
          : r,
      ),
    });
    await importPlan(client, reimport(first.showId!, [{ itemId: "s1", kind: "slides", deckId: "deck-cw" }]), NOW);
    const after = (await shows.getShow(first.showId!))!;
    expect(after.rows).toHaveLength(1);
    expect(after.rows[0]).toMatchObject({
      kind: "slides",
      deckId: "deck-cw",
      slideIds: ["deck-cw-b", "deck-cw-a", "deck-cw-b"],
      fieldOverrides: { "deck-cw-a": { headline: "Line C" } },
    });

    // A different deck drops the old deck's slide picks.
    await importPlan(client, reimport(first.showId!, [{ itemId: "s1", kind: "slides", deckId: "deck-dox" }]), NOW);
    const switched = (await shows.getShow(first.showId!))!.rows[0]!;
    expect(switched).toMatchObject({ kind: "slides", deckId: "deck-dox" });
    if (switched.kind !== "slides") throw new Error("expected slides row");
    expect(switched.slideIds).toBeUndefined();
    expect(switched.fieldOverrides).toBeUndefined();
  });

  it("re-import keeps sectionId, sermonNotesId and a manual length on slides rows", async () => {
    const first = await importPlan(client, req([{ itemId: "s1", kind: "slides", deckId: "deck-cw" }]), NOW);
    const show = (await shows.getShow(first.showId!))!;
    await shows.saveShow({
      ...show,
      sections: [{ id: "sec-manual", name: "Opening" }],
      rows: show.rows.map((r) => ({
        ...r,
        sectionId: "sec-manual",
        sermonNotesId: "notes-1",
        lengthSec: 45,
        lengthSecManual: true,
      })),
    });
    await importPlan(client, reimport(first.showId!, [{ itemId: "s1", kind: "slides", deckId: "deck-cw" }]), NOW);
    expect((await shows.getShow(first.showId!))!.rows[0]).toMatchObject({
      kind: "slides",
      sectionId: "sec-manual",
      sermonNotesId: "notes-1",
      lengthSec: 45,
      lengthSecManual: true,
    });
  });

  it("a slides config naming an unknown deck fails that item with 'Deck not found for \"<title>\"' and imports the rest", async () => {
    const result = await importPlan(
      client,
      req([
        { itemId: "s1", kind: "slides", deckId: "deck-gone" },
        { itemId: "g3", kind: "graphic", templateId: "tpl-graphic", data: { headline: "Welcome" } },
      ]),
      NOW,
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([{ itemId: "s1", message: 'Deck not found for "Call to Worship"' }]);
    expect((await shows.getShow(result.showId!))!.rows.map((r) => r.kind)).toEqual(["graphic"]);
  });

  it("a deleted deck counts as unknown", async () => {
    await decks.deleteDeck("deck-cw");
    const result = await importPlan(client, req([{ itemId: "s1", kind: "slides", deckId: "deck-cw" }]), NOW);
    expect(result.errors).toEqual([{ itemId: "s1", message: 'Deck not found for "Call to Worship"' }]);
  });

  it("remember: true writes title and pcoSong mappings only after the show saved", async () => {
    const saveSpy = vi.spyOn(shows, "saveShow").mockRejectedValueOnce(new Error("disk full"));
    await expect(
      importPlan(client, req([{ itemId: "s2", kind: "slides", deckId: "deck-dox", remember: true }]), NOW),
    ).rejects.toThrow("disk full");
    expect(await listItemMappings()).toEqual([]);
    saveSpy.mockRestore();

    const result = await importPlan(
      client,
      req([
        { itemId: "s1", kind: "slides", deckId: "deck-cw", remember: true, templateId: "tpl-lyric" },
        { itemId: "s2", kind: "slides", deckId: "deck-dox", remember: true },
      ]),
      NOW,
    );
    expect(result.ok).toBe(true);
    const byKey = Object.fromEntries((await listItemMappings()).map((m) => [m.key, m]));
    expect(Object.keys(byKey).sort()).toEqual(["pcoSong:pco-song-X", "title:call to worship", "title:doxology"]);
    expect(byKey["title:call to worship"]).toMatchObject({ kind: "slides", deckId: "deck-cw", templateId: "tpl-lyric" });
    expect(byKey["pcoSong:pco-song-X"]).toMatchObject({ kind: "slides", deckId: "deck-dox" });
    expect(byKey["pcoSong:pco-song-X"]!.templateId).toBeUndefined();
  });

  it("remember: false writes no mapping", async () => {
    await importPlan(client, req([{ itemId: "s2", kind: "slides", deckId: "deck-dox", remember: false }]), NOW);
    await importPlan(client, req([{ itemId: "s1", kind: "slides", deckId: "deck-cw" }]), NOW);
    expect(await listItemMappings()).toEqual([]);
  });

  it("a failed slides item is not remembered", async () => {
    await importPlan(client, req([{ itemId: "s1", kind: "slides", deckId: "deck-gone", remember: true }]), NOW);
    expect(await listItemMappings()).toEqual([]);
  });

  it("labels a removed slides row with its deck name, falling back to Slides", async () => {
    const first = await importPlan(
      client,
      req([
        { itemId: "s1", kind: "slides", deckId: "deck-cw" },
        { itemId: "s2", kind: "slides", deckId: "deck-dox" },
      ]),
      NOW,
    );
    await decks.deleteDeck("deck-dox");
    const shrunk: PcoClient = { ...fakeClient, getPlanItems: async () => [PLAN[2]!] };
    const result = await importPlan(
      shrunk,
      reimport(first.showId!, [{ itemId: "g3", kind: "graphic", templateId: "tpl-graphic", data: { headline: "Welcome" } }]),
      NOW,
    );
    expect(result.removedRows.map((r) => r.label)).toEqual(["Call to Worship", "Slides"]);
  });
});
// [/P3.11]
