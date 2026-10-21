"use client";

import { useState } from "react";
import { colors, radius } from "@overlaysys/ui";
import { videoPosterUrl } from "@/lib/uploadAsset";

/** 16:9 poster frame for a video row; renders nothing if there's no poster. */
export function VideoThumb({ assetUrl, width = 48 }: { assetUrl: string; width?: number }) {
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
        objectFit: "cover",
        borderRadius: radius.sm,
        background: colors.border,
        flexShrink: 0,
      }}
    />
  );
}
