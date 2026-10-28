import { describe, expect, it } from "vitest";
import type { SongSessionSummary } from "@overlaysys/core";
import {
  hasCommandModifier,
  hotcardIndexForKey,
  isIgnoredRepeat,
  isTextEntryTarget,
  shouldIgnoreGlobalKey,
  songKeyChannel,
  type KeyLike,
} from "./shortcutGuards";

const key = (code: string, extra: Partial<KeyLike> = {}): KeyLike => ({
  key: code,
  code,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  repeat: false,
  defaultPrevented: false,
  ...extra,
});

const session = {} as SongSessionSummary;

describe("isTextEntryTarget", () => {
  it("skips text inputs, textareas, selects, ranges and contentEditable", () => {
    expect(isTextEntryTarget({ tagName: "INPUT", type: "text" })).toBe(true);
    expect(isTextEntryTarget({ tagName: "INPUT" })).toBe(true);
    expect(isTextEntryTarget({ tagName: "INPUT", type: "number" })).toBe(true);
    expect(isTextEntryTarget({ tagName: "INPUT", type: "range" })).toBe(true);
    expect(isTextEntryTarget({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTextEntryTarget({ tagName: "SELECT" })).toBe(true);
    expect(isTextEntryTarget({ tagName: "DIV", isContentEditable: true })).toBe(true);
  });

  it("lets keys through from a clicked checkbox, radio or button", () => {
    expect(isTextEntryTarget({ tagName: "INPUT", type: "checkbox" })).toBe(false);
    expect(isTextEntryTarget({ tagName: "INPUT", type: "radio" })).toBe(false);
    expect(isTextEntryTarget({ tagName: "BUTTON" })).toBe(false);
    expect(isTextEntryTarget(null)).toBe(false);
  });
});

describe("shouldIgnoreGlobalKey", () => {
  it("ignores a key a modal already handled", () => {
    expect(shouldIgnoreGlobalKey(key("Escape", { defaultPrevented: true }), null, false)).toBe(true);
  });

  it("ignores every key while a dialog is open", () => {
    expect(shouldIgnoreGlobalKey(key("Escape"), null, true)).toBe(true);
    expect(shouldIgnoreGlobalKey(key("Space"), { tagName: "BUTTON" }, true)).toBe(true);
  });

  it("handles keys from the body or a checkbox", () => {
    expect(shouldIgnoreGlobalKey(key("Space"), null, false)).toBe(false);
    expect(shouldIgnoreGlobalKey(key("Space"), { tagName: "INPUT", type: "checkbox" }, false)).toBe(false);
  });
});

describe("repeat and modifiers", () => {
  it("only lets arrow keys auto-repeat", () => {
    expect(isIgnoredRepeat(key("Space", { repeat: true }))).toBe(true);
    expect(isIgnoredRepeat(key("ArrowDown", { repeat: true }))).toBe(false);
    expect(isIgnoredRepeat(key("Space"))).toBe(false);
  });

  it("treats ⌘/Ctrl/Alt as command chords but not Shift", () => {
    expect(hasCommandModifier(key("KeyC", { metaKey: true }))).toBe(true);
    expect(hasCommandModifier(key("Digit1", { ctrlKey: true }))).toBe(true);
    expect(hasCommandModifier(key("KeyC", { altKey: true }))).toBe(true);
    expect(hasCommandModifier(key("Space", { shiftKey: true }))).toBe(false);
  });
});

describe("songKeyChannel", () => {
  it("is program only when program has a session", () => {
    expect(songKeyChannel({ program: session })).toBe("program");
    expect(songKeyChannel({ program: session, preview: session })).toBe("program");
  });

  it("is null when only preview has a song cued", () => {
    expect(songKeyChannel({ preview: session })).toBeNull();
    expect(songKeyChannel({ program: null })).toBeNull();
  });
});

describe("hotcardIndexForKey", () => {
  it("maps F1–F12 to 0–11, with or without Shift", () => {
    expect(hotcardIndexForKey(key("F1"))).toBe(0);
    expect(hotcardIndexForKey(key("F12"))).toBe(11);
    expect(hotcardIndexForKey(key("F3", { shiftKey: true }))).toBe(2);
  });

  it("ignores other keys and command chords", () => {
    expect(hotcardIndexForKey(key("F13"))).toBeNull();
    expect(hotcardIndexForKey(key("KeyF"))).toBeNull();
    expect(hotcardIndexForKey(key("F5", { metaKey: true }))).toBeNull();
  });
});
