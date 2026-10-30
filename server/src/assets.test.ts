import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";

/**
 * Asset store write paths: the upload route's temp file and encoder output
 * never outlive a failure, and the raw PUT only stores bytes that match the
 * hash in their filename. The encoder is mocked — no ffmpeg spawns here.
 */

vi.mock("./transcode", () => ({
  planTranscode: vi.fn(async () => ({ kind: "h264-mp4", finalExt: ".mp4" })),
  transcodeToMp4: vi.fn(),
  transcodeToWebmAlpha: vi.fn(),
  extractPoster: vi.fn(),
}));

import { transcodeToMp4 } from "./transcode";
import { registerAssetRoutes } from "./assets";

const encode = vi.mocked(transcodeToMp4);

let tmpDir: string;
let prevDataDir: string | undefined;
let app: FastifyInstance;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "overlaysys-assets-"));
  prevDataDir = process.env["OVERLAYSYS_DATA_DIR"];
  process.env["OVERLAYSYS_DATA_DIR"] = tmpDir;
  encode.mockReset();
  app = Fastify();
  await registerAssetRoutes(app);
});

afterEach(async () => {
  await app.close();
  if (prevDataDir === undefined) delete process.env["OVERLAYSYS_DATA_DIR"];
  else process.env["OVERLAYSYS_DATA_DIR"] = prevDataDir;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

const assetsDir = (): string => path.join(tmpDir, "assets");
const sha = (b: Buffer): string => crypto.createHash("sha256").update(b).digest("hex");

function multipart(filename: string, mime: string, bytes: Buffer, close = true) {
  const boundary = "----overlaysys-test";
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${mime}\r\n\r\n`,
  );
  const tail = Buffer.from(close ? `\r\n--${boundary}--\r\n` : "");
  return {
    payload: Buffer.concat([head, bytes, tail]),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

function upload(filename: string, mime: string, bytes: Buffer, close = true) {
  return app.inject({ method: "POST", url: "/api/assets", ...multipart(filename, mime, bytes, close) });
}

describe("POST /api/assets (transcode)", () => {
  const SRC = Buffer.from("not really a mov");

  it("encodes to a temp file and renames it into place on success", async () => {
    let dst = "";
    encode.mockImplementation(async (_src, out) => {
      dst = out;
      await fs.writeFile(out, "encoded");
    });
    const res = await upload("clip.mov", "video/quicktime", SRC);
    expect(res.statusCode).toBe(200);
    const finalName = `${sha(SRC)}.mp4`;
    expect(res.json().url).toBe(`/assets/${finalName}`);
    expect(dst).not.toBe(path.join(assetsDir(), finalName));
    expect(path.dirname(dst)).toBe(assetsDir());
    expect(await fs.readdir(assetsDir())).toEqual([finalName]);
    expect(await fs.readFile(path.join(assetsDir(), finalName), "utf8")).toBe("encoded");
  });

  it("leaves no partial output or temp file when the encoder fails", async () => {
    encode.mockImplementation(async (_src, out) => {
      await fs.writeFile(out, "half an mp4");
      throw new Error("ffmpeg exploded");
    });
    const res = await upload("clip.mov", "video/quicktime", SRC);
    expect(res.statusCode).toBe(500);
    expect(await fs.readdir(assetsDir())).toEqual([]);
  });

  it("shares one encode between concurrent uploads of the same source", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    encode.mockImplementation(async (_src, out) => {
      await gate;
      await fs.writeFile(out, "encoded");
    });
    const a = upload("clip.mov", "video/quicktime", SRC);
    const b = upload("clip.mov", "video/quicktime", SRC);
    await vi.waitFor(() => expect(encode).toHaveBeenCalled());
    // Give the second request time to reach the encode step.
    await new Promise((r) => setTimeout(r, 50));
    release();
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.statusCode).toBe(200);
    expect(rb.statusCode).toBe(200);
    expect(encode).toHaveBeenCalledTimes(1);
    expect(await fs.readdir(assetsDir())).toEqual([`${sha(SRC)}.mp4`]);
  });
});

describe("POST /api/assets (aborted upload)", () => {
  it("deletes its temp file when the upload stream errors", async () => {
    const res = await upload("pic.png", "image/png", Buffer.alloc(4096, 1), false);
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(await fs.readdir(assetsDir())).toEqual([]);
  });
});

describe("PUT /api/assets/raw/:filename", () => {
  const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

  function put(filename: string, bytes: Buffer) {
    return app.inject({
      method: "PUT",
      url: `/api/assets/raw/${filename}`,
      payload: { base64: bytes.toString("base64") },
    });
  }

  it("rejects bytes whose sha256 doesn't match the filename", async () => {
    const res = await put(`${"a".repeat(64)}.svg`, SVG);
    expect(res.statusCode).toBe(400);
    expect(await fs.readdir(assetsDir())).toEqual([]);
  });

  it("stores bytes under their own hash, leaving no temp file", async () => {
    const name = `${sha(SVG)}.svg`;
    const res = await put(name, SVG);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ filename: name, written: true });
    expect(await fs.readdir(assetsDir())).toEqual([name]);
  });
});

describe("GET /assets/<file>", () => {
  it("serves SVGs with a script-blocking CSP and nosniff", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
    const name = `${sha(svg)}.svg`;
    await fs.writeFile(path.join(assetsDir(), name), svg);
    const res = await app.inject({ method: "GET", url: `/assets/${name}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-security-policy"]).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
    );
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("doesn't put the SVG CSP on other assets", async () => {
    const png = Buffer.from("png-ish");
    const name = `${sha(png)}.png`;
    await fs.writeFile(path.join(assetsDir(), name), png);
    const res = await app.inject({ method: "GET", url: `/assets/${name}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-security-policy"]).toBeUndefined();
  });
});
