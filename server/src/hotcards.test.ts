import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { HotcardSchema, initialHotkeyAssignments, type Hotcard } from "@overlaysys/core";
import * as hotcards from "./hotcards";

/**
 * Hotcard F-keys are an explicit per-card `hotkey` (Default D6a). Cards
 * from before that get a one-time assignment at boot that keeps the order
 * the list showed, and the result is saved so restarts can't reshuffle it.
 */

let tmpDir: string;
let prevDataDir: string | undefined;
let prevFixturesDir: string | undefined;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "overlaysys-hotcards-"));
  prevDataDir = process.env["OVERLAYSYS_DATA_DIR"];
  prevFixturesDir = process.env["OVERLAYSYS_FIXTURES_DIR"];
  process.env["OVERLAYSYS_DATA_DIR"] = tmpDir;
  process.env["OVERLAYSYS_FIXTURES_DIR"] = tmpDir;
  await fs.mkdir(path.join(tmpDir, "hotcards"), { recursive: true });
});

afterEach(async () => {
  if (prevDataDir === undefined) delete process.env["OVERLAYSYS_DATA_DIR"];
  else process.env["OVERLAYSYS_DATA_DIR"] = prevDataDir;
  if (prevFixturesDir === undefined) delete process.env["OVERLAYSYS_FIXTURES_DIR"];
  else process.env["OVERLAYSYS_FIXTURES_DIR"] = prevFixturesDir;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function writeCard(card: Partial<Hotcard> & { id: string }): Promise<void> {
  const full = { name: card.id, templateId: "lower-third", data: {}, projectId: "p1", ...card };
  await fs.writeFile(path.join(tmpDir, "hotcards", `${card.id}.json`), JSON.stringify(full));
}

async function readCard(id: string): Promise<Hotcard> {
  return HotcardSchema.parse(JSON.parse(await fs.readFile(path.join(tmpDir, "hotcards", `${id}.json`), "utf8")));
}

const keysOf = async () => Object.fromEntries((await hotcards.listHotcardMetas()).map((m) => [m.id, m.hotkey]));

describe("hotcard hotkey migration", () => {
  it("assigns F-keys once per project, saves them, and passes hotkey through in metas", async () => {
    await writeCard({ id: "hotcard-a" });
    await writeCard({ id: "hotcard-b" });
    await writeCard({ id: "hotcard-c", projectId: "p2" });
    await writeCard({ id: "hotcard-dead", deletedAt: "2026-01-01T00:00:00.000Z" });
    await hotcards.reloadHotcards();

    const keys = await keysOf();
    expect(new Set([keys["hotcard-a"], keys["hotcard-b"]])).toEqual(new Set(["F1", "F2"]));
    expect(keys["hotcard-c"]).toBe("F1");
    expect((await readCard("hotcard-a")).hotkey).toBe(keys["hotcard-a"]);
    expect((await readCard("hotcard-c")).hotkey).toBe("F1");
    // Tombstones aren't listed, so they don't take a key.
    expect((await readCard("hotcard-dead")).hotkey).toBeUndefined();
  });

  it("is idempotent: a restart (in any readdir order) keeps the same keys", async () => {
    await writeCard({ id: "hotcard-a" });
    await writeCard({ id: "hotcard-b" });
    await writeCard({ id: "hotcard-c" });
    await hotcards.reloadHotcards();
    const first = await keysOf();

    await hotcards.reloadHotcards();
    expect(await keysOf()).toEqual(first);

    // The saved cards need no further assignment whatever order they load in.
    const saved = await Promise.all(["hotcard-c", "hotcard-b", "hotcard-a"].map(readCard));
    expect(initialHotkeyAssignments(saved).size).toBe(0);
  });

  it("doesn't re-assign keys an operator cleared, or touch a project with keys", async () => {
    await writeCard({ id: "hotcard-a", hotkey: null });
    await writeCard({ id: "hotcard-b", hotkey: null });
    await writeCard({ id: "hotcard-c", projectId: "p2", hotkey: "F7" });
    await writeCard({ id: "hotcard-d", projectId: "p2" });
    await hotcards.reloadHotcards();
    expect(await keysOf()).toEqual({ "hotcard-a": null, "hotcard-b": null, "hotcard-c": "F7", "hotcard-d": undefined });
  });

  it("saves new cards as decided and gives a duplicate no key", async () => {
    await hotcards.reloadHotcards();
    const saved = await hotcards.saveHotcard({ id: "hotcard-n", name: "N", templateId: "t", data: {}, projectId: "p1", hotkey: "F3" });
    expect(saved.hotkey).toBe("F3");
    const fresh = await hotcards.saveHotcard({ id: "hotcard-m", name: "M", templateId: "t", data: {}, projectId: "p1" });
    expect(fresh.hotkey).toBeNull();
    const copy = await hotcards.duplicateHotcard("hotcard-n");
    expect(copy?.hotkey).toBeNull();
  });
});
