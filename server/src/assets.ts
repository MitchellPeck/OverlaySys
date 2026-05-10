import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import staticPlugin from "@fastify/static";
import { dataRoot } from "./storage";

/**
 * Content-addressed binary asset store.
 *
 * - `POST /api/assets` (multipart, single field "file") writes the upload to
 *   `<dataRoot>/assets/<sha256>.<ext>` and returns `{url, sha256, size, mime}`.
 *   Idempotent: if the hash already exists, the existing file is reused.
 * - `GET /assets/<filename>` serves the stored file.
 *
 * The URL returned is absolute (`http://<server-host>/assets/...`) so
 * templates that reference it work regardless of which origin the
 * operator/renderer page was served from. In dev that means the operator
 * page on :3000 can render an `<img>` whose src is `http://localhost:4000/...`
 * — same machine, no proxy needed.
 */

const ASSETS_DIR = (): string => path.join(dataRoot(), "assets");

// Last-resort fallback host if neither the request's Host header nor a
// forwarded-host header is present. Should basically never trigger.
const HOST_FALLBACK = "localhost:4000";

// Allowed-extension allowlist. Keeps the store from accumulating arbitrary
// types and matches what the editor inputs actually upload.
const ALLOWED_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".avif",
  ".mp4", ".webm", ".mov", ".mkv", ".m4v",
  ".woff", ".woff2", ".ttf", ".otf",
]);

function extFromName(filename: string, mime: string): string {
  // Prefer the filename extension when present and recognized.
  const fromName = path.extname(filename).toLowerCase();
  if (fromName && ALLOWED_EXT.has(fromName)) return fromName;
  // Fall back to a small mime → ext map.
  const map: Record<string, string> = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
    "image/avif": ".avif",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "video/quicktime": ".mov",
    "font/woff": ".woff",
    "font/woff2": ".woff2",
    "font/ttf": ".ttf",
    "font/otf": ".otf",
    "application/font-woff": ".woff",
    "application/font-woff2": ".woff2",
  };
  return map[mime] ?? "";
}

export async function registerAssetRoutes(app: FastifyInstance): Promise<void> {
  await fs.mkdir(ASSETS_DIR(), { recursive: true });

  // 1 GB cap matches the WS payload bump — keeps the upload-vs-WS-save
  // ceiling consistent.
  await app.register(multipart, {
    limits: { fileSize: 1024 * 1024 * 1024, files: 1 },
  });

  await app.register(staticPlugin, {
    root: ASSETS_DIR(),
    prefix: "/assets/",
    decorateReply: false,
    // Long cache: filenames are content-hashed, so the URL changes when the
    // bytes change — safe to cache aggressively.
    setHeaders: (res) => {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    },
  });

  app.post("/api/assets", async (req, reply) => {
    const file = await req.file();
    if (!file) {
      reply.code(400);
      return { error: "no file uploaded" };
    }

    const ext = extFromName(file.filename ?? "", file.mimetype ?? "");
    if (!ext) {
      reply.code(415);
      return {
        error: `unsupported type: ${file.mimetype || "unknown"} (${file.filename || "?"})`,
      };
    }

    // Stream into a temp file while hashing, then rename atomically into the
    // content-addressed slot. Avoids buffering the whole upload in RAM.
    const tmpPath = path.join(
      ASSETS_DIR(),
      `.tmp-${crypto.randomBytes(8).toString("hex")}`,
    );
    const hash = crypto.createHash("sha256");
    let size = 0;

    const fh = await fs.open(tmpPath, "w");
    try {
      for await (const chunk of file.file) {
        hash.update(chunk as Buffer);
        size += (chunk as Buffer).length;
        await fh.write(chunk as Buffer);
      }
    } finally {
      await fh.close();
    }

    if (file.file.truncated) {
      await fs.unlink(tmpPath).catch(() => {});
      reply.code(413);
      return { error: "file too large" };
    }

    const sha256 = hash.digest("hex");
    const finalName = `${sha256}${ext}`;
    const finalPath = path.join(ASSETS_DIR(), finalName);

    const exists = await fs
      .stat(finalPath)
      .then(() => true)
      .catch(() => false);

    if (exists) {
      await fs.unlink(tmpPath).catch(() => {});
    } else {
      await fs.rename(tmpPath, finalPath);
    }

    // Build an absolute URL using the request's host header. Works in dev
    // (`http://localhost:4000/...`) and in packaged Electron
    // (`http://127.0.0.1:<port>/...`). The operator/renderer can move these
    // strings around without losing the origin.
    const proto =
      (req.headers["x-forwarded-proto"] as string | undefined) ??
      (req.protocol as string);
    const host =
      (req.headers["x-forwarded-host"] as string | undefined) ??
      (req.headers.host as string | undefined) ??
      `${HOST_FALLBACK}`;
    return {
      url: `${proto}://${host}/assets/${finalName}`,
      sha256,
      size,
      mime: file.mimetype ?? "",
    };
  });

  // GET helper: list known assets. Useful for a future asset browser; for
  // now mostly a sanity check / debugging tool.
  app.get("/api/assets", async () => {
    const entries = await fs.readdir(ASSETS_DIR()).catch(() => []);
    const files = entries.filter((n) => !n.startsWith("."));
    return { assets: files.map((name) => ({ url: `/assets/${name}`, name })) };
  });
}

// Re-export for tests / scripts that want to read the underlying file.
export function assetPath(filename: string): string {
  return path.join(ASSETS_DIR(), filename);
}
