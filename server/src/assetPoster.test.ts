import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import Fastify, { type FastifyInstance } from "fastify";
import ffmpegPath from "ffmpeg-static";
import { registerAssetRoutes } from "./assets";

/**
 * `GET /api/assets/poster/:filename` — a JPEG frame of a stored video for
 * rundown thumbnails, generated on first request and cached.
 */

const SHA = "b".repeat(64);
let tmpDir: string;
let prevDataDir: string | undefined;
let app: FastifyInstance;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "overlaysys-poster-"));
  prevDataDir = process.env["OVERLAYSYS_DATA_DIR"];
  process.env["OVERLAYSYS_DATA_DIR"] = tmpDir;
  await fs.mkdir(path.join(tmpDir, "assets"), { recursive: true });
  app = Fastify();
  await registerAssetRoutes(app);
});

afterEach(async () => {
  await app.close();
  if (prevDataDir === undefined) delete process.env["OVERLAYSYS_DATA_DIR"];
  else process.env["OVERLAYSYS_DATA_DIR"] = prevDataDir;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function makeClip(name: string, seconds: number) {
  const out = path.join(tmpDir, "assets", name);
  const r = spawnSync(ffmpegPath as unknown as string, [
    "-y", "-f", "lavfi", "-i", `testsrc=size=320x180:rate=10:duration=${seconds}`,
    "-pix_fmt", "yuv420p", out,
  ]);
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr.toString()}`);
}

describe("GET /api/assets/poster/:filename", () => {
  it("returns a cached JPEG frame of the video", async () => {
    makeClip(`${SHA}.mp4`, 2);
    const res = await app.inject({ method: "GET", url: `/api/assets/poster/${SHA}.mp4` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("image/jpeg");
    expect(res.rawPayload.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    // Cached under a dot-dir so the asset listing and static store ignore it.
    const cached = await fs.stat(path.join(tmpDir, "assets", ".posters", `${SHA}.mp4.jpg`));
    expect(cached.size).toBeGreaterThan(0);
    const listing = await app.inject({ method: "GET", url: "/api/assets" });
    expect(listing.json().assets.map((a: { name: string }) => a.name)).toEqual([`${SHA}.mp4`]);
  }, 20_000);

  it("falls back to the first frame for clips shorter than the seek point", async () => {
    makeClip(`${SHA}.webm`, 0.5);
    const res = await app.inject({ method: "GET", url: `/api/assets/poster/${SHA}.webm` });
    expect(res.statusCode).toBe(200);
  }, 20_000);

  it("rejects unsafe or non-video names and 404s missing files", async () => {
    expect((await app.inject({ method: "GET", url: "/api/assets/poster/..%2Fx.mp4" })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: `/api/assets/poster/${SHA}.png` })).statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: `/api/assets/poster/${"c".repeat(64)}.mp4` })).statusCode).toBe(404);
  });
});
