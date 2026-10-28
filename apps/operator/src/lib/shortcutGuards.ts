import type { ChannelState, SongSessionSummary } from "@overlaysys/core";
import type { ClientMessage } from "@overlaysys/ws-protocol";
import { clearChannelMessages } from "./onAir";

/** The parts of a KeyboardEvent the guards read; lets tests use plain objects. */
export type KeyLike = Pick<
  KeyboardEvent,
  "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "repeat" | "defaultPrevented"
>;

export type TargetLike = { tagName?: string; type?: string; isContentEditable?: boolean } | null;

// Input types that don't take typed text. Keys on these belong to the show,
// so a clicked checkbox or button doesn't leave the shortcuts dead.
const NON_TEXT_INPUTS = new Set(["checkbox", "radio", "button", "submit", "reset", "color", "file", "image"]);

/**
 * True when the focused element consumes typing: text-like inputs, textareas,
 * contentEditable, selects (arrows change their value) and range sliders
 * (arrows move them).
 */
export function isTextEntryTarget(t: TargetLike): boolean {
  if (!t) return false;
  if (t.isContentEditable) return true;
  const tag = t.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return !NON_TEXT_INPUTS.has((t.type ?? "text").toLowerCase());
  return false;
}

/**
 * Whether the global show shortcuts should ignore this key entirely: someone
 * else already handled it (a modal's Esc), a dialog is open, or the operator
 * is typing.
 */
export function shouldIgnoreGlobalKey(e: KeyLike, target: TargetLike, dialogOpen: boolean): boolean {
  if (e.defaultPrevented) return true;
  if (dialogOpen) return true;
  return isTextEntryTarget(target);
}

/** Holding a key down only repeats navigation; every other action fires once. */
export function isIgnoredRepeat(e: KeyLike): boolean {
  return e.repeat && e.code !== "ArrowUp" && e.code !== "ArrowDown";
}

/** ⌘/Ctrl/Alt chords belong to the browser/OS, except the ones we bind. */
export function hasCommandModifier(e: KeyLike): boolean {
  return e.metaKey || e.ctrlKey || e.altKey;
}

/**
 * Song hotkeys drive the PROGRAM session only. A song merely cued on preview
 * leaves Space/Esc acting on the rundown, so they can't advance or end the
 * preview song while the operator thinks they're driving air.
 */
export function songKeyChannel(sessions: Record<string, SongSessionSummary | null | undefined>): "program" | null {
  return sessions["program"] ? "program" : null;
}

/** F1–F12 → hotcard index 0–11; null for anything else or a ⌘/Ctrl/Alt chord. */
export function hotcardIndexForKey(e: KeyLike): number | null {
  if (hasCommandModifier(e)) return null;
  const m = /^F([1-9]|1[0-2])$/.exec(e.code);
  return m ? Number(m[1]) - 1 : null;
}

/** Label shown on a hotcard tile for its F-key, if it has one. */
export function hotcardKeyLabel(index: number): string | null {
  return index >= 0 && index < 12 ? `F${index + 1}` : null;
}

/**
 * What Esc sends in graphic mode: clear everything on program, video
 * included. Song mode's Esc (end song) is handled before this.
 */
export function escapeMessages(store: { channelStates: Record<string, ChannelState | undefined> }): ClientMessage[] {
  return clearChannelMessages(store.channelStates["program"], "program");
}

/**
 * Which channel a hotcard fires on (Default D7a). The card's hint is the
 * default output for Take only; Cue always goes to Preview, so a card can
 * never reach air from Cue/Shift+F. A hint of Program or Preview (from
 * before this rule) or none means Take goes to Program.
 */
export function hotcardRoute(hint: string | undefined, action: "cue" | "take"): string {
  if (action === "cue") return "preview";
  if (!hint || hint === "preview" || hint === "program") return "program";
  return hint;
}
