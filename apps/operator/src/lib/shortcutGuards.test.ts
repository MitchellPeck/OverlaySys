import { describe, expect, it } from "vitest";
import type { ChannelState, HotcardMeta, SongSessionSummary } from "@overlaysys/core";
import {
  escapeMessages,
  hasCommandModifier,
  hotcardFireMessage,
  hotcardForEvent,
  hotcardRoute,
  hotkeyForEvent,
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

describe("hotkeyForEvent", () => {
  it("reads F1–F12, with or without Shift", () => {
    expect(hotkeyForEvent(key("F1"))).toBe("F1");
    expect(hotkeyForEvent(key("F12"))).toBe("F12");
    expect(hotkeyForEvent(key("F3", { shiftKey: true }))).toBe("F3");
  });

  it("ignores other keys and command chords", () => {
    expect(hotkeyForEvent(key("F13"))).toBeNull();
    expect(hotkeyForEvent(key("KeyF"))).toBeNull();
    expect(hotkeyForEvent(key("F5", { metaKey: true }))).toBeNull();
  });
});

describe("hotcardForEvent (F-keys come from each card's hotkey)", () => {
  const cards: HotcardMeta[] = [
    { id: "hotcard-a", name: "Pastor", templateId: "l3", projectId: "sun", hotkey: "F4" },
    { id: "hotcard-b", name: "Welcome", templateId: "l3", projectId: "sun", hotkey: "F1" },
    { id: "hotcard-c", name: "Other", templateId: "l3", projectId: "youth", hotkey: "F2" },
    { id: "hotcard-d", name: "Unkeyed", templateId: "l3", projectId: "sun", hotkey: null },
  ];

  it("fires the card whose hotkey matches, whatever the list order", () => {
    expect(hotcardForEvent(key("F4"), cards, "sun")?.id).toBe("hotcard-a");
    expect(hotcardForEvent(key("F4"), [...cards].reverse(), "sun")?.id).toBe("hotcard-a");
    expect(hotcardForEvent(key("F1", { shiftKey: true }), cards, "sun")?.id).toBe("hotcard-b");
  });

  it("never fires another project's card or falls back to position", () => {
    expect(hotcardForEvent(key("F2"), cards, "sun")).toBeNull();
    expect(hotcardForEvent(key("F3"), cards, "sun")).toBeNull();
    expect(hotcardForEvent(key("F2"), cards, "youth")?.id).toBe("hotcard-c");
  });

  it("is null for non-F-keys and chords", () => {
    expect(hotcardForEvent(key("Space"), cards, "sun")).toBeNull();
    expect(hotcardForEvent(key("F4", { ctrlKey: true }), cards, "sun")).toBeNull();
  });
});

describe("escapeMessages", () => {
  const media = { rowId: "v1", assetUrl: "/assets/v.mp4", paused: false } as NonNullable<ChannelState["media"]>;

  it("clears program graphics", () => {
    expect(escapeMessages({ channelStates: {} })).toEqual([{ type: "clear", channel: "program" }]);
  });

  it("also clears a video on program (the panic key empties air)", () => {
    const channelStates = { program: { channel: "program", active: null, media } as ChannelState };
    expect(escapeMessages({ channelStates })).toEqual([
      { type: "clear", channel: "program" },
      { type: "media_clear", channel: "program" },
    ]);
  });

  it("leaves a video on preview alone", () => {
    const channelStates = { preview: { channel: "preview", active: null, media } as ChannelState };
    expect(escapeMessages({ channelStates })).toEqual([{ type: "clear", channel: "program" }]);
  });
});

describe("hotcardRoute (Default D7a: the hint is Take's default output; Cue is always Preview)", () => {
  const table: [string | undefined, "cue" | "take", string][] = [
    [undefined, "cue", "preview"],
    [undefined, "take", "program"],
    ["program", "cue", "preview"],
    ["program", "take", "program"],
    ["preview", "cue", "preview"],
    ["preview", "take", "program"],
    ["", "cue", "preview"],
    ["", "take", "program"],
    ["stage", "cue", "preview"],
    ["stage", "take", "stage"],
    ["stream", "cue", "preview"],
    ["stream", "take", "stream"],
  ];
  it.each(table)("hint %s, %s → %s", (hint, action, expected) => {
    expect(hotcardRoute(hint, action)).toBe(expected);
  });
});

describe("hotcardFireMessage (used by the Hotcards panel, the stage panel and the keys)", () => {
  const card = { templateId: "l3", data: { name: "Sam" } };
  it("a Program-hinted card's Cue stays on preview; its Take goes to program", () => {
    expect(hotcardFireMessage({ ...card, channelHint: "program" }, "cue")).toEqual({ type: "cue", channel: "preview", templateId: "l3", data: { name: "Sam" } });
    expect(hotcardFireMessage({ ...card, channelHint: "program" }, "take")).toEqual({ type: "take", channel: "program", templateId: "l3", data: { name: "Sam" } });
  });
  it("a legacy Preview hint doesn't stop a Take reaching program; another output is honoured", () => {
    expect(hotcardFireMessage({ ...card, channelHint: "preview" }, "take")).toMatchObject({ type: "take", channel: "program" });
    expect(hotcardFireMessage({ ...card, channelHint: "stage" }, "take")).toMatchObject({ type: "take", channel: "stage" });
    expect(hotcardFireMessage({ ...card, channelHint: "stage" }, "cue")).toMatchObject({ type: "cue", channel: "preview" });
  });
});
