import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { PcoAuthError, PcoHttpError, type PcoClient } from "./pcoClient";
import { pendingPlanKeys, startHeaderMigration, stopHeaderMigration } from "./headerMigration";
import { reloadShows, saveShow, getShow } from "../shows";

const onChanged = vi.fn();
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
  onChanged.mockClear();
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
    await startHeaderMigration({ getClient: () => null, pollMs: 100000, onChanged });
    expect((await fs.stat(showFile())).mtimeMs).toBe(before);
    expect(await exists(bakFile())).toBe(false);
    expect(await exists(cacheFile())).toBe(false);
  });

  it("fetches each pending plan once, caches headers, migrates and writes one backup", async () => {
    await writeShow();
    const original = await fs.readFile(showFile(), "utf8");
    const c = client(planItems);
    await startHeaderMigration({ getClient: () => c, pollMs: 100000, onChanged });
    expect(c.getPlanItems).toHaveBeenCalledTimes(1);
    expect(await fs.readFile(bakFile(), "utf8")).toBe(original);
    const s = await readShow();
    expect(s.sections).toEqual([{ id: "pco-11", name: "Worship" }]);
    expect(s.rows.map((r) => [r.id, r.sectionId])).toEqual([["a", undefined], ["c", "pco-11"]]);
    expect(JSON.parse(await fs.readFile(cacheFile(), "utf8")).plans["st/p1"].headers).toEqual({ "11": "Worship" });
    // restart: no refetch, no change
    const after = await fs.readFile(showFile(), "utf8");
    await startHeaderMigration({ getClient: () => c, pollMs: 100000, onChanged });
    expect(c.getPlanItems).toHaveBeenCalledTimes(1);
    expect(await fs.readFile(showFile(), "utf8")).toBe(after);
  });

  it("never overwrites an existing .pre-sections.bak", async () => {
    await writeShow();
    await fs.writeFile(bakFile(), "KEEP");
    await startHeaderMigration({ getClient: () => client(planItems), pollMs: 100000, onChanged });
    expect(await fs.readFile(bakFile(), "utf8")).toBe("KEEP");
    expect((await readShow()).sections).toBeDefined();
  });

  it("marks a plan unavailable on a 404 and does not refetch it", async () => {
    await writeShow();
    const c = client(async () => {
      throw new PcoHttpError(404, "Planning Center request failed (404): x");
    });
    await startHeaderMigration({ getClient: () => c, pollMs: 100000, onChanged });
    await startHeaderMigration({ getClient: () => c, pollMs: 100000, onChanged });
    expect(c.getPlanItems).toHaveBeenCalledTimes(1);
    expect(JSON.parse(await fs.readFile(cacheFile(), "utf8")).plans["st/p1"].unavailable).toBe(true);
    expect(await exists(bakFile())).toBe(false);
  });

  it("stops on PcoAuthError and leaves the plan pending", async () => {
    await writeShow();
    const c = client(async () => {
      throw new PcoAuthError();
    });
    await startHeaderMigration({ getClient: () => c, pollMs: 100000, onChanged });
    expect(await exists(cacheFile())).toBe(false);
    expect(await exists(bakFile())).toBe(false);
    const ok = client(planItems);
    await startHeaderMigration({ getClient: () => ok, pollMs: 100000, onChanged });
    expect(ok.getPlanItems).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["503", () => new PcoHttpError(503, "down")],
    ["429", () => new PcoHttpError(429, "slow down")],
    ["network error", () => new TypeError("fetch failed")],
  ])("a %s leaves the plan pending and refetches next time", async (_n, mk) => {
    await writeShow();
    const bad = client(async () => {
      throw mk();
    });
    await startHeaderMigration({ getClient: () => bad, pollMs: 100000, onChanged });
    expect(await exists(cacheFile())).toBe(false);
    const ok = client(planItems);
    await startHeaderMigration({ getClient: () => ok, pollMs: 100000, onChanged });
    expect(ok.getPlanItems).toHaveBeenCalledTimes(1);
    expect(await exists(bakFile())).toBe(true);
  });

  it("a 410 marks the plan unavailable", async () => {
    await writeShow();
    const c = client(async () => {
      throw new PcoHttpError(410, "gone");
    });
    await startHeaderMigration({ getClient: () => c, pollMs: 100000, onChanged });
    expect(JSON.parse(await fs.readFile(cacheFile(), "utf8")).plans["st/p1"].unavailable).toBe(true);
  });

  it("notifies once with the saved shows", async () => {
    await writeShow();
    await startHeaderMigration({ getClient: () => client(planItems), pollMs: 100000, onChanged });
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(onChanged.mock.calls[0]![0].map((x: { id: string }) => x.id)).toEqual(["mig"]);
  });

  it("skips a show whose header row is live, then migrates it once it is not", async () => {
    await writeShow();
    const c = client(planItems);
    await startHeaderMigration({ getClient: () => c, pollMs: 100000, onChanged, isRowLive: (_s, r) => r === "b" });
    expect(await exists(bakFile())).toBe(false);
    expect((await readShow()).sections).toBeUndefined();
    expect(onChanged).not.toHaveBeenCalled();
    await startHeaderMigration({ getClient: () => c, pollMs: 100000, onChanged, isRowLive: () => false });
    expect((await readShow()).sections).toBeDefined();
    expect(c.getPlanItems).toHaveBeenCalledTimes(1);
  });

  it("does not overwrite an edit saved while the backup is being taken", async () => {
    await writeShow();
    const realCopy = fs.copyFile.bind(fs);
    const spy = vi.spyOn(fs, "copyFile").mockImplementation(async (...args) => {
      const cur = JSON.parse(JSON.stringify(showJson())) as ReturnType<typeof showJson>;
      cur.rows.push({ kind: "graphic", id: "late", templateId: "t", data: {} } as never);
      await saveShow(cur as never); // an operator edit lands while the backup is being taken
      return realCopy(...args);
    });
    await startHeaderMigration({ getClient: () => client(planItems), pollMs: 100000, onChanged });
    spy.mockRestore();
    const s = await readShow();
    expect(s.rows.map((r) => r.id)).toContain("late");
    expect(s.sections).toBeDefined();
    expect((await getShow("mig"))!.rows.map((r) => r.id)).toContain("late");
  });

  it("leaves a show without header rows untouched (updatedAt, mtime)", async () => {
    await writeShow();
    const other = { ...showJson(), id: "plain", rows: [{ kind: "graphic", id: "z", templateId: "t", data: {} }] };
    const otherFile = path.join(tmp, "shows", "plain.json");
    await fs.writeFile(otherFile, JSON.stringify(other));
    await reloadShows();
    const before = (await fs.stat(otherFile)).mtimeMs;
    await startHeaderMigration({ getClient: () => client(planItems), pollMs: 100000, onChanged });
    expect((await fs.stat(otherFile)).mtimeMs).toBe(before);
    expect(JSON.parse(await fs.readFile(otherFile, "utf8")).updatedAt).toBe(other.updatedAt);
    expect(await exists(`${otherFile}.pre-sections.bak`)).toBe(false);
  });
});
