import { hotcardForKey, hotcardRoute, HotkeySchema, type Hotcard, type HotcardMeta, type Hotkey, type ChannelState, type SongSessionSummary } from "@overlaysys/core";
import type { ClientMessage } from "@overlaysys/ws-protocol";
import { slidesAdvanceMessage, slidesBlankMessage, slidesKeyChannel } from "./slidesRowView";

/** The parts of a KeyboardEvent the guards read; lets tests use plain objects. */
export type KeyLike = Pick<
  KeyboardEvent,
  "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "repeat" | "defaultPrevented"
>;

export type TargetLike = {
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
  closest?: (selector: string) => unknown;
  matches?: (selector: string) => boolean;
} | null;

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

const DIALOG_SELECTOR = '[role="dialog"], [aria-modal="true"], dialog[open]';
const ACTIVATABLE_SELECTOR = 'button, a[href], summary, [role="button"], input[type="checkbox"], input[type="radio"], select';

/** True when the element sits inside an open dialog / modal. */
export function isInsideDialog(t: TargetLike): boolean {
  return !!t?.closest?.(DIALOG_SELECTOR);
}

function isFormFieldTarget(t: TargetLike): boolean {
  const tag = t?.tagName?.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t?.isContentEditable === true;
}

/**
 * Whether a canvas/designer shortcut must stand down: the target (or the
 * focused element) is a form field, or inside an open dialog. A confirm in
 * front of the designer must not let Backspace delete layers behind it.
 */
export function isShortcutBlocked(target: TargetLike, active: TargetLike = null): boolean {
  // Focus can fall to <body> while a dialog is open, so check the document too.
  if (typeof document !== "undefined" && document.querySelector(DIALOG_SELECTOR)) return true;
  return isFormFieldTarget(target) || isFormFieldTarget(active) || isInsideDialog(target) || isInsideDialog(active);
}

/**
 * True when the focused element is something Enter/Space activates itself
 * (button, link, [role=button], checkbox/radio, select, summary) and was
 * focused via keyboard, so the show shortcuts must leave those two keys to it.
 */
export function isActivatableTarget(t: TargetLike): boolean {
  if (!t) return false;
  // Only keyboard-focused elements: a button the mouse just clicked keeps
  // focus, and Space/Enter must still drive the show then.
  if (typeof t.matches === "function") {
    try {
      if (!t.matches(":focus-visible")) return false;
    } catch {
      return false;
    }
  }
  if (t.closest?.(ACTIVATABLE_SELECTOR)) return true;
  const tag = t.tagName;
  if (tag === "BUTTON" || tag === "SELECT" || tag === "SUMMARY" || tag === "A") return true;
  return tag === "INPUT" && NON_TEXT_INPUTS.has((t.type ?? "text").toLowerCase());
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

/** Scripture keys drive the PROGRAM scripture session only, like song keys. */
export function scriptureKeyChannel(channelStates: Record<string, ChannelState | undefined>): "program" | null {
  return channelStates["program"]?.scriptureSession ? "program" : null;
}

export type KeyMode = "song" | "scripture" | "slides" | "rundown";

/** Which live session the keys drive: a program song, then scripture, then slides, else the rundown. */
export function keyMode(store: {
  songSessions: Record<string, SongSessionSummary | null | undefined>;
  channelStates: Record<string, ChannelState>;
}): KeyMode {
  if (songKeyChannel(store.songSessions)) return "song";
  if (scriptureKeyChannel(store.channelStates)) return "scripture";
  if (slidesKeyChannel(store.channelStates)) return "slides";
  return "rundown";
}

/** Space / Shift+Space in the given mode; null in rundown mode (Space takes there). */
export function advanceMessage(
  mode: KeyMode,
  delta: 1 | -1,
  channelStates: Record<string, ChannelState | undefined> = {},
): ClientMessage | null {
  switch (mode) {
    case "song":
      return { type: "song_advance", channel: "program", delta };
    case "scripture":
      return { type: "scripture_advance", channel: "program", delta };
    case "slides":
      return slidesAdvanceMessage(delta, slidesKeyChannel(channelStates) ?? "program");
    case "rundown":
      return null;
  }
}

/** The blank key: "." blanks a song; B blanks slides. Null elsewhere. */
export function blankMessage(
  mode: KeyMode,
  channelStates: Record<string, ChannelState | undefined> = {},
): ClientMessage | null {
  switch (mode) {
    case "song":
      return { type: "song_blank", channel: "program" };
    case "slides":
      return slidesBlankMessage(slidesKeyChannel(channelStates) ?? "program");
    default:
      return null;
  }
}

/** Esc is a panic key: the first press arms, a second within `windowMs` acts. */
export function escPress(now: number, lastEscAt: number | null, windowMs = 600): "arm" | "act" {
  return lastEscAt !== null && now >= lastEscAt && now - lastEscAt <= windowMs ? "act" : "arm";
}

/** The F1–F12 key pressed (Shift allowed); null for anything else or a ⌘/Ctrl/Alt chord. */
export function hotkeyForEvent(e: KeyLike): Hotkey | null {
  if (hasCommandModifier(e)) return null;
  const parsed = HotkeySchema.safeParse(e.code);
  return parsed.success ? parsed.data : null;
}

/**
 * The current project's hotcard assigned to the pressed F-key, or null.
 * Keys come from each card's explicit `hotkey`, never its list position.
 */
export function hotcardForEvent<T extends HotcardMeta>(e: KeyLike, hotcards: readonly T[], projectId: string): T | null {
  const k = hotkeyForEvent(e);
  return k ? hotcardForKey(hotcards, k, projectId) : null;
}

/**
 * What Esc sends in graphic mode: clear everything on program. The
 * media_clear goes out even if the operator's state shows no video (it may
 * not have heard yet); the server ignores it on a channel without media.
 */
export function escapeMessages(): ClientMessage[] {
  return [
    { type: "clear", channel: "program" },
    { type: "media_clear", channel: "program" },
  ];
}

/** What Esc sends in song mode: end the program song and clear program video. */
export function songEscapeMessages(): ClientMessage[] {
  return [
    { type: "song_end", channel: "program" },
    { type: "media_clear", channel: "program" },
  ];
}

// Shared with the Companion module, so it lives in core.
export { hotcardRoute };

/**
 * The cue/take message for a hotcard, routed by `hotcardRoute`. Every
 * operator surface that fires a hotcard (panel, stage, keys) builds it here.
 */
export function hotcardFireMessage(
  h: Pick<Hotcard, "channelHint" | "templateId" | "data">,
  action: "cue" | "take",
): ClientMessage {
  return { type: action, channel: hotcardRoute(h.channelHint, action), templateId: h.templateId, data: h.data };
}
