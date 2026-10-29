import { DEFAULT_FORMAT_ID, type ChannelWindowPrefs } from "@overlaysys/core";

/**
 * The per-channel "Output" select encodes a display or a Blackmagic device
 * as one value: `display:<id>` (`display:` = primary) or `decklink:<name>`.
 */
export function outputChoiceValue(prefs: ChannelWindowPrefs): string {
  if (prefs.decklink) return `decklink:${prefs.decklink.device.name}`;
  return `display:${prefs.displayId ?? ""}`;
}

/** Prefs after picking an Output value. Display settings are kept for switching back. */
export function applyOutputChoice(prefs: ChannelWindowPrefs, value: string): ChannelWindowPrefs {
  if (value.startsWith("decklink:")) {
    const name = value.slice("decklink:".length);
    return { ...prefs, decklink: { device: { name }, format: prefs.decklink?.format ?? DEFAULT_FORMAT_ID } };
  }
  const id = value.slice("display:".length);
  const next: ChannelWindowPrefs = { ...prefs, displayId: id === "" ? undefined : Number(id) };
  delete next.decklink;
  return next;
}
