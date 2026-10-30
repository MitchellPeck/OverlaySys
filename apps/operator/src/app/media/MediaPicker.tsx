"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Film, Image as ImageIcon } from "lucide-react";
import { Button, Input, Modal, colors, fontSize, radius } from "@overlaysys/ui";
import { useStore } from "../../lib/store";
import { isCloudMode } from "../../lib/mode";
import { resolveAssetUrl, uploadAsset, videoPosterUrl } from "../../lib/uploadAsset";
import { saveMediaItem } from "../../lib/mediaRequests";
import { importErrorText } from "./libraryConfig";
import { MediaCard } from "./MediaCard";
import { importMediaFile, mediaTypeOf, probeMedia } from "./importMedia";
import { pickFromItem, pickableItems, type PickAccept, type PickedMedia } from "./pickerModel";

const TITLES: Record<PickAccept, string> = {
  image: "Choose a photo",
  video: "Choose a video",
  any: "Choose from Media",
};

const EMPTY: Record<PickAccept, string> = {
  image: "No photos in Media yet.",
  video: "No videos in Media yet.",
  any: "No photos or videos in Media yet.",
};

/** Library browser for photos and videos. Live folders aren't offered here. */
export function MediaPicker({
  open,
  accept,
  onPick,
  onClose,
}: {
  open: boolean;
  accept: PickAccept;
  onPick: (ref: PickedMedia) => void;
  onClose: () => void;
}) {
  const items = useStore((s) => s.mediaItems);
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (open) setQuery("");
  }, [open]);
  const shown = pickableItems(items, accept, query);
  const hasAny = pickableItems(items, accept).length > 0;

  return (
    <Modal open={open} onClose={onClose} title={TITLES[accept]} size="lg" zIndex={1100}>
      <Input
        aria-label="Search Media"
        placeholder="Search by name"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ marginBottom: 12 }}
      />
      {shown.length === 0 ? (
        <p style={{ margin: "24px 0", textAlign: "center", fontSize: fontSize.sm, color: colors.textMuted }}>
          {hasAny ? "Nothing matches that search." : `${EMPTY[accept]} Import files on the Media page.`}
        </p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 4, maxHeight: "60vh", overflow: "auto" }}>
          {shown.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onPick(pickFromItem(m))}
              style={{
                padding: 0,
                border: "none",
                background: "transparent",
                color: "inherit",
                font: "inherit",
                textAlign: "left",
                cursor: "pointer",
                borderRadius: radius.md,
                minWidth: 0,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = colors.surface2)}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              aria-label={`Use ${m.name}`}
            >
              <MediaCard item={m} />
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

/**
 * Upload a file for a row or layer. On the show computer it also joins the
 * library (so the row links to it); in cloud mode it's a plain upload.
 */
export async function uploadToLibrary(file: File): Promise<SourcePick> {
  if (isCloudMode()) {
    const up = await uploadAsset(file);
    const mediaType = mediaTypeOf(up.mime);
    if (!mediaType) throw new Error("That file isn't a photo or video.");
    return { assetUrl: up.url, mediaType, name: file.name };
  }
  const item = await importMediaFile(file, { upload: uploadAsset, probe: probeMedia, save: saveMediaItem });
  return { ...pickFromItem(item), ...(item.durationSec ? { durationSec: item.durationSec } : {}) };
}

/** A pick or upload for a row's source; uploads carry the duration read while importing. */
export type SourcePick = PickedMedia & { durationSec?: number };

const ACCEPT_FILES: Record<PickAccept, string> = { image: "image/*", video: "video/*", any: "image/*,video/*" };

/**
 * A Media row's source: a preview with the item's name, "Choose from Media"
 * (show computer only) and "Upload file". Uploads join the library.
 */
export function MediaSourceField({
  assetUrl,
  mediaType,
  name,
  accept,
  onChange,
}: {
  assetUrl: string;
  mediaType: "image" | "video" | null;
  /** Library name, label or file name; empty when nothing is chosen. */
  name: string;
  accept: PickAccept;
  onChange: (pick: SourcePick) => void;
}) {
  const cloud = isCloudMode();
  const fileRef = useRef<HTMLInputElement>(null);
  const [picking, setPicking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thumbFailed, setThumbFailed] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);
    const type = mediaTypeOf(file.type);
    if (!type || (accept !== "any" && type !== accept)) {
      setError(accept === "video" ? "Choose a video file." : accept === "image" ? "Choose a photo." : "Choose a photo or video.");
      return;
    }
    setUploading(true);
    try {
      onChange(await uploadToLibrary(file));
    } catch (e) {
      setError(`Couldn't upload ${file.name}: ${importErrorText(e)}`);
    } finally {
      setUploading(false);
    }
  }

  const thumb = !assetUrl ? null : mediaType === "video" ? videoPosterUrl(assetUrl) : resolveAssetUrl(assetUrl);
  const Fallback = mediaType === "image" ? ImageIcon : Film;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <div
          style={{
            width: 64,
            aspectRatio: "16 / 9",
            flexShrink: 0,
            borderRadius: radius.sm,
            overflow: "hidden",
            background: colors.surface3,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: colors.textMuted,
          }}
        >
          {thumb && thumbFailed !== thumb ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb} alt="" onError={() => setThumbFailed(thumb)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            <Fallback size={16} aria-hidden />
          )}
        </div>
        <span
          title={assetUrl || undefined}
          style={{ flex: 1, minWidth: 0, fontSize: fontSize.sm, color: name ? colors.text : colors.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {name || "Nothing chosen"}
        </span>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {!cloud && (
          <Button size="sm" variant="secondary" onClick={() => setPicking(true)} disabled={uploading}>
            Choose from Media
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()} disabled={uploading}>
          {uploading ? "Uploading…" : "Upload file"}
        </Button>
      </div>
      {error && (
        <div role="alert" style={{ fontSize: fontSize.xs, color: colors.dangerText }}>
          {error}
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept={ACCEPT_FILES[accept]}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
          e.target.value = "";
        }}
      />
      <MediaPicker
        open={picking}
        accept={accept}
        onClose={() => setPicking(false)}
        onPick={(ref) => {
          setPicking(false);
          setError(null);
          onChange(ref);
        }}
      />
    </div>
  );
}

/** `pick(accept)` opens the picker and resolves with the pick, or null when closed. Render `picker` once. */
export function useLibraryPicker(): { pick: (accept: PickAccept) => Promise<PickedMedia | null>; picker: React.ReactNode } {
  const [accept, setAccept] = useState<PickAccept | null>(null);
  const resolver = useRef<((v: PickedMedia | null) => void) | null>(null);
  const settle = (v: PickedMedia | null) => {
    resolver.current?.(v);
    resolver.current = null;
    setAccept(null);
  };
  const pick = useCallback((a: PickAccept) => {
    resolver.current?.(null);
    setAccept(a);
    return new Promise<PickedMedia | null>((resolve) => {
      resolver.current = resolve;
    });
  }, []);
  useEffect(() => () => resolver.current?.(null), []);
  const picker = (
    <MediaPicker open={accept !== null} accept={accept ?? "any"} onPick={settle} onClose={() => settle(null)} />
  );
  return { pick, picker };
}
