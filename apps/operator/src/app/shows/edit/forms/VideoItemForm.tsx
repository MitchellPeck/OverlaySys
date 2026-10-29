"use client";

import { useEffect, useRef, useState } from "react";
import { DEFAULT_MEDIA_TRANSITION, type VideoRow } from "@overlaysys/core";
import { VideoInput } from "@overlaysys/editor-kit";
import { Input, Select, colors, fontSize } from "@overlaysys/ui";
import { TransitionField, probeDuration } from "@/app/components/VideoRowModal";
import { formatClock } from "@/lib/mediaTake";
import { resolveAssetUrl, uploadAsset } from "@/lib/uploadAsset";
import type { ItemFormProps } from "./GraphicItemForm";
import { FormRow, ItemCommonFields, ItemFormFrame } from "./ItemCommonFields";
import { patchRow, withVideoLengthPrefill } from "./itemFormModel";

/** Video item: the Add-video fields inline. A new asset is probed for its duration, which fills an unset Length. */
export function VideoItemForm({ row, show, onChange }: ItemFormProps<VideoRow>) {
  // The duration probe is async: apply it to the latest row, and only if the asset is still the one probed.
  const rowRef = useRef(row);
  rowRef.current = row;
  const [probing, setProbing] = useState(false);
  const patch = (p: Record<string, unknown>) => onChange(patchRow(rowRef.current, p));
  const volume = row.volume ?? 1;
  const file = row.assetUrl.split("/").pop() ?? "";

  const probeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (probeTimer.current) clearTimeout(probeTimer.current);
    };
  }, []);

  function setAsset(assetUrl: string) {
    patch({ assetUrl, durationSec: undefined });
    if (probeTimer.current) clearTimeout(probeTimer.current);
    if (!assetUrl) return;
    // Typed paths change per keystroke: probe once the text settles.
    probeTimer.current = setTimeout(async () => {
      setProbing(true);
      try {
        const durationSec = await probeDuration(resolveAssetUrl(assetUrl));
        const cur = rowRef.current;
        // Unmounted (another item selected): rowRef may be stale, so drop the result.
        if (!alive.current || cur.assetUrl !== assetUrl || durationSec === undefined) return;
        onChange(withVideoLengthPrefill(patchRow(cur, { durationSec })));
      } finally {
        if (alive.current) setProbing(false);
      }
    }, 500);
  }

  return (
    <ItemFormFrame row={row} show={show} name={row.label?.trim() || file || "Video"}>
      <FormRow label="Video">
        <VideoInput
          value={row.assetUrl}
          onChange={(v) => void setAsset(v)}
          onUpload={async (f) => (await uploadAsset(f)).url}
          resolveUrl={resolveAssetUrl}
        />
        <div style={{ fontSize: fontSize.xs, color: colors.textMuted, marginTop: 4 }}>
          {probing ? "Reading duration…" : typeof row.durationSec === "number" ? `Duration ${formatClock(row.durationSec)}` : null}
        </div>
      </FormRow>
      <FormRow label="Label">
        <Input
          aria-label="Label"
          value={row.label ?? ""}
          placeholder="Giving video"
          onChange={(e) => patch({ label: e.target.value || undefined })}
        />
      </FormRow>
      <FormRow label="At the end">
        <Select
          aria-label="When the video ends"
          value={row.endAction ?? "clear"}
          onChange={(e) => patch({ endAction: e.target.value })}
          style={{ maxWidth: 320 }}
        >
          <option value="clear">Clear when finished</option>
          <option value="hold">Hold last frame</option>
        </Select>
      </FormRow>
      <FormRow label="Transitions">
        <div style={{ display: "flex", flexDirection: "column", gap: 4, maxWidth: 320 }}>
          <TransitionField
            label="In"
            value={row.transitionIn ?? DEFAULT_MEDIA_TRANSITION}
            onChange={(t) => patch({ transitionIn: t })}
          />
          <TransitionField
            label="Out"
            value={row.transitionOut ?? DEFAULT_MEDIA_TRANSITION}
            onChange={(t) => patch({ transitionOut: t })}
          />
        </div>
      </FormRow>
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
      <ItemCommonFields row={row} onChange={(p) => patch(p)} showSermonNotes={false} sets={[]} />
    </ItemFormFrame>
  );
}
