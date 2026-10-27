import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  BUILT_IN_STAGE_LAYOUTS,
  SPEAKER_LAYOUT,
  StageLayoutSchema,
  type StageLayout,
} from "@overlaysys/core";
import * as storage from "./storage";
import * as stageLayouts from "./stageLayouts";
import { ReadOnlyLayoutError } from "./stageLayouts";

let tmpDir: string;
let prevDataDir: string | undefined;
let prevFixturesDir: string | undefined;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "overlaysys-stage-layouts-"));
  prevDataDir = process.env["OVERLAYSYS_DATA_DIR"];
  prevFixturesDir = process.env["OVERLAYSYS_FIXTURES_DIR"];
  process.env["OVERLAYSYS_DATA_DIR"] = tmpDir;
  process.env["OVERLAYSYS_FIXTURES_DIR"] = tmpDir;
  await stageLayouts.reloadStageLayouts();
});

afterEach(async () => {
  if (prevDataDir === undefined) delete process.env["OVERLAYSYS_DATA_DIR"];
  else process.env["OVERLAYSYS_DATA_DIR"] = prevDataDir;
  if (prevFixturesDir === undefined) delete process.env["OVERLAYSYS_FIXTURES_DIR"];
  else process.env["OVERLAYSYS_FIXTURES_DIR"] = prevFixturesDir;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

const mine = (over: Partial<StageLayout> = {}): StageLayout =>
  StageLayoutSchema.parse({ id: "stage-layout-aaaa1111", name: "Mine", widgets: [], ...over });

// Task 2 adds Lyrics/Scripture to BUILT_IN_STAGE_LAYOUTS; derive from the
// list so these tests hold before and after it lands.
const builtInIds = BUILT_IN_STAGE_LAYOUTS.map((l) => l.id);
const lastBuiltIn = BUILT_IN_STAGE_LAYOUTS[BUILT_IN_STAGE_LAYOUTS.length - 1]!;

describe("stage layouts registry", () => {
  it("lists built-ins first, then stored", async () => {
    await stageLayouts.saveStageLayout(mine());
    const metas = await stageLayouts.listStageLayoutMetas();
    expect(metas.map((m) => m.id)).toEqual([...builtInIds, "stage-layout-aaaa1111"]);
    expect(metas.slice(0, builtInIds.length).every((m) => m.builtIn)).toBe(true);
    expect(metas[metas.length - 1]!.builtIn).toBe(false);
  });

  it("orders stored layouts by name", async () => {
    await stageLayouts.saveStageLayout(mine({ id: "stage-layout-bbbb2222", name: "Zed" }));
    await stageLayouts.saveStageLayout(mine({ id: "stage-layout-cccc3333", name: "Alpha" }));
    const metas = await stageLayouts.listStageLayoutMetas();
    expect(metas.slice(builtInIds.length).map((m) => m.name)).toEqual(["Alpha", "Zed"]);
  });

  it("save stamps updatedAt and persists to data/stage-layouts", async () => {
    const saved = await stageLayouts.saveStageLayout(mine());
    expect(saved.updatedAt).toBeTruthy();
    const raw = JSON.parse(
      await fs.readFile(path.join(tmpDir, "stage-layouts", "stage-layout-aaaa1111.json"), "utf8"),
    );
    expect(raw.name).toBe("Mine");
  });

  it("strips builtIn on save", async () => {
    const saved = await stageLayouts.saveStageLayout(mine({ builtIn: true }));
    expect(saved.builtIn).toBeUndefined();
  });

  it("rejects saving a built-in id", async () => {
    await expect(
      stageLayouts.saveStageLayout({ ...SPEAKER_LAYOUT, name: "Hacked" }),
    ).rejects.toBeInstanceOf(ReadOnlyLayoutError);
    expect((await stageLayouts.getStageLayout("speaker"))!.name).toBe("Speaker");
  });

  it("a stored file with a built-in id never shadows it", async () => {
    await storage.saveStageLayout({ ...SPEAKER_LAYOUT, name: "Shadow", builtIn: undefined });
    await stageLayouts.reloadStageLayouts();
    expect((await stageLayouts.getStageLayout("speaker"))!.name).toBe("Speaker");
    expect((await stageLayouts.resolveStageLayout("speaker")).name).toBe("Speaker");
  });

  it("delete tombstones; built-ins can't be deleted", async () => {
    await stageLayouts.saveStageLayout(mine());
    expect(await stageLayouts.deleteStageLayout("stage-layout-aaaa1111")).toBe(true);
    expect(await stageLayouts.getStageLayout("stage-layout-aaaa1111")).toBeNull();
    expect((await storage.loadAllStageLayouts())[0]!.deletedAt).toBeTruthy();
    expect(await stageLayouts.deleteStageLayout("speaker")).toBe(false);
    expect(await stageLayouts.deleteStageLayout("nope")).toBe(false);
  });

  it("duplicates a built-in into an editable copy", async () => {
    const copy = (await stageLayouts.duplicateStageLayout(lastBuiltIn.id))!;
    expect(copy.id).toMatch(/^stage-layout-[0-9a-f]{8}$/);
    expect(copy.name).toBe(`${lastBuiltIn.name} (copy)`);
    expect(copy.builtIn).toBeUndefined();
    expect(copy.widgets).toEqual(lastBuiltIn.widgets);
    expect(await stageLayouts.getStageLayout(copy.id)).not.toBeNull();
    expect(await stageLayouts.duplicateStageLayout("nope")).toBeNull();
  });

  it("resolve: stored → built-in → Speaker (deleted / unknown / undefined)", async () => {
    await stageLayouts.saveStageLayout(mine());
    expect((await stageLayouts.resolveStageLayout("stage-layout-aaaa1111")).name).toBe("Mine");
    expect((await stageLayouts.resolveStageLayout(lastBuiltIn.id)).id).toBe(lastBuiltIn.id);
    await stageLayouts.deleteStageLayout("stage-layout-aaaa1111");
    expect((await stageLayouts.resolveStageLayout("stage-layout-aaaa1111")).id).toBe("speaker");
    expect((await stageLayouts.resolveStageLayout("unknown")).id).toBe("speaker");
    expect((await stageLayouts.resolveStageLayout(undefined)).id).toBe("speaker");
  });
});
