"use client";

import { useId } from "react";
import {
  MEDIA_POSITION_LABELS,
  MediaPositionSchema,
  type MediaFit,
  type MediaPlacement,
  type MediaPosition,
  type PartialMediaPlacement,
} from "@overlaysys/core";
import { Button, PositionGrid, Select, colors, fontSize } from "@overlaysys/ui";
import { MEDIA_FIT_OPTIONS, mediaFitLabel, type PlacementPatch } from "@/lib/mediaPlacement";

const POSITION_OPTIONS = MediaPositionSchema.options.map((value) => ({ value, label: MEDIA_POSITION_LABELS[value] }));
const labelStyle = { fontSize: fontSize.sm, color: colors.textDim } as const;

type ControlProps = {
  /** What this use sets itself. */
  value: PartialMediaPlacement;
  /** What applies where `value` sets nothing (the deck's default, or what plays today). */
  fallback: MediaPlacement;
  /**
   * Set when this use may follow a default (a slide or folder graphic follows
   * its deck's): `option` names the size choice that follows it, `reset` the
   * button that puts the position back to it.
   */
  inherit?: { option: string; reset?: string };
  onChange(patch: PlacementPatch): void;
  id?: string;
};

/** Size: Fill screen / Fit inside / Shrink to fit / Stretch. */
export function MediaFitSelect({ value, fallback, inherit, onChange, id }: ControlProps) {
  return (
    <Select
      id={id}
      aria-label={id ? undefined : "Size"}
      value={value.fit ?? (inherit ? "" : fallback.fit)}
      onChange={(e) => onChange({ fit: (e.target.value || undefined) as MediaFit | undefined })}
      style={{ maxWidth: 320 }}
    >
      {inherit && <option value="">{inherit.option}</option>}
      {MEDIA_FIT_OPTIONS.map((o) => (
        <option key={o.value} value={o.value} title={o.title}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}

/** Position: a 3×3 picker; an override can go back to the default. */
export function MediaPositionPicker({ value, fallback, inherit, onChange }: ControlProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <PositionGrid<MediaPosition>
        aria-label="Position"
        value={value.position ?? fallback.position}
        options={POSITION_OPTIONS}
        onChange={(position) => onChange({ position })}
      />
      {inherit?.reset && value.position && (
        <Button variant="ghost" size="sm" onClick={() => onChange({ position: undefined })}>
          {inherit.reset}
        </Button>
      )}
    </div>
  );
}

/** The size choice that follows a deck's default, e.g. "Deck default (Fit inside)". */
export const deckDefaultSizeOption = (fallback: MediaPlacement) => `Deck default (${mediaFitLabel(fallback.fit)})`;

/** Size and position, each with its label, stacked (deck sidebar, dialogs). */
export function MediaPlacementFields(props: ControlProps) {
  const id = useId();
  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label htmlFor={`${id}-size`} style={labelStyle}>
          Size
        </label>
        <MediaFitSelect {...props} id={`${id}-size`} />
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <span style={labelStyle}>Position</span>
        <MediaPositionPicker {...props} />
      </div>
    </>
  );
}
