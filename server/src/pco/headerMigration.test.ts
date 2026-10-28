import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { PcoAuthError, type PcoClient } from "./pcoClient";
import { pendingPlanKeys, startHeaderMigration, stopHeaderMigration } from "./headerMigration";
import { reloadShows } from "../shows";

let tmp: string;
let prev: string | undefined;
const showFile = () => path.join(tmp, "shows", "mig.json");
const bakFile = () => `${showFile()}.pre-sections.bak`;
const cacheFile = () => path.join(tmp, "pco", "plan-headers.json");

const ref = (itemId: string, planId = "p1") => ({ provider: "pco", serviceTypeId: "st", planId, itemId });
const showJson = () => ({
  id: "mig",
  name: "Mig",
  projectId: "p",
  songs: [],
  rows: [
    { kind: "graphic", id: "a", templateId: "t", data: { title: "Intro" }, sourceRef: ref("10") },
    { kind: "graphic", id: "b", templateId: "t", data: { title: "Worship" }, sourceRef: ref("11") },
    { kind: "graphic", id: "c", templateId: "t", data: {}, sourceRef: ref("12") },
  ],
  updatedAt: "2026-01-01T00:00:00.000Z",
});

function client(impl: PcoClient["getPlanItems"]): PcoClient {
  return {
    listServiceTypes: vi.fn(),
    listPlans: vi.fn(),
    getPlanItems: vi.fn(impl),
    listSongArrangements: vi.fn(),
    getLive: vi.fn(),
  };
}
const planItems = async () => [
  { id: "10", title: "Intro", itemType: "item" as const },
  { id: "11", title: "Worship", itemType: "header" as const },
  { id: "12", title: "Song", itemType: "item" as const },
];

async function writeShow(): Promise<void> {
  await fs.mkdir(path.dirname(showFile()), { recursive: true });
  await fs.writeFile(showFile(), JSON.stringify(showJson(), null, 2));
  await reloadShows();
}
const exists = (f: string) => fs.access(f).then(() => true, () => false);
const readShow = async () =>
  JSON.parse(await fs.readFile(showFile(), "utf8")) as { sections?: unknown; rows: { id: string; sectionId?: string }[] };

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "overlaysys-hdrmig-"));
  prev = process.env["OVERLAYSYS_DATA_DIR"];
  process.env["OVERLAYSYS_DATA_DIR"] = tmp;
});

afterEach(async () => {
  stopHeaderMigration();
  if (prev === undefined) delete process.env["OVERLAYSYS_DATA_DIR"];
  else process.env["OVERLAYSYS_DATA_DIR"] = prev;
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("pendingPlanKeys", () => {
  it("lists uncached plans of PCO graphic rows", () => {
    const shows = [showJson()] as never;
    expect(pendingPlanKeys(shows, { version: 1, plans: {} })).toEqual(["st/p1"]);
    expect(pendingPlanKeys(shows, { version: 1, plans: { "st/p1": { fetchedAt: "x", unavailable: true } } })).toEqual([]);
  });
});

describe("startHeaderMigration", () => {
  it("no client and no cache writes no show file", async () => {
    await writeShow();
    const before = (await fs.stat(showFile())).mtimeMs;
    await startHeaderMigration({ getClient: () => null, pollMs: 100000 });
    expect((await fs.stat(showFile())).mtimeMs).toBe(before);
    expect(await exists(bakFile())).toBe(false);
    expect(await exists(cacheFile())).toBe(false);
  });

  it("fetches each pending plan once, caches headers, migrates and writes one backup", async () => {
    await writeShow();
    const original = await fs.readFile(showFile(), "utf8");
    const c = client(planItems);
    await startHeaderMigration({ getClient: () => c, pollMs: 100000 });
    expect(c.getPlanItems).toHaveBeenCalledTimes(1);
    expect(await fs.readFile(bakFile(), "utf8")).toBe(original);
    const s = await readShow();
    expect(s.sections).toEqual([{ id: "pco-11", name: "Worship" }]);
    expect(s.rows.map((r) => [r.id, r.sectionId])).toEqual([["a", undefined], ["c", "pco-11"]]);
    expect(JSON.parse(await fs.readFile(cacheFile(), "utf8")).plans["st/p1"].headers).toEqual({ "11": "Worship" });
    // restart: no refetch, no change
    const after = await fs.readFile(showFile(), "utf8");
    await startHeaderMigration({ getClient: () => c, pollMs: 100000 });
    expect(c.getPlanItems).toHaveBeenCalledTimes(1);
    expect(await fs.readFile(showFile(), "utf8")).toBe(after);
  });

  it("never overwrites an existing .pre-sections.bak", async () => {
    await writeShow();
    await fs.writeFile(bakFile(), "KEEP");
    await startHeaderMigration({ getClient: () => client(planItems), pollMs: 100000 });
    expect(await fs.readFile(bakFile(), "utf8")).toBe("KEEP");
    expect((await readShow()).sections).toBeDefined();
  });

  it("marks a plan unavailable on a 404 and does not refetch it", async () => {
    await writeShow();
    const c = client(async () => {
      throw new Error("Planning Center request failed (404): x");
    });
    await startHeaderMigration({ getClient: () => c, pollMs: 100000 });
    await startHeaderMigration({ getClient: () => c, pollMs: 100000 });
    expect(c.getPlanItems).toHaveBeenCalledTimes(1);
    expect(JSON.parse(await fs.readFile(cacheFile(), "utf8")).plans["st/p1"].unavailable).toBe(true);
    expect(await exists(bakFile())).toBe(false);
  });

  it("stops on PcoAuthError and leaves the plan pending", async () => {
    await writeShow();
    const c = client(async () => {
      throw new PcoAuthError();
    });
    await startHeaderMigration({ getClient: () => c, pollMs: 100000 });
    expect(await exists(cacheFile())).toBe(false);
    expect(await exists(bakFile())).toBe(false);
    const ok = client(planItems);
    await startHeaderMigration({ getClient: () => ok, pollMs: 100000 });
    expect(ok.getPlanItems).toHaveBeenCalledTimes(1);
  });
});
