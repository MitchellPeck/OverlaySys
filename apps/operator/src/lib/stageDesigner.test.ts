import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  STAGE_SIZE_PRESETS,
  centeredRectAt,
  createTrailingThrottle,
  sizePresetKey,
  stageEditorShortcut,
} from "./stageDesigner";

const key = (k: Partial<Parameters<typeof stageEditorShortcut>[0]>) =>
  stageEditorShortcut({ code: "", key: "", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...k });

describe("stageEditorShortcut", () => {
  it("maps Cmd/Ctrl+Z to undo and Shift+Cmd/Ctrl+Z to redo", () => {
    expect(key({ code: "KeyZ", metaKey: true })).toBe("undo");
    expect(key({ code: "KeyZ", ctrlKey: true })).toBe("undo");
    expect(key({ code: "KeyZ", metaKey: true, shiftKey: true })).toBe("redo");
    expect(key({ code: "KeyZ", ctrlKey: true, shiftKey: true })).toBe("redo");
  });

  it("maps Cmd/Ctrl+S to save and Cmd/Ctrl+D to duplicate", () => {
    expect(key({ code: "KeyS", metaKey: true })).toBe("save");
    expect(key({ code: "KeyD", ctrlKey: true })).toBe("duplicate");
  });

  it("maps Delete and Backspace to delete, without modifiers only", () => {
    expect(key({ code: "Delete", key: "Delete" })).toBe("delete");
    expect(key({ code: "Backspace", key: "Backspace" })).toBe("delete");
    expect(key({ code: "Backspace", key: "Backspace", metaKey: true })).toBeNull();
  });

  it("ignores plain letters, arrows and Alt chords", () => {
    expect(key({ code: "KeyZ" })).toBeNull();
    expect(key({ code: "KeyS", metaKey: true, altKey: true })).toBeNull();
    expect(key({ code: "ArrowLeft" })).toBeNull();
  });
});

describe("createTrailingThrottle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fires the first call immediately, then at most once per window with the latest value", () => {
    const calls: number[] = [];
    const t = createTrailingThrottle((v: number) => calls.push(v), 150);
    t.call(1);
    expect(calls).toEqual([1]);
    t.call(2);
    t.call(3);
    expect(calls).toEqual([1]);
    vi.advanceTimersByTime(149);
    expect(calls).toEqual([1]);
    vi.advanceTimersByTime(1);
    expect(calls).toEqual([1, 3]);
    vi.advanceTimersByTime(500);
    expect(calls).toEqual([1, 3]);
  });

  it("spaces a call made during the trailing window a full window after the trailing send", () => {
    const calls: number[] = [];
    const t = createTrailingThrottle((v: number) => calls.push(v), 150);
    t.call(1);
    t.call(2);
    vi.advanceTimersByTime(150); // trailing 2 fires at t=150
    t.call(3);
    expect(calls).toEqual([1, 2]);
    vi.advanceTimersByTime(150);
    expect(calls).toEqual([1, 2, 3]);
  });

  it("fires immediately again once a window has passed with no pending call", () => {
    const calls: number[] = [];
    const t = createTrailingThrottle((v: number) => calls.push(v), 150);
    t.call(1);
    vi.advanceTimersByTime(200);
    t.call(2);
    expect(calls).toEqual([1, 2]);
  });

  it("cancel drops a pending trailing call", () => {
    const calls: number[] = [];
    const t = createTrailingThrottle((v: number) => calls.push(v), 150);
    t.call(1);
    t.call(2);
    t.cancel();
    vi.advanceTimersByTime(500);
    expect(calls).toEqual([1]);
  });
});

describe("size presets", () => {
  it("lists the spec sizes (custom is separate)", () => {
    expect(STAGE_SIZE_PRESETS.map((p) => `${p.w}x${p.h}`)).toEqual(["1920x1080", "3840x2160", "1920x1200", "1600x1200"]);
  });

  it("names the matching preset, or custom", () => {
    expect(sizePresetKey({ w: 3840, h: 2160 })).toBe("3840x2160");
    expect(sizePresetKey({ w: 1000, h: 500 })).toBe("custom");
  });
});

describe("centeredRectAt", () => {
  const canvas = { w: 1920, h: 1080 };

  it("centers the rect on the point", () => {
    expect(centeredRectAt({ x: 960, y: 540 }, 480, 200, canvas)).toEqual({ x: 720, y: 440, w: 480, h: 200 });
  });

  it("keeps the rect inside the canvas near an edge", () => {
    expect(centeredRectAt({ x: 10, y: 1075 }, 480, 200, canvas)).toEqual({ x: 0, y: 880, w: 480, h: 200 });
  });

  it("shrinks to the canvas when the canvas is smaller than the rect", () => {
    expect(centeredRectAt({ x: 50, y: 50 }, 480, 200, { w: 300, h: 100 })).toEqual({ x: 0, y: 0, w: 300, h: 100 });
  });
});
