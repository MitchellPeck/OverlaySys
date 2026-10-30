"use client";

import { useState, type CSSProperties } from "react";
import { colors, radius } from "@overlaysys/ui";
import { videoPosterUrl } from "@/lib/uploadAsset";

/** 16:9 poster frame for a video row (placed as given; default fills the box); renders nothing if there's no poster. */
export function VideoThumb({
  assetUrl,
  width = 48,
  objectFit = "cover",
  objectPosition,
}: {
  assetUrl: string;
  width?: number;
  objectFit?: CSSProperties["objectFit"];
  objectPosition?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const src = videoPosterUrl(assetUrl);
  if (!src || failed === src) return null;
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => setFailed(src)}
      style={{
        width,
        height: Math.round((width * 9) / 16),
        objectFit,
        objectPosition,
        borderRadius: radius.sm,
        background: colors.border,
        flexShrink: 0,
      }}
    />
  );
}
