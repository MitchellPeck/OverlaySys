"use client";

import { useEffect, useRef, useState } from "react";
import { DEFAULT_MEDIA_TRANSITION, type ImageRow, type VideoRow } from "@overlaysys/core";
import { Input, SegmentedControl, Select, Switch, colors, fontSize } from "@overlaysys/ui";
import { PHOTO_FIT_OPTIONS, TransitionField, probeDuration } from "@/app/components/MediaRowModal";
import { MediaSourceField, type SourcePick } from "@/app/media/MediaPicker";
import { formatClock } from "@/lib/mediaTake";
import { mediaRowName } from "@/lib/rowView";
import { useStore } from "@/lib/store";
import { resolveAssetUrl } from "@/lib/uploadAsset";
import type { ItemFormProps } from "./types";
import { FormRow, ItemCommonFields, ItemFormFrame } from "./ItemCommonFields";
import { patchRow, withLibraryDuration, withVideoLengthPrefill } from "./itemFormModel";

type MediaRow = VideoRow | ImageRow;

/**
 * Media item (photo or video). The source comes from the library or an upload;
 * a photo stays a photo and a video a video. A new video's duration comes from
 * its library item, else a probe, and fills an unset Length.
 */
export function MediaItemForm({ row, show, onChange }: ItemFormProps<MediaRow>) {
  // The duration probe is async: apply it to the latest row, and only if the asset is still the one probed.
  const rowRef = useRef(row);
  rowRef.current = row;
  const mediaItems = useStore((s) => s.mediaItems);
  const [probing, setProbing] = useState(false);
  const patch = (p: Record<string, unknown>) => onChange(patchRow(rowRef.current, p));
  const isVideo = row.kind === "video";
  const name = mediaRowName(row, mediaItems);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  async function setSource(pick: SourcePick) {
    // Unmounted (another item selected) while uploading: rowRef may be stale, so drop the result.
    if (!alive.current) return;
    const next = patchRow(rowRef.current, {
      assetUrl: pick.assetUrl,
      mediaItemId: pick.mediaItemId,
      ...(isVideo ? { durationSec: pick.durationSec } : {}),
    });
    if (next.kind !== "video") return onChange(next);
    const withDuration = withLibraryDuration(next, mediaItems);
    onChange(withDuration);
    if (typeof withDuration.durationSec === "number") return;
    setProbing(true);
    try {
      const durationSec = await probeDuration(resolveAssetUrl(pick.assetUrl));
      const cur = rowRef.current;
      if (!alive.current || cur.kind !== "video" || cur.assetUrl !== pick.assetUrl || durationSec === undefined) return;
      onChange(withVideoLengthPrefill(patchRow(cur, { durationSec })));
    } finally {
      if (alive.current) setProbing(false);
    }
  }

  const transitions = (
    <FormRow label="Transitions">
      <div style={{ display: "flex", flexDirection: "column", gap: 4, maxWidth: 320 }}>
        <TransitionField label="In" value={row.transitionIn ?? DEFAULT_MEDIA_TRANSITION} onChange={(t) => patch({ transitionIn: t })} />
        <TransitionField label="Out" value={row.transitionOut ?? DEFAULT_MEDIA_TRANSITION} onChange={(t) => patch({ transitionOut: t })} />
      </div>
    </FormRow>
  );

  return (
    <ItemFormFrame row={row} show={show} name={name}>
      <FormRow label={isVideo ? "Video" : "Photo"}>
        <MediaSourceField
          assetUrl={row.assetUrl}
          mediaType={isVideo ? "video" : "image"}
          name={name}
          accept={isVideo ? "video" : "image"}
          onChange={(p) => void setSource(p)}
        />
        {isVideo && (
          <div style={{ fontSize: fontSize.xs, color: colors.textMuted, marginTop: 4 }}>
            {probing ? "Reading duration…" : typeof row.durationSec === "number" ? `Duration ${formatClock(row.durationSec)}` : null}
          </div>
        )}
      </FormRow>
      <FormRow label="Label">
        <Input
          aria-label="Label"
          value={row.label ?? ""}
          placeholder={name || "Giving video"}
          onChange={(e) => patch({ label: e.target.value || undefined })}
        />
      </FormRow>
      {row.kind === "video" ? <VideoFields row={row} patch={patch} /> : <PhotoFields row={row} patch={patch} />}
      {transitions}
      <ItemCommonFields row={row} onChange={(p) => patch(p)} showSermonNotes={false} sets={[]} />
    </ItemFormFrame>
  );
}

function VideoFields({ row, patch }: { row: VideoRow; patch: (p: Record<string, unknown>) => void }) {
  const volume = row.volume ?? 1;
  return (
    <>
      <FormRow label="Playback">
        <div style={{ display: "flex", gap: 16, paddingTop: 4 }}>
          <Switch checked={!!row.loop} onChange={(v) => patch({ loop: v || undefined })} label="Loop" />
          <Switch checked={!!row.muted} onChange={(v) => patch({ muted: v || undefined })} label="Mute" />
        </div>
      </FormRow>
      {!row.muted && (
        <FormRow label="Volume">
          <div style={{ display: "flex", alignItems: "center", gap: 8, maxWidth: 320 }}>
            <input
              type="range"
              aria-label="Volume"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={(e) => patch({ volume: Number(e.target.value) })}
              style={{ flex: 1 }}
            />
            <span style={{ fontSize: fontSize.xs, color: colors.textDim, width: 36, textAlign: "right" }}>{Math.round(volume * 100)}%</span>
          </div>
        </FormRow>
      )}
      {!row.loop && (
        <FormRow label="At the end">
          <Select
            aria-label="When the video ends"
            value={row.endAction ?? "clear"}
            onChange={(e) => patch({ endAction: e.target.value })}
            style={{ maxWidth: 320 }}
          >
            <option value="hold">Hold last frame</option>
            <option value="clear">Clear</option>
          </Select>
        </FormRow>
      )}
    </>
  );
}

function PhotoFields({ row, patch }: { row: ImageRow; patch: (p: Record<string, unknown>) => void }) {
  return (
    <FormRow label="Fit">
      <SegmentedControl size="sm" aria-label="Fit" value={row.fit ?? "cover"} options={PHOTO_FIT_OPTIONS} onChange={(fit) => patch({ fit })} />
    </FormRow>
  );
}
