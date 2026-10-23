import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { ShowSchema, type Show } from "@overlaysys/core";
import * as storage from "./storage";
import { FsStorageAdapter } from "./fsStorageAdapter";

// The cloud `shows` table has no sermon-notes column yet, so a pulled show
// arrives without `sermonNotes`. The local replica must not lose them.

let tmpDir: string;
let prevDataDir: string | undefined;
let prevFixturesDir: string | undefined;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "overlaysys-fsadapter-"));
  prevDataDir = process.env["OVERLAYSYS_DATA_DIR"];
  prevFixturesDir = process.env["OVERLAYSYS_FIXTURES_DIR"];
  process.env["OVERLAYSYS_DATA_DIR"] = tmpDir;
  process.env["OVERLAYSYS_FIXTURES_DIR"] = tmpDir;
});

afterEach(async () => {
  if (prevDataDir === undefined) delete process.env["OVERLAYSYS_DATA_DIR"];
  else process.env["OVERLAYSYS_DATA_DIR"] = prevDataDir;
  if (prevFixturesDir === undefined) delete process.env["OVERLAYSYS_FIXTURES_DIR"];
  else process.env["OVERLAYSYS_FIXTURES_DIR"] = prevFixturesDir;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function makeShow(extra: Partial<Show> = {}): Show {
  return ShowSchema.parse({ id: "show-1", name: "Sunday", projectId: "p", rows: [], songs: [], ...extra });
}

const notes = [{ id: "n1", title: "Grace", body: "# One" }];

describe("FsStorageAdapter.saveShow keeps local sermon notes", () => {
  it("a pulled show without sermonNotes keeps the local ones", async () => {
    await storage.saveShow(makeShow({ sermonNotes: notes }));
    const pulled = makeShow({ name: "Renamed in cloud" });
    delete (pulled as { sermonNotes?: unknown }).sermonNotes;
    await new FsStorageAdapter().saveShow("org", pulled);
    const saved = await storage.loadShow("show-1");
    expect(saved?.name).toBe("Renamed in cloud");
    expect(saved?.sermonNotes).toEqual(notes);
  });

  it("an explicit [] still clears them", async () => {
    await storage.saveShow(makeShow({ sermonNotes: notes }));
    await new FsStorageAdapter().saveShow("org", makeShow({ sermonNotes: [] }));
    expect((await storage.loadShow("show-1"))?.sermonNotes).toEqual([]);
  });

  it("a brand-new show saves as-is", async () => {
    await new FsStorageAdapter().saveShow("org", makeShow());
    expect((await storage.loadShow("show-1"))?.sermonNotes).toBeUndefined();
  });
});
