import { v4 as uuid } from "uuid";
import type { MediaItem } from "@overlaysys/core";
import type { UploadResult } from "../../lib/uploadAsset";

export function mediaTypeOf(mime: string): "image" | "video" | null {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return null;
}

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
}): MediaItem | null {
  const mediaType = mediaTypeOf(i.upload.mime);
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
    if (file.type.startsWith("image/")) {
      const img = new Image();
      img.onload = () => done({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => done({});
      img.src = url;
    } else if (file.type.startsWith("video/")) {
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
