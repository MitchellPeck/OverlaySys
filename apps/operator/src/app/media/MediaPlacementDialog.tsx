"use client";

import { useEffect, useState } from "react";
import type { MediaItemMeta, MediaPlacement } from "@overlaysys/core";
import { Button, Dialog, colors, fontSize } from "@overlaysys/ui";
import { MediaPlacementFields } from "../components/MediaPlacementFields";
import { applyPlacement, startPlacement } from "../../lib/mediaPlacement";
import { MediaThumb } from "./MediaCard";

/**
 * An item's own size and position (e.g. a lower-third strip: Shrink to fit,
 * bottom). Wherever the item is added next, that use starts with these.
 */
export function MediaPlacementDialog({
  item,
  onClose,
  onSave,
}: {
  item: MediaItemMeta | null;
  onClose(): void;
  onSave(item: MediaItemMeta, placement: MediaPlacement): void;
}) {
  const [placement, setPlacement] = useState<MediaPlacement>(startPlacement("image", undefined));
  useEffect(() => {
    if (item) setPlacement(startPlacement(item.mediaType ?? "image", item));
  }, [item]);
  if (!item) return null;
  const save = () => onSave(item, placement);
  return (
    <Dialog
      open
      onClose={onClose}
      title="Size and position"
      size="sm"
      onConfirm={save}
      footer={
        <>
          <Button variant="secondary" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="md" onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <p style={{ margin: 0, fontSize: fontSize.sm, color: colors.textDim }}>
          Where &ldquo;{item.name}&rdquo; is added from now on, it starts with this size and position. Each place can still change it.
        </p>
        <MediaThumb item={{ ...item, ...placement }} />
        <MediaPlacementFields
          value={placement}
          fallback={placement}
          onChange={(p) => setPlacement((cur) => applyPlacement(cur, p))}
        />
      </div>
    </Dialog>
  );
}
