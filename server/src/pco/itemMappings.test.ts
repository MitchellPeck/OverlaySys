import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  deleteItemMapping,
  listItemMappings,
  putItemMapping,
  reloadItemMappings,
  upsertItemMapping,
} from "./itemMappings";

let tmpDir: string;
let prev: string | undefined;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "overlaysys-mappings-"));
  prev = process.env["OVERLAYSYS_DATA_DIR"];
  process.env["OVERLAYSYS_DATA_DIR"] = tmpDir;
  await reloadItemMappings();
});

afterEach(async () => {
  if (prev === undefined) delete process.env["OVERLAYSYS_DATA_DIR"];
  else process.env["OVERLAYSYS_DATA_DIR"] = prev;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("pco item mappings", () => {
  it("upsert by key, tombstone on delete, list hides tombstones", async () => {
    const m = await upsertItemMapping({ key: "title:gloria patri", kind: "slides", deckId: "d1" });
    expect(m.id).toBe("title:gloria patri");
    await upsertItemMapping({ key: "title:gloria patri", kind: "slides", deckId: "d2" });
    expect((await listItemMappings()).map((x) => x.deckId)).toEqual(["d2"]);
    await deleteItemMapping(m.id);
    expect(await listItemMappings()).toEqual([]);
    expect((await listItemMappings({ includeDeleted: true }))[0]!.deletedAt).toBeTruthy();
  });

  it("upserting a tombstoned key clears deletedAt and persists across reload", async () => {
    await upsertItemMapping({ key: "k", kind: "slides", deckId: "d1" });
    await deleteItemMapping("k");
    await upsertItemMapping({ key: "k", kind: "slides", deckId: "d3" });
    await reloadItemMappings();
    const list = await listItemMappings({ includeDeleted: true });
    expect(list).toHaveLength(1);
    expect(list[0]!.deletedAt).toBeUndefined();
    expect(list[0]!.deckId).toBe("d3");
  });

  it("putItemMapping stores as-is", async () => {
    await putItemMapping({
      id: "x",
      key: "x",
      kind: "slides",
      deckId: "d",
      updatedAt: "2026-01-01T00:00:00.000Z",
      deletedAt: "2026-01-02T00:00:00.000Z",
    });
    const [m] = await listItemMappings({ includeDeleted: true });
    expect(m!.updatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(m!.deletedAt).toBe("2026-01-02T00:00:00.000Z");
  });
});
