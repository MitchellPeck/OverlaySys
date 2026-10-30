"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Show } from "@overlaysys/core";
import { colors, fontSize } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { resolveAssetUrl, videoPosterUrl } from "@/lib/uploadAsset";
import type { RowLike } from "@/lib/rowLike";
import { thumbImageSrc, thumbMediaStyle, thumbsFor, type ThumbCtx } from "@/lib/thumbClick";
import { TemplateThumbnail } from "@/lib/thumbnails/TemplateThumbnail";
import { VideoThumb } from "@/app/components/VideoThumb";

const MAX_WIDTH = 360;

/**
 * The selected item's first slide as it will look on air, built from the
 * draft (not the saved show) so it follows every edit. Live field overrides
 * and on-air state are left out: this previews the item, not the output.
 */
export function ItemPreview({ row, show }: { row: RowLike; show: Show }) {
  const songs = useStore((s) => s.songs);
  const songCache = useStore((s) => s.songCache);
  const templates = useStore((s) => s.templates);
  const templateCache = useStore((s) => s.templateCache);
  const deckCache = useStore((s) => s.deckCache);
  const liveFolderFiles = useStore((s) => s.liveFolderFiles);
  const boxRef = useRef<HTMLElement>(null);
  const [width, setWidth] = useState(MAX_WIDTH);

  // Never wider than the column (narrow windows), never wider than 360.
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setWidth(Math.max(120, Math.min(MAX_WIDTH, Math.floor(el.clientWidth)))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const spec = useMemo(() => {
    const ctx: ThumbCtx = {
      show,
      songs,
      songCache,
      templates,
      templateCache,
      overrides: {},
      deckCache,
      liveFolderFiles,
      channelStates: {},
      songSessions: {},
    };
    return thumbsFor(row, ctx)[0] ?? null;
  }, [row, show, songs, songCache, templates, templateCache, deckCache, liveFolderFiles]);

  const height = Math.round((width * 9) / 16);
  let body: ReactNode;
  // Photos and videos draw with their real size/position (a photo is see-through over the tile), as they play.
  const media = spec?.render.kind === "image" || spec?.render.kind === "poster" ? spec.render : null;
  const mediaStyle = media ? thumbMediaStyle(media) : null;
  if (row.kind === "video") {
    const asset = (row as { assetUrl?: string }).assetUrl ?? "";
    body = (
      <div style={{ width, height, background: colors.surface2, position: "relative", overflow: "hidden" }}>
        <PreviewText text={asset ? "No poster frame yet" : "Choose a video"} />
        {asset && (
          <div style={{ position: "absolute", inset: 0 }}>
            <VideoThumb
              assetUrl={asset}
              width={width}
              objectFit={mediaStyle?.objectFit ?? "contain"}
              objectPosition={mediaStyle?.objectPosition}
            />
          </div>
        )}
      </div>
    );
  } else if (media && mediaStyle) {
    // A photo row, or a deck's first slide that is a photo or video.
    const src = thumbImageSrc(media, { resolveAsset: resolveAssetUrl, posterUrl: videoPosterUrl });
    body = (
      <div style={{ width, height, background: colors.surface2, position: "relative", overflow: "hidden" }}>
        {src ? (
          <img src={src} alt="" style={{ display: "block", width, height, ...mediaStyle }} />
        ) : (
          <PreviewText text="No preview" />
        )}
      </div>
    );
  } else if (spec?.render.kind === "template") {
    body = (
      <TemplateThumbnail
        templateId={spec.render.templateId}
        data={spec.render.data}
        width={width}
        label="Live preview of this item"
      />
    );
  } else {
    body = (
      <div style={{ width, height, background: colors.surface2, position: "relative" }}>
        <PreviewText text={spec?.render.kind === "placeholder" ? spec.render.text : "No preview"} />
      </div>
    );
  }

  return (
    <figure ref={boxRef} style={{ margin: 0, width: "100%", minWidth: 0 }}>
      {body}
      <figcaption style={{ marginTop: 6, fontSize: fontSize.xs, color: colors.textMuted }}>
        Live preview of this item{spec?.label ? ` · ${spec.label}` : ""}
      </figcaption>
    </figure>
  );
}

function PreviewText({ text }: { text: string }) {
  return (
    <span
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: colors.textMuted,
        fontSize: fontSize.xs,
      }}
    >
      {text}
    </span>
  );
}
