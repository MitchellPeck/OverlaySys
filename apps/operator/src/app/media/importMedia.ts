import { v4 as uuid } from "uuid";
import { mediaTypeOfFileName, type MediaItem } from "@overlaysys/core";
import type { UploadResult } from "../../lib/uploadAsset";

export function mediaTypeOf(mime: string): "image" | "video" | null {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return null;
}

/**
 * Photo or video for a picked/dropped file: the browser's type first, then the
 * extension (browsers often leave `type` empty for .mov / .m4v).
 */
export function mediaTypeOfFile(file: Pick<File, "name" | "type">): "image" | "video" | null {
  return mediaTypeOf(file.type ?? "") ?? mediaTypeOfFileName(file.name);
}

/** Which element `probeMedia` loads the file into. */
export const probeKind = mediaTypeOfFile;

/** "a.b.mov" -> "a.b"; names with no extension (or only a leading dot) are unchanged. */
export function stripExtension(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

/** Server record ids allow [A-Za-z0-9_-], up to 64 characters. */
export function newMediaId(): string {
  return `media-${uuid().slice(0, 12)}`;
}

/** A library item for an uploaded photo or video; null when the file is neither. */
export function buildImportedItem(i: {
  fileName: string;
  upload: Pick<UploadResult, "url" | "mime">;
  id: string;
  now: string;
  width?: number;
  height?: number;
  durationSec?: number;
  folder?: string;
  /** The file's own kind, used when the server's mime is generic (typeless .mov). */
  fileType?: "image" | "video" | null;
}): MediaItem | null {
  const mediaType = mediaTypeOf(i.upload.mime) ?? i.fileType ?? null;
  if (!mediaType) return null;
  const folder = i.folder?.trim();
  return {
    id: i.id,
    name: stripExtension(i.fileName).trim() || i.fileName,
    kind: "file",
    mediaType,
    assetUrl: i.upload.url,
    ...(i.width ? { width: i.width } : {}),
    ...(i.height ? { height: i.height } : {}),
    ...(i.durationSec ? { durationSec: i.durationSec } : {}),
    ...(folder ? { folder } : {}),
    createdAt: i.now,
  };
}

/** Reads dimensions (and duration for video) in the browser; resolves {} when the file can't be probed. */
export function probeMedia(file: File): Promise<{ width?: number; height?: number; durationSec?: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const done = (v: { width?: number; height?: number; durationSec?: number }) => {
      URL.revokeObjectURL(url);
      resolve(v);
    };
    const kind = probeKind(file);
    if (kind === "image") {
      const img = new Image();
      img.onload = () => done({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => done({});
      img.src = url;
    } else if (kind === "video") {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.onloadedmetadata = () =>
        done({
          width: v.videoWidth,
          height: v.videoHeight,
          ...(Number.isFinite(v.duration) ? { durationSec: Math.round(v.duration * 10) / 10 } : {}),
        });
      v.onerror = () => done({});
      v.src = url;
    } else done({});
  });
}

export type ImportDeps = {
  upload(file: File): Promise<Pick<UploadResult, "url" | "mime">>;
  probe(file: File): Promise<{ width?: number; height?: number; durationSec?: number }>;
  save(item: MediaItem): Promise<void>;
};

/** Upload one file and add it to the library; throws a plain message for anything that isn't a photo or video. */
export async function importMediaFile(file: File, deps: ImportDeps, now = new Date().toISOString()): Promise<MediaItem> {
  const [upload, probe] = await Promise.all([deps.upload(file), deps.probe(file)]);
  const item = buildImportedItem({ fileName: file.name, upload, id: newMediaId(), now, fileType: mediaTypeOfFile(file), ...probe });
  if (!item) throw new Error("That file isn't a photo or video.");
  await deps.save(item);
  return item;
}
