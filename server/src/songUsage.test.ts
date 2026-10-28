import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  DEDUPE_WINDOW_MS,
  readSongUses,
  recordSongUse,
  resetSongUsageMemory,
  songUsesToCsv,
  summarizeSongUses,
} from "./songUsage";

let tmpDir: string;
let prevDataDir: string | undefined;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "overlaysys-usage-"));
  prevDataDir = process.env["OVERLAYSYS_DATA_DIR"];
  process.env["OVERLAYSYS_DATA_DIR"] = tmpDir;
  resetSongUsageMemory();
});

afterEach(async () => {
  if (prevDataDir === undefined) delete process.env["OVERLAYSYS_DATA_DIR"];
  else process.env["OVERLAYSYS_DATA_DIR"] = prevDataDir;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

const grace = { id: "grace", title: "Amazing Grace", ccliNumber: "22025", author: "John Newton" };
const other = { id: "other", title: "Other, Song" };

describe("recordSongUse / readSongUses", () => {
  it("appends a line per use and reads it back", async () => {
    const t0 = new Date("2026-10-04T15:00:00Z");
    expect(await recordSongUse(grace, "pgm", t0)).toBe(true);
    const got = await readSongUses();
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ songId: "grace", ccliNumber: "22025", channel: "pgm" });
  });

  it("dedupes re-takes of the same song inside the window", async () => {
    const t0 = new Date("2026-10-04T15:00:00Z");
    await recordSongUse(grace, "pgm", t0);
    expect(await recordSongUse(grace, "pgm", new Date(t0.getTime() + 60_000))).toBe(false);
    expect(await recordSongUse(grace, "pgm", new Date(t0.getTime() + DEDUPE_WINDOW_MS + 1))).toBe(true);
    expect(await readSongUses()).toHaveLength(2);
  });

  it("filters by range and skips torn lines", async () => {
    await recordSongUse(grace, "pgm", new Date("2026-10-04T15:00:00Z"));
    await recordSongUse(other, "pgm", new Date("2026-10-11T15:00:00Z"));
    await fs.appendFile(path.join(tmpDir, "usage", "song-usage.jsonl"), '{"at":"2026-10-1', "utf8");
    const got = await readSongUses({ from: new Date("2026-10-05"), to: new Date("2026-10-12") });
    expect(got.map((e) => e.songId)).toEqual(["other"]);
  });

  it("returns [] when nothing has been logged", async () => {
    expect(await readSongUses()).toEqual([]);
  });
});

describe("summary + CSV", () => {
  it("aggregates per song and escapes CSV", () => {
    const summary = summarizeSongUses([
      { at: "2026-10-04T15:00:00.000Z", songId: "grace", title: "Amazing Grace", ccliNumber: "22025", channel: "pgm" },
      { at: "2026-10-11T15:00:00.000Z", songId: "grace", title: "Amazing Grace", ccliNumber: "22025", channel: "pgm" },
      { at: "2026-10-11T15:10:00.000Z", songId: "other", title: 'Other, "Song"', channel: "pgm" },
      { at: "2026-10-11T15:20:00.000Z", songId: "evil", title: "=HYPERLINK(1)", channel: "pgm" },
    ]);
    expect(summary[0]).toMatchObject({ songId: "grace", uses: 2, firstUsed: "2026-10-04T15:00:00.000Z" });
    const csv = songUsesToCsv(summary);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("Title,CCLI Song #,Author,Copyright,Times Used,First Used,Last Used");
    expect(lines[1]).toBe("Amazing Grace,22025,,,2,2026-10-04,2026-10-11");
    expect(csv).toContain('"Other, ""Song"""');
    expect(csv).toContain("'=HYPERLINK(1)");
  });
});
