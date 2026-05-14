import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { Hotcard, Show, Template } from "@overlaysys/core";
import { dataRoot } from "./storage";
import { extFromMime, isSafeAssetFilename } from "./assets";

/**
 * Server-side equivalent of the asset transforms the operator used to do
 * client-side during bundle import. Everything in this module operates on
 * in-memory entities and writes to `data/assets/` directly — no HTTP round
 * trips and no Zod re-parsing. Ownership lives next to the import route
 * (`importRoute.ts`) so the asset-store layout stays in one place.
 *
 * Three transforms compose during import:
 *   1. `lift{Template,Hotcard,Show}` — extract any inline `data:` URLs into
 *      content-addressed asset files and substitute the resulting URL.
 *   2. `rewriteAssetUrlsIn{Template,Hotcard,Show}` — retarget any
 *      `http://<exporter-host>/assets/<sha>.<ext>` URLs (or bare
 *      `/assets/<sha>.<ext>` ones) at the importer's own origin so the
 *      renderer/operator can fetch them.
 *   3. `extractAssetFilename` — the underlying matcher; used by tests and
 *      callers that just want to detect an asset URL without rewriting.
 */

const ASSETS_DIR = (): string => path.join(dataRoot(), "assets");

// ───── Lifting inline `data:` URLs ───────────────────────────────────────────

/**
 * Decode a `data:<mime>[;base64],<payload>` URL, store the bytes under a
 * sha256-named filename in `data/assets/`, and return the URL the entities
 * should reference instead (`/assets/<sha256>.<ext>`).
 *
 * Returns `null` if the URL is malformed or the mime type isn't in
 * the allowlist — caller leaves the original string in place so the import
 * doesn't fail wholesale on a single bad asset.
 */
export async function liftDataUrl(dataUrl: string): Promise<string | null> {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) return null;
  const mime = match[1] ?? "application/octet-stream";
  const isBase64 = match[2] === ";base64";
  const payload = match[3] ?? "";
  const ext = extFromMime(mime);
  if (!ext) return null;

  let bytes: Buffer;
  try {
    bytes = isBase64
      ? Buffer.from(payload, "base64")
      : Buffer.from(decodeURIComponent(payload), "utf8");
  } catch {
    return null;
  }

  const sha = crypto.createHash("sha256").update(bytes).digest("hex");
  const filename = `${sha}${ext}`;
  const filePath = path.join(ASSETS_DIR(), filename);

  await fs.mkdir(ASSETS_DIR(), { recursive: true });
  // Idempotent: re-importing a bundle that already inlined this asset is a
  // no-op once the file lands on disk.
  const exists = await fs.stat(filePath).then(() => true).catch(() => false);
  if (!exists) await fs.writeFile(filePath, bytes);

  return `/assets/${filename}`;
}

export async function liftTemplate(t: Template): Promise<Template> {
  const liftStr = async (s: string | undefined): Promise<string | undefined> => {
    if (s === undefined || !s.startsWith("data:")) return s;
    const lifted = await liftDataUrl(s);
    return lifted ?? s;
  };

  const fields = await Promise.all(
    t.fields.map(async (f) => {
      if (f.default === undefined) return f;
      const replaced = await liftStr(f.default);
      return replaced === f.default ? f : { ...f, default: replaced };
    }),
  );
  const fonts = await Promise.all(
    (t.fonts ?? []).map(async (f) => {
      const replaced = await liftStr(f.src);
      return replaced === f.src ? f : { ...f, src: replaced ?? "" };
    }),
  );
  const layers = await Promise.all(t.layers.map((l) => liftLayer(l, liftStr)));
  return { ...t, fields, fonts, layers };
}

async function liftLayer(
  layer: Template["layers"][number],
  liftStr: (s: string | undefined) => Promise<string | undefined>,
): Promise<Template["layers"][number]> {
  if (layer.type === "group") {
    const children = await Promise.all(layer.children.map((c) => liftLayer(c, liftStr)));
    return { ...layer, children };
  }
  if ((layer.type === "image" || layer.type === "video") && typeof layer.src === "string") {
    const replaced = await liftStr(layer.src);
    if (replaced !== layer.src) return { ...layer, src: replaced ?? "" };
  }
  return layer;
}

export async function liftHotcard(h: Hotcard): Promise<Hotcard> {
  const data = await liftDataRecord(h.data);
  return data === h.data ? h : { ...h, data };
}

export async function liftShow(s: Show): Promise<Show> {
  const rows = await Promise.all(
    s.rows.map(async (row) => {
      if (row.kind !== "graphic") return row;
      const data = await liftDataRecord(row.data);
      return data === row.data ? row : { ...row, data };
    }),
  );
  return { ...s, rows };
}

async function liftDataRecord(
  data: Record<string, string>,
): Promise<Record<string, string>> {
  let changed = false;
  const out: Record<string, string> = {};
  await Promise.all(
    Object.entries(data).map(async ([k, v]) => {
      if (typeof v === "string" && v.startsWith("data:")) {
        const lifted = await liftDataUrl(v);
        if (lifted) {
          out[k] = lifted;
          changed = true;
          return;
        }
      }
      out[k] = v;
    }),
  );
  return changed ? out : data;
}

// ───── Retargeting asset URLs at the importer's origin ───────────────────────

/**
 * Pull just the `<sha256>.<ext>` slug from any URL that has `/assets/<file>`
 * in it (relative or absolute, with optional query/fragment). Used to detect
 * exporter-host URLs without trying to parse the URL.
 */
