import { BUILT_IN_STAGE_LAYOUTS, stageLayoutMeta } from "@overlaysys/core";
import type { ChannelConfig, StageLayoutMeta } from "@overlaysys/core";

/** Stage channels whose stored layoutId is `layoutId`. */
export function channelsUsingLayout(channels: ChannelConfig[], layoutId: string): ChannelConfig[] {
  return channels.filter((c) => c.kind === "stage" && c.layoutId === layoutId);
}

export interface LayoutPickerModel {
  options: { id: string; label: string }[];
  /** Select value: the stored id (or Speaker's id when unset). */
  value: string;
  /** Stored id that no longer exists; null when fine. */
  missingId: string | null;
}

/**
 * Picker options for a stage channel. Uses the loaded list, falling back to the
 * built-ins until it arrives. A stored id absent from the loaded list is
 * surfaced as a "missing" entry instead of silently selecting Speaker.
 */
export function layoutPickerModel(
  stageLayouts: StageLayoutMeta[],
  storedId: string | undefined,
): LayoutPickerModel {
  const loaded = stageLayouts.length > 0;
  const metas = loaded ? stageLayouts : BUILT_IN_STAGE_LAYOUTS.map(stageLayoutMeta);
  const options = metas.map((l) => ({ id: l.id, label: l.name }));
  const value = storedId ?? BUILT_IN_STAGE_LAYOUTS[0]!.id;
  // Until the list arrives we can't tell whether a custom id is missing.
  const absent = !options.some((o) => o.id === value);
  if (absent && !loaded) {
    // Show the raw id rather than letting the select fall back to displaying Speaker.
    return { options: [{ id: value, label: value }, ...options], value, missingId: null };
  }
  const missing = loaded && absent;
  if (!missing) return { options, value, missingId: null };
  return {
    options: [{ id: value, label: `${value} (missing — Speaker)` }, ...options],
    value,
    missingId: value,
  };
}
