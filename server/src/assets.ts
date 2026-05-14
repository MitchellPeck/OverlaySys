import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import multipart from "@fastify/multipart";
import staticPlugin from "@fastify/static";
import { dataRoot } from "./storage";
import { planTranscode, transcodeToMp4, transcodeToWebmAlpha } from "./transcode";

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

/**
 * Allowed-extension allowlist. Keeps the store from accumulating arbitrary
 * types and matches what the editor inputs actually upload. Exported so the
 * bundle-import module can validate filenames the same way before writing.
 */
export const ALLOWED_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".avif",
  ".mp4", ".webm", ".mov", ".mkv", ".m4v",
  ".woff", ".woff2", ".ttf", ".otf",
]);

/**
 * Pick an extension for an asset file from its filename then mime type.
 * Falls back to "" when neither is recognized — callers should reject.
 */
export function extFromName(filename: string, mime: string): string {
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

/**
 * Pick an extension from a mime type alone, e.g. for inline `data:` URLs that
 * don't carry a filename. Returns "" when the mime isn't on the allowlist.
 */
export function extFromMime(mime: string): string {
  return extFromName("", mime);
}

/**
 * Whitelist for filenames coming from untrusted callers. Matches the layout
 * produced by `POST /api/assets` (sha256 + dot + allowed extension) so we
 * can't be tricked into reading or writing outside ASSETS_DIR.
 */
export function isSafeAssetFilename(name: string): boolean {
  if (!/^[A-Fa-f0-9]+\.[A-Za-z0-9]+$/.test(name)) return false;
  const ext = path.extname(name).toLowerCase();
  return ALLOWED_EXT.has(ext);
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

    // Decide what to do with this upload. For video, we probe the pixel
    // format and route to the right encoder: alpha → VP9/WebM, opaque +
    // non-web-safe → H.264/MP4, opaque + web-safe → passthrough. For images
    // and fonts, the planner is skipped and we always passthrough.
    const isVideoLike =
      (file.mimetype || "").startsWith("video/") ||
      /\.(mov|mkv|avi|m4v|webm|mp4)$/i.test(file.filename || "");
    const plan = isVideoLike
      ? await planTranscode(tmpPath, ext)
      : { kind: "passthrough" as const, finalExt: ext };

    const finalName = `${sha256}${plan.finalExt}`;
    const finalPath = path.join(ASSETS_DIR(), finalName);

    const exists = await fs
      .stat(finalPath)
      .then(() => true)
      .catch(() => false);

    if (exists) {
      // Same source bytes already converted (or stored verbatim) — drop the
      // temp upload and reuse the existing file.
      await fs.unlink(tmpPath).catch(() => {});
    } else if (plan.kind === "passthrough") {
      await fs.rename(tmpPath, finalPath);
    } else {
      try {
        if (plan.kind === "h264-mp4") {
          await transcodeToMp4(tmpPath, finalPath);
        } else if (plan.kind === "vp9-webm-alpha") {
          await transcodeToWebmAlpha(tmpPath, finalPath);
        }
      } catch (err) {
        await fs.unlink(tmpPath).catch(() => {});
        await fs.unlink(finalPath).catch(() => {});
        req.log.error({ err, plan }, "asset transcode failed");
        reply.code(500);
        return {
          error: `transcode failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
      await fs.unlink(tmpPath).catch(() => {});
    }

    // Relative URL is host-independent. Critical for packaged Electron,
    // which boots the server on an ephemeral port that changes between
    // launches — embedding the absolute host into stored template/hotcard
    // data would break every asset reference on the next launch. The
    // operator and renderer run on the server's origin in production, so
    // a relative `/assets/<filename>` resolves naturally; the operator's
    // FieldInput previews wrap with `resolveAssetUrl` for dev mode where
    // the operator dev server (:3000) and asset server (:4000) differ.
    return {
      url: `/assets/${finalName}`,
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

  /**
   * Read a stored asset's bytes as base64. The bundle exporter calls this to
   * embed converted videos, fonts, and images alongside the JSON entities
   * that reference them. We restrict to `<sha256>.<ext>` filenames so the
   * caller can't slip in path traversal — the existing content-addressed
   * store already enforces this naming for everything written via the
   * upload route or the raw-write endpoint below.
   */
  app.get<{ Params: { filename: string } }>("/api/assets/raw/:filename", async (req, reply) => {
    const filename = req.params.filename;
    if (!isSafeAssetFilename(filename)) {
      reply.code(400);
      return { error: "invalid filename" };
    }
    const filePath = path.join(ASSETS_DIR(), filename);
    let buf: Buffer;
    try {
      buf = await fs.readFile(filePath);
    } catch {
      reply.code(404);
      return { error: "not found" };
    }
    return {
      filename,
      size: buf.length,
      base64: buf.toString("base64"),
    };
  });

  /**
   * Write raw bytes to the content-addressed asset store under a caller-
   * specified filename, bypassing the upload pipeline's transcode planner.
   * The bundle importer uses this to restore already-converted assets back
   * onto disk without re-encoding them. The hash is the responsibility of
   * the caller — we trust the embedded bundle since it came out of the
   * exporter that read the file by name in the first place.
   */
  app.put<{ Params: { filename: string }; Body: unknown }>(
    "/api/assets/raw/:filename",
    {
      // Default 1MB is too small for video assets — match the multipart cap
      // so large bundle imports don't 413 before reaching the handler.
      bodyLimit: 1024 * 1024 * 1024,
    },
    async (req, reply) => {
      const filename = req.params.filename;
      if (!isSafeAssetFilename(filename)) {
        reply.code(400);
        return { error: "invalid filename" };
      }
      const body = req.body;
      if (
        !body ||
        typeof body !== "object" ||
        typeof (body as { base64?: unknown }).base64 !== "string"
      ) {
        reply.code(400);
        return { error: "expected JSON body with `base64`" };
      }
      let bytes: Buffer;
      try {
        bytes = Buffer.from((body as { base64: string }).base64, "base64");
      } catch (err) {
        reply.code(400);
        return { error: `bad base64: ${String(err)}` };
      }
      const filePath = path.join(ASSETS_DIR(), filename);
      const exists = await fs.stat(filePath).then(() => true).catch(() => false);
      if (exists) {
        return { filename, written: false, size: bytes.length };
      }
      await fs.writeFile(filePath, bytes);
      return { filename, written: true, size: bytes.length };
    },
  );
}

// Re-export for tests / scripts that want to read the underlying file.
export function assetPath(filename: string): string {
  return path.join(ASSETS_DIR(), filename);
}
