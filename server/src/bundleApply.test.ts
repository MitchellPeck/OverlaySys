import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import type { Hotcard, Show, Template } from "@overlaysys/core";
import {
  extractAssetFilename,
  liftDataUrl,
  liftHotcard,
  liftShow,
  liftTemplate,
  rewriteAssetUrlsInHotcard,
  rewriteAssetUrlsInShow,
  rewriteAssetUrlsInTemplate,
  writeBundledAsset,
} from "./bundleApply";

let tmpDir: string;
let prevDataDir: string | undefined;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "overlaysys-bundle-apply-"));
  prevDataDir = process.env["OVERLAYSYS_DATA_DIR"];
  process.env["OVERLAYSYS_DATA_DIR"] = tmpDir;
});

afterEach(async () => {
  if (prevDataDir === undefined) delete process.env["OVERLAYSYS_DATA_DIR"];
  else process.env["OVERLAYSYS_DATA_DIR"] = prevDataDir;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

function emptyTimeline() {
  return { duration: 0, tracks: [] };
}

function makeTemplate(partial: Partial<Template> = {}): Template {
  return {
    id: "t1",
    name: "t1",
    size: { w: 1920, h: 1080 },
    fields: [],
    layers: [],
    timelines: { in: emptyTimeline(), out: emptyTimeline() },
    fonts: [],
    ...partial,
  };
}

// Tiny 1×1 transparent PNG. Stable, valid bytes — sha256 is deterministic.
const ONE_PX_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
const ONE_PX_PNG_DATA_URL = `data:image/png;base64,${ONE_PX_PNG_B64}`;
// Compute the sha at module init so the test compares against the same
// hash the bundleApply pipeline will derive (rather than a pinned magic
// constant that could drift if the encoding logic ever changes).
const ONE_PX_PNG_SHA = crypto
  .createHash("sha256")
  .update(Buffer.from(ONE_PX_PNG_B64, "base64"))
  .digest("hex");

describe("liftDataUrl", () => {
  it("decodes a base64 data URL, writes it to data/assets/, and returns /assets/<sha>.<ext>", async () => {
    const out = await liftDataUrl(ONE_PX_PNG_DATA_URL);
    expect(out).toBe(`/assets/${ONE_PX_PNG_SHA}.png`);
    const written = await fs.readFile(path.join(tmpDir, "assets", `${ONE_PX_PNG_SHA}.png`));
    expect(written.length).toBeGreaterThan(0);
  });

  it("is idempotent — repeating the lift doesn't fail when the asset already exists", async () => {
    const first = await liftDataUrl(ONE_PX_PNG_DATA_URL);
    const second = await liftDataUrl(ONE_PX_PNG_DATA_URL);
    expect(first).toBe(second);
  });

  it("returns null for malformed input rather than throwing", async () => {
    expect(await liftDataUrl("not a data url")).toBeNull();
    expect(await liftDataUrl("data:not/a-real-mime;base64,xxx")).toBeNull();
  });
});

describe("liftTemplate", () => {
  it("replaces an inline image-layer data URL with an /assets/<sha>.<ext> reference", async () => {
    const tpl = makeTemplate({
      layers: [
        {
          type: "image",
          id: "img1",
          name: "img1",
          visible: true,
          transform: {
            x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1,
            opacity: 1, anchorX: 0, anchorY: 0,
          },
          src: ONE_PX_PNG_DATA_URL,
          fit: "cover",
        },
      ],
    });
    const lifted = await liftTemplate(tpl);
    expect(lifted.layers[0]).toMatchObject({
      type: "image",
      src: `/assets/${ONE_PX_PNG_SHA}.png`,
    });
    // Asset bytes landed on disk.
    const stat = await fs.stat(path.join(tmpDir, "assets", `${ONE_PX_PNG_SHA}.png`));
    expect(stat.isFile()).toBe(true);
  });

  it("leaves non-data: URLs and FieldRef bindings untouched", async () => {
    const tpl = makeTemplate({
      layers: [
        {
          type: "image",
          id: "img1",
          name: "img1",
          visible: true,
          transform: {
            x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1,
            opacity: 1, anchorX: 0, anchorY: 0,
          },
          src: "https://example.com/foo.png",
          fit: "cover",
        },
        {
          type: "image",
          id: "img2",
          name: "img2",
          visible: true,
          transform: {
            x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1,
            opacity: 1, anchorX: 0, anchorY: 0,
          },
          src: { fieldKey: "bg" },
          fit: "cover",
        },
      ],
    });
    const lifted = await liftTemplate(tpl);
    expect(lifted.layers[0]).toMatchObject({ src: "https://example.com/foo.png" });
    expect(lifted.layers[1]).toMatchObject({ src: { fieldKey: "bg" } });
  });

  it("lifts field defaults and font sources too", async () => {
    const tpl = makeTemplate({
      fields: [{ key: "logo", label: "Logo", type: "image", default: ONE_PX_PNG_DATA_URL }],
      fonts: [{ family: "Brand", src: ONE_PX_PNG_DATA_URL }],
    });
    const lifted = await liftTemplate(tpl);
    expect(lifted.fields[0]?.default).toBe(`/assets/${ONE_PX_PNG_SHA}.png`);
    expect(lifted.fonts[0]?.src).toBe(`/assets/${ONE_PX_PNG_SHA}.png`);
  });
});

describe("liftHotcard / liftShow", () => {
  it("walks hotcard data values", async () => {
    const h: Hotcard = {
      id: "h1",
      name: "h",
      templateId: "t1",
      data: { logo: ONE_PX_PNG_DATA_URL, title: "Hello" },
    };
    const out = await liftHotcard(h);
    expect(out.data.logo).toBe(`/assets/${ONE_PX_PNG_SHA}.png`);
    expect(out.data.title).toBe("Hello");
  });

  it("walks graphic-row data on shows but skips song rows", async () => {
    const s: Show = {
      id: "s1",
      name: "s",
      rows: [
        { kind: "graphic", id: "r1", templateId: "t1", data: { logo: ONE_PX_PNG_DATA_URL } },
        { kind: "song", id: "r2", songId: "song-x", lyricTemplateId: "t1" },
      ],
    };
    const out = await liftShow(s);
    const r1 = out.rows[0];
    expect(r1?.kind).toBe("graphic");
    if (r1?.kind === "graphic") {
      expect(r1.data.logo).toBe(`/assets/${ONE_PX_PNG_SHA}.png`);
    }
    expect(out.rows[1]).toEqual(s.rows[1]);
  });
});

describe("rewriteAssetUrlsIn*", () => {
  const origin = "http://importer:4000";

  it("retargets absolute exporter URLs at the importer's origin", () => {
    const tpl = makeTemplate({
      layers: [
        {
          type: "image",
          id: "i",
          name: "i",
          visible: true,
          transform: {
            x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1,
            opacity: 1, anchorX: 0, anchorY: 0,
          },
          src: `http://exporter:4000/assets/${ONE_PX_PNG_SHA}.png`,
          fit: "cover",
        },
      ],
    });
    const out = rewriteAssetUrlsInTemplate(tpl, origin);
    expect(out.layers[0]).toMatchObject({
      src: `${origin}/assets/${ONE_PX_PNG_SHA}.png`,
    });
  });

  it("turns bare /assets/<file> paths into absolute URLs", () => {
    const h: Hotcard = {
      id: "h",
      name: "h",
      templateId: "t1",
      data: { logo: `/assets/${ONE_PX_PNG_SHA}.png` },
    };
    const out = rewriteAssetUrlsInHotcard(h, origin);
    expect(out.data.logo).toBe(`${origin}/assets/${ONE_PX_PNG_SHA}.png`);
  });

  it("leaves non-asset values alone", () => {
    const s: Show = {
      id: "s",
      name: "s",
      rows: [
        { kind: "graphic", id: "r", templateId: "t1", data: { title: "hi", external: "https://x.com" } },
      ],
    };
    const out = rewriteAssetUrlsInShow(s, origin);
    const row = out.rows[0];
    if (row?.kind === "graphic") {
      expect(row.data).toEqual({ title: "hi", external: "https://x.com" });
    }
  });
});

describe("extractAssetFilename", () => {
  it("extracts from absolute and relative URLs", () => {
    expect(extractAssetFilename(`http://h:4000/assets/${ONE_PX_PNG_SHA}.png`)).toBe(
      `${ONE_PX_PNG_SHA}.png`,
    );
    expect(extractAssetFilename(`/assets/${ONE_PX_PNG_SHA}.png`)).toBe(
      `${ONE_PX_PNG_SHA}.png`,
    );
  });

  it("returns null for non-asset strings", () => {
    expect(extractAssetFilename("hello world")).toBeNull();
    expect(extractAssetFilename("data:image/png;base64,iVBOR")).toBeNull();
  });

  it("rejects filenames that don't match the sha-named allowlist shape", () => {
    expect(extractAssetFilename("/assets/../etc/passwd")).toBeNull();
    expect(extractAssetFilename("/assets/notasha.png")).toBeNull();
  });
});

describe("writeBundledAsset", () => {
  it("writes new bytes and is idempotent on repeat", async () => {
    const bytes = Buffer.from(ONE_PX_PNG_B64, "base64");
    const filename = `${ONE_PX_PNG_SHA}.png`;
    const first = await writeBundledAsset(filename, ONE_PX_PNG_B64);
    expect(first.written).toBe(true);
    const second = await writeBundledAsset(filename, ONE_PX_PNG_B64);
    expect(second.written).toBe(false);
    const onDisk = await fs.readFile(path.join(tmpDir, "assets", filename));
    expect(onDisk.equals(bytes)).toBe(true);
  });

  it("rejects unsafe filenames", async () => {
    await expect(writeBundledAsset("../../../etc/passwd", "x")).rejects.toThrow();
  });
});
