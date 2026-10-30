"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Film, Image as ImageIcon } from "lucide-react";
import { liveFolderFileUrl, type LiveFolderFile, type MediaItemMeta } from "@overlaysys/core";
import { Button, Input, Modal, colors, fontSize, radius } from "@overlaysys/ui";
import { useStore } from "../../lib/store";
import { isCloudMode } from "../../lib/mode";
import { resolveAssetUrl, uploadAsset, videoPosterUrl } from "../../lib/uploadAsset";
import { requestLiveFolder, saveMediaItem } from "../../lib/mediaRequests";
import { importErrorText } from "./libraryConfig";
import { MediaCard } from "./MediaCard";
import { probeMedia } from "./importMedia";
import { sourceActions, uploadMediaSource, uploadRefusal, type SourcePick, type SourceUploadDeps } from "./mediaSourceChoice";
import {
  LIVE_FOLDER_PICK_NOTE,
  liveFolderChoices,
  pickFromItem,
  pickFromLiveFile,
  pickableItems,
  type PickAccept,
  type PickedMedia,
} from "./pickerModel";

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

/** Library browser for photos and videos. A live folder opens to its files, and one file can be chosen. */
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
  const liveFiles = useStore((s) => s.liveFolderFiles);
  const [query, setQuery] = useState("");
  const [folder, setFolder] = useState<MediaItemMeta | null>(null);
  useEffect(() => {
    if (open) {
      setQuery("");
      setFolder(null);
    }
  }, [open]);
  const folderId = folder?.id;
  const folderLoaded = folderId ? liveFiles[folderId] !== undefined : false;
  useEffect(() => {
    if (open && folderId && !folderLoaded) requestLiveFolder(folderId);
  }, [open, folderId, folderLoaded]);
  const shown = pickableItems(items, accept, query);
  const hasAny = pickableItems(items, accept).length > 0;

  // Portalled to <body>: the picker is often opened from inside a form <Field>
  // (a <label>), and a click anywhere in a label re-fires on its first button —
  // "Choose from Media" — which reopened the picker the moment a tile closed it.
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <Modal open={open} onClose={onClose} title={folder ? folder.name : TITLES[accept]} size="lg" zIndex={1100}>
      {folder ? (
        <LiveFolderFiles
          folder={folder}
          entry={liveFiles[folder.id]}
          accept={accept}
          onBack={() => setFolder(null)}
          onPick={(f) => onPick(pickFromLiveFile(folder.id, f))}
        />
      ) : (
      <>
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
              onClick={() => (m.kind === "live-folder" ? setFolder(m) : onPick(pickFromItem(m)))}
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
              aria-label={m.kind === "live-folder" ? `Open ${m.name}` : `Use ${m.name}`}
            >
              <MediaCard item={m} liveFiles={liveFiles[m.id]?.files} />
            </button>
          ))}
        </div>
      )}
      </>
      )}
    </Modal>,
    document.body,
  );
}

/** The files of one live folder (of the field's type) and a way back; picking one plays it from the folder. */
function LiveFolderFiles({
  folder,
  entry,
  accept,
  onBack,
  onPick,
}: {
  folder: MediaItemMeta;
  entry: { files: LiveFolderFile[]; configured: boolean } | undefined;
  accept: PickAccept;
  onBack: () => void;
  onPick: (file: LiveFolderFile) => void;
}) {
  const { files, message } = liveFolderChoices(entry, accept);
  return (
    <div>
      <Button size="sm" variant="ghost" onClick={onBack} style={{ marginBottom: 12 }}>
        Back to Media
      </Button>
      {message && (
        <p style={{ margin: "24px 0", textAlign: "center", fontSize: fontSize.sm, color: colors.textMuted }}>{message}</p>
      )}
      {files.length > 0 && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 4, maxHeight: "55vh", overflow: "auto" }}>
            {files.map((f) => (
              <button
                key={f.name}
                type="button"
                onClick={() => onPick(f)}
                aria-label={`Use ${f.name}`}
                style={{ padding: 0, border: "none", background: "transparent", color: "inherit", font: "inherit", textAlign: "left", cursor: "pointer", borderRadius: radius.md, minWidth: 0 }}
                onMouseEnter={(e) => (e.currentTarget.style.background = colors.surface2)}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <LiveFileThumb folderId={folder.id} file={f} />
                <div style={{ padding: "4px 6px", fontSize: fontSize.sm, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
              </button>
            ))}
          </div>
          <p style={{ margin: "12px 0 0", fontSize: fontSize.xs, color: colors.textMuted }}>{LIVE_FOLDER_PICK_NOTE}</p>
        </>
      )}
    </div>
  );
}

function LiveFileThumb({ folderId, file }: { folderId: string; file: LiveFolderFile }) {
  const [failed, setFailed] = useState(false);
  const url = liveFolderFileUrl(folderId, file.name);
  const src = file.mediaType === "video" ? videoPosterUrl(url) : resolveAssetUrl(url);
  const Fallback = file.mediaType === "video" ? Film : ImageIcon;
  return (
    <div
      style={{ aspectRatio: "16 / 9", background: colors.surface3, borderRadius: radius.md, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", color: colors.textMuted }}
    >
      {failed || !src ? (
        <Fallback size={28} aria-hidden />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" loading="lazy" onError={() => setFailed(true)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      )}
    </div>
  );
}

/** What every upload needs: the asset store, a probe, and Media's save (unused in cloud mode). */
export function sourceUploadDeps(): SourceUploadDeps {
  return { cloud: isCloudMode(), upload: uploadAsset, probe: probeMedia, save: saveMediaItem };
}

/**
 * Upload a file for a row or layer. On the show computer it also joins the
 * library (so the row links to it); in cloud mode it's a plain upload.
 */
export function uploadToLibrary(file: File, accept: PickAccept = "any"): Promise<SourcePick> {
  return uploadMediaSource(file, accept, sourceUploadDeps());
}

export type { SourcePick };

const ACCEPT_FILES: Record<PickAccept, string> = { image: "image/*", video: "video/*", any: "image/*,video/*" };

/**
 * A Media row's source: a preview with the item's name, "Choose from Media"
 * (show computer only) and "Upload". Uploads join the library.
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
  const canChoose = sourceActions(isCloudMode()).includes("library");
  const fileRef = useRef<HTMLInputElement>(null);
  const [picking, setPicking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thumbFailed, setThumbFailed] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);
    const refusal = uploadRefusal(file, accept);
    if (refusal) {
      setError(refusal);
      return;
    }
    setUploading(true);
    try {
      onChange(await uploadToLibrary(file, accept));
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
        {canChoose && (
          <Button size="sm" variant="secondary" onClick={() => setPicking(true)} disabled={uploading}>
            Choose from Media
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => fileRef.current?.click()} disabled={uploading}>
          {uploading ? "Uploading…" : "Upload"}
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