export function extractAssetFilename(value: string): string | null {
  if (typeof value !== "string" || !value) return null;
  const idx = value.indexOf("/assets/");
  if (idx === -1) return null;
  const tail = value.slice(idx + "/assets/".length);
  const m = tail.match(/^[A-Fa-f0-9]+\.[A-Za-z0-9]+/);
  if (!m) return null;
  return isSafeAssetFilename(m[0]) ? m[0] : null;
}

function retargetOne(value: string, originBase: string): string {
  const filename = extractAssetFilename(value);
  if (!filename) return value;
  return `${originBase}/assets/${filename}`;
}

// ───── Normalizing asset URLs to relative form ───────────────────────────────

/**
 * Strip any absolute scheme+host prefix from an asset URL, leaving only
 * `/assets/<filename>`. Storing relative URLs is the right default for
 * Electron packaging — the server runs on an OS-assigned ephemeral port
 * that changes between launches, so any absolute host baked into a saved
 * template or hotcard would break on the next boot. Relative URLs resolve
 * against the current origin, which in production is always the server's
 * own origin (the operator and renderer are served by Fastify too).
 */
function normalizeOne(value: string): string {
  const filename = extractAssetFilename(value);
  if (!filename) return value;
  const target = `/assets/${filename}`;
  return value === target ? value : target;
}

export function normalizeAssetUrlsInTemplate(t: Template): Template {
  let changed = false;
  const fields = t.fields.map((f) => {
    if (f.default === undefined) return f;
    const replaced = normalizeOne(f.default);
    if (replaced !== f.default) changed = true;
    return replaced === f.default ? f : { ...f, default: replaced };
  });
  const fonts = (t.fonts ?? []).map((f) => {
    const replaced = normalizeOne(f.src);
    if (replaced !== f.src) changed = true;
    return replaced === f.src ? f : { ...f, src: replaced };
  });
  const layers = t.layers.map((l) => {
    const out = normalizeLayer(l);
    if (out !== l) changed = true;
    return out;
  });
  if (!changed) return t;
  return { ...t, fields, fonts, layers };
}

function normalizeLayer(layer: Template["layers"][number]): Template["layers"][number] {
  if (layer.type === "group") {
    let changed = false;
    const children = layer.children.map((c) => {
      const out = normalizeLayer(c);
      if (out !== c) changed = true;
      return out;
    });
    return changed ? { ...layer, children } : layer;
  }
  if ((layer.type === "image" || layer.type === "video") && typeof layer.src === "string") {
    const replaced = normalizeOne(layer.src);
    if (replaced !== layer.src) return { ...layer, src: replaced };
  }
  return layer;
}

export function normalizeAssetUrlsInHotcard(h: Hotcard): Hotcard {
  const data = normalizeDataRecord(h.data);
  return data === h.data ? h : { ...h, data };
}

export function normalizeAssetUrlsInShow(s: Show): Show {
  let changed = false;
  const rows = s.rows.map((row) => {
    if (row.kind !== "graphic") return row;
    const data = normalizeDataRecord(row.data);
    if (data === row.data) return row;
    changed = true;
    return { ...row, data };
  });
  return changed ? { ...s, rows } : s;
}

function normalizeDataRecord(data: Record<string, string>): Record<string, string> {
  let changed = false;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) {
    const replaced = normalizeOne(v);
    if (replaced !== v) changed = true;
    out[k] = replaced;
  }
  return changed ? out : data;
}

export function rewriteAssetUrlsInTemplate(t: Template, originBase: string): Template {
  return {
    ...t,
    fields: t.fields.map((f) =>
      f.default !== undefined
        ? { ...f, default: retargetOne(f.default, originBase) }
        : f,
    ),
    fonts: (t.fonts ?? []).map((f) => ({
      ...f,
      src: retargetOne(f.src, originBase),
    })),
    layers: t.layers.map((l) => retargetLayer(l, originBase)),
  };
}

function retargetLayer(
  layer: Template["layers"][number],
  originBase: string,
): Template["layers"][number] {
  if (layer.type === "group") {
    return { ...layer, children: layer.children.map((c) => retargetLayer(c, originBase)) };
  }
  if ((layer.type === "image" || layer.type === "video") && typeof layer.src === "string") {
    return { ...layer, src: retargetOne(layer.src, originBase) };
  }
  return layer;
}

export function rewriteAssetUrlsInHotcard(h: Hotcard, originBase: string): Hotcard {
  return { ...h, data: retargetRecord(h.data, originBase) };
}

export function rewriteAssetUrlsInShow(s: Show, originBase: string): Show {
  return {
    ...s,
    rows: s.rows.map((row) =>
      row.kind === "graphic"
        ? { ...row, data: retargetRecord(row.data, originBase) }
        : row,
    ),
  };
}

function retargetRecord(
  data: Record<string, string>,
  originBase: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) {
    out[k] = retargetOne(v, originBase);
  }
  return out;
}

// ───── Bundled-asset write (for the `assets` array in a bundle) ──────────────

/**
 * Write base64-decoded bytes to `data/assets/<filename>`. Used by the import
 * route when restoring the embedded `assets` array. Idempotent — if the
 * filename already exists the existing bytes are kept.
 */
export async function writeBundledAsset(
  filename: string,
  base64: string,
): Promise<{ written: boolean }> {
  if (!isSafeAssetFilename(filename)) {
    throw new Error(`invalid asset filename: ${filename}`);
  }
  const bytes = Buffer.from(base64, "base64");
  const filePath = path.join(ASSETS_DIR(), filename);
  await fs.mkdir(ASSETS_DIR(), { recursive: true });
  const exists = await fs.stat(filePath).then(() => true).catch(() => false);
  if (exists) return { written: false };
  await fs.writeFile(filePath, bytes);
  return { written: true };
}
