"use client";

import { useState } from "react";
import { Film, FolderOpen, Image as ImageIcon } from "lucide-react";
import type { LiveFolderFile, MediaItemMeta } from "@overlaysys/core";
import { colors, fontSize, fontWeight, radius } from "@overlaysys/ui";
import { resolveAssetUrl, videoPosterUrl } from "../../lib/uploadAsset";
import { formatDuration, liveFolderCountText, thumbnailSource, typeLabel } from "./libraryConfig";

/** Where the browser loads a thumbnail from: asset (resolved), video poster, or live-folder file. */
function thumbSrc(item: MediaItemMeta, liveFiles: LiveFolderFile[] | undefined): string | null {
  const t = thumbnailSource(item, liveFiles);
  if (t.kind === "folder") return null;
  if (t.kind === "video") return videoPosterUrl(t.url);
  return resolveAssetUrl(t.url);
}

/** 16:9 thumbnail with a type badge and (for video) its duration. Reused by the Live media panel. */
export function MediaThumb({ item, liveFiles }: { item: MediaItemMeta; liveFiles?: LiveFolderFile[] }) {
  const src = thumbSrc(item, liveFiles);
  const [failed, setFailed] = useState<string | null>(null);
  const showImg = src && failed !== src;
  const Fallback = item.kind === "live-folder" ? FolderOpen : item.mediaType === "video" ? Film : ImageIcon;
  const badge = {
    position: "absolute",
    bottom: 6,
    padding: "1px 6px",
    borderRadius: radius.sm,
    background: "rgba(0,0,0,0.65)",
    color: "#fff",
    fontSize: fontSize["2xs"],
    fontWeight: fontWeight.medium,
  } as const;
  return (
    <div
      style={{
        position: "relative",
        aspectRatio: "16 / 9",
        background: colors.surface3,
        borderRadius: radius.md,
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: colors.textMuted,
      }}
    >
      {showImg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          loading="lazy"
          onError={() => setFailed(src)}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        <Fallback size={28} aria-hidden />
      )}
      <span style={{ ...badge, left: 6 }}>{typeLabel(item)}</span>
      {item.kind === "file" && item.mediaType === "video" && item.durationSec ? (
        <span style={{ ...badge, right: 6 }}>{formatDuration(item.durationSec)}</span>
      ) : null}
    </div>
  );
}

/** Grid card: thumbnail, name, and a muted line (folder, live-folder count, usage). */
export function MediaCard({ item, liveFiles }: { item: MediaItemMeta; liveFiles?: LiveFolderFile[] }) {
  const bits = [
    item.kind === "live-folder" && liveFiles ? liveFolderCountText(liveFiles.length) : null,
    item.folder ?? null,
    item.usedBy > 0 ? `Used by ${item.usedBy}` : null,
  ].filter(Boolean);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 8 }}>
      <MediaThumb item={item} liveFiles={liveFiles} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: fontSize.md, color: colors.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {item.name}
        </div>
        <div style={{ fontSize: fontSize.xs, color: colors.textMuted, minHeight: 15 }}>{bits.join(" · ")}</div>
      </div>
    </div>
  );
}
