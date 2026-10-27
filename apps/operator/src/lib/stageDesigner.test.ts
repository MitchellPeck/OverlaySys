import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { produce } from "immer";
import { StageLayoutSchema, type StageLayout } from "@overlaysys/core";
import { useStageEditor } from "./stageEditorStore";
import { patchWidget, toggleHidden } from "./stageLayoutOps";
import {
  STAGE_SIZE_PRESETS,
  shouldAdoptIncomingLayout,
  stageLayoutsEqual,
  centeredRectAt,
  createTrailingThrottle,
  shouldConfirmLinkNavigation,
  isLocalDraftEdit,
  sentinelPopAction,
  shouldDisarmSentinel,
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

describe("stageLayoutsEqual / shouldAdoptIncomingLayout", () => {
  const base = StageLayoutSchema.parse({
    id: "stage-layout-eq000001",
    name: "Mine",
    widgets: [{ id: "c", kind: "clock", rect: { x: 0, y: 0, w: 300, h: 100 } }],
  });
  /** What the server sends back: re-parsed through zod (schema key order) and stamped. */
  const echoOf = (l: StageLayout): StageLayout => ({
    ...StageLayoutSchema.parse(JSON.parse(JSON.stringify(l))),
    updatedAt: "2026-10-27T12:00:00.000Z",
  });

  beforeEach(() => useStageEditor.getState().setDraft(base));

  it("ignores key order and updatedAt", () => {
    const edited = produce(base, patchWidget("c", { style: { background: "#ff0000" } }));
    const echo = echoOf(edited);
    expect(JSON.stringify(echo.widgets[0])).not.toEqual(JSON.stringify(edited.widgets[0]));
    expect(stageLayoutsEqual(edited, echo)).toBe(true);
    expect(stageLayoutsEqual(edited, { ...echo, name: "Other" })).toBe(false);
  });

  it("keeps undo history when the save echo of a toggled widget arrives reordered", () => {
    useStageEditor.getState().commit(toggleHidden("c"));
    useStageEditor.getState().select(["c"]);
    const saved = useStageEditor.getState().draft!;
    useStageEditor.getState().markSaved();
    const echo = echoOf(saved);
    expect(JSON.stringify(echo.widgets[0])).not.toEqual(JSON.stringify(saved.widgets[0]));
    const s = useStageEditor.getState();
    const adopt = shouldAdoptIncomingLayout({ draft: s.draft, dirty: s.dirty, awaitingEchoId: saved.id }, echo);
    // The deep compare alone recognises it too.
    const adoptNoMarker = shouldAdoptIncomingLayout({ draft: s.draft, dirty: s.dirty, awaitingEchoId: null }, echo);
    expect(adopt).toBe(false);
    expect(adoptNoMarker).toBe(false);
    if (adopt) useStageEditor.getState().setDraft(echo);
    expect(useStageEditor.getState().history).toHaveLength(1);
    expect(useStageEditor.getState().selectedIds).toEqual(["c"]);
  });

  it("adopts a different layout when clean, never when dirty", () => {
    const other = { ...base, name: "Renamed elsewhere" };
    expect(shouldAdoptIncomingLayout({ draft: base, dirty: false, awaitingEchoId: null }, other)).toBe(true);
    expect(shouldAdoptIncomingLayout({ draft: base, dirty: true, awaitingEchoId: null }, other)).toBe(false);
    expect(shouldAdoptIncomingLayout({ draft: null, dirty: false, awaitingEchoId: null }, other)).toBe(true);
  });

  it("skips the awaited save echo even if the server normalised it", () => {
    const echo = { ...base, background: "#000" };
    expect(shouldAdoptIncomingLayout({ draft: base, dirty: false, awaitingEchoId: base.id }, echo)).toBe(false);
  });
});

describe("shouldConfirmLinkNavigation", () => {
  const here = "http://localhost:3000/design/stage/edit?id=abc";
  const click = (o: Partial<Parameters<typeof shouldConfirmLinkNavigation>[0]> = {}) =>
    shouldConfirmLinkNavigation({
      dirty: true,
      href: "/rundown",
      currentHref: here,
      button: 0,
      modified: false,
      defaultPrevented: false,
      target: null,
      download: false,
      ...o,
    });

  it("confirms a plain left click on an in-app link while dirty", () => {
    expect(click()).toBe(true);
    expect(click({ href: "http://localhost:3000/design/stage" })).toBe(true);
    expect(click({ href: "/design/stage/edit?id=other" })).toBe(true);
    expect(click({ target: "_self" })).toBe(true);
  });
  it("never confirms when clean", () => {
    expect(click({ dirty: false })).toBe(false);
  });
  it("leaves new-tab, download, prevented and non-primary clicks alone", () => {
    expect(click({ modified: true })).toBe(false);
    expect(click({ button: 1 })).toBe(false);
    expect(click({ target: "_blank" })).toBe(false);
    expect(click({ download: true })).toBe(false);
    expect(click({ defaultPrevented: true })).toBe(false);
  });
  it("leaves other origins (beforeunload covers them) and same-page hash links alone", () => {
    expect(click({ href: "https://example.com/" })).toBe(false);
    expect(click({ href: "mailto:a@b.c" })).toBe(false);
    expect(click({ href: "#top" })).toBe(false);
    expect(click({ href: "/design/stage/edit?id=abc#x" })).toBe(false);
  });
});

describe("isLocalDraftEdit", () => {
  const a = StageLayoutSchema.parse({ id: "l", name: "A", widgets: [] }) as StageLayout;
  const b = { ...a, name: "B" };
  it("is a local edit when the draft changes and stays dirty (even if it was already dirty)", () => {
    expect(isLocalDraftEdit({ draft: a, dirty: true }, { draft: b, dirty: true })).toBe(true);
    expect(isLocalDraftEdit({ draft: a, dirty: false }, { draft: b, dirty: true })).toBe(true);
  });
  it("is not when the draft is unchanged, cleared or adopted clean", () => {
    expect(isLocalDraftEdit({ draft: a, dirty: true }, { draft: a, dirty: true })).toBe(false);
    expect(isLocalDraftEdit({ draft: a, dirty: true }, { draft: null, dirty: false })).toBe(false);
    expect(isLocalDraftEdit({ draft: a, dirty: false }, { draft: b, dirty: false })).toBe(false);
  });
  it("catches a commit made while a save was in flight (dirty never went clean)", () => {
    useStageEditor.getState().setDraft(a);
    useStageEditor.getState().commit((d) => {
      d.name = "edited";
    });
    const prev = useStageEditor.getState();
    // ack arrives for an older draft: markSaved is skipped, dirty stays true
    useStageEditor.getState().commit((d) => {
      d.name = "edited again";
    });
    expect(isLocalDraftEdit(prev, useStageEditor.getState())).toBe(true);
  });
});

describe("sentinelPopAction", () => {
  const A = "http://x/design/stage/edit?id=a";
  const B = "http://x/design/stage/edit?id=b";
  const pop = (o: Partial<Parameters<typeof sentinelPopAction>[0]>) =>
    sentinelPopAction({ armedHref: A, currentHref: A, onSentinel: false, dirty: true, confirm: () => false, ...o });
  it("does nothing when no sentinel is armed", () => {
    const confirm = vi.fn(() => true);
    expect(pop({ armedHref: null, confirm })).toBe("none");
    expect(confirm).not.toHaveBeenCalled();
  });
  it("ignores a pop that lands on another URL than the armed one (e.g. a stale sentinel after Duplicate)", () => {
    const confirm = vi.fn(() => true);
    expect(pop({ currentHref: B, confirm })).toBe("none");
    expect(confirm).not.toHaveBeenCalled();
  });
  it("ignores a pop that lands ON a sentinel rather than popping ours", () => {
    const confirm = vi.fn(() => true);
    expect(pop({ onSentinel: true, confirm })).toBe("none");
    expect(confirm).not.toHaveBeenCalled();
  });
  it("completes the back navigation without asking when clean", () => {
    const confirm = vi.fn(() => false);
    expect(pop({ dirty: false, confirm })).toBe("back");
    expect(confirm).not.toHaveBeenCalled();
  });
  it("asks when dirty: OK leaves, Cancel re-pushes the sentinel", () => {
    expect(pop({ confirm: () => true })).toBe("back");
    expect(pop({ confirm: () => false })).toBe("repush");
  });
});

describe("shouldDisarmSentinel", () => {
  const A = "http://x/design/stage/edit?id=a";
  it("disarms once clean while still sitting on our own sentinel", () => {
    expect(shouldDisarmSentinel({ armedHref: A, currentHref: A, onSentinel: true, dirty: false })).toBe(true);
  });
  it("keeps it while dirty, when not armed, or when not on our sentinel", () => {
    expect(shouldDisarmSentinel({ armedHref: A, currentHref: A, onSentinel: true, dirty: true })).toBe(false);
    expect(shouldDisarmSentinel({ armedHref: null, currentHref: A, onSentinel: true, dirty: false })).toBe(false);
    expect(shouldDisarmSentinel({ armedHref: A, currentHref: "http://x/other", onSentinel: true, dirty: false })).toBe(false);
    expect(shouldDisarmSentinel({ armedHref: A, currentHref: A, onSentinel: false, dirty: false })).toBe(false);
  });
});
