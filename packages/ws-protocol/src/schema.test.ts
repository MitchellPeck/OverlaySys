import { describe, it, expect } from "vitest";
import { SPEAKER_LAYOUT } from "@overlaysys/core";
import { decodeClient, decodeServer, encode, PROTOCOL_VERSION, requestRef, ServerMessageSchema } from "./index";

describe("show_list scheduledFor", () => {
  it("decodes a show_list entry carrying scheduledFor", () => {
    const raw = encode({
      type: "show_list",
      shows: [
        { id: "s1", name: "5/17/26", projectId: "p1", rowCount: 3, scheduledFor: "2026-05-17" },
      ],
    });
    const msg = decodeServer(raw);
    if (msg.type !== "show_list") throw new Error("wrong type");
    expect(msg.shows[0]!.scheduledFor).toBe("2026-05-17");
  });

  it("decodes a show_list entry without scheduledFor", () => {
    const raw = encode({
      type: "show_list",
      shows: [{ id: "s2", name: "Untitled", projectId: "p1", rowCount: 0 }],
    });
    const msg = decodeServer(raw);
    if (msg.type !== "show_list") throw new Error("wrong type");
    expect(msg.shows[0]!.scheduledFor).toBeUndefined();
  });
});

describe("timer messages", () => {
  it("rejects timer_adjust with a non-number deltaMs", () => {
    expect(() => decodeClient(JSON.stringify({ type: "timer_adjust", id: "t1", deltaMs: "5" }))).toThrow();
  });

  it("rejects an out-of-range timer_adjust deltaMs", () => {
    expect(() => decodeClient(JSON.stringify({ type: "timer_adjust", id: "t1", deltaMs: 1e308 }))).toThrow();
  });

  it("rejects an out-of-range timer_create durationMs", () => {
    expect(() => decodeClient(JSON.stringify({ type: "timer_create", label: "x", mode: "countdown", durationMs: -1 }))).toThrow();
    expect(() => decodeClient(JSON.stringify({ type: "timer_create", label: "x", mode: "countdown", durationMs: 86_400_001 }))).toThrow();
  });

  it("defaults timer_create overtime to true", () => {
    const msg = decodeClient(JSON.stringify({ type: "timer_create", label: "Talk", mode: "countdown", durationMs: 1000 }));
    if (msg.type !== "timer_create") throw new Error("wrong type");
    expect(msg.overtime).toBe(true);
  });
});

describe("media messages", () => {
  it("decodes media_take", () => {
    const msg = decodeClient(encode({
      type: "media_take", channel: "program", rowId: "r1",
      assetUrl: "/assets/a.mp4", volume: 1, endAction: "clear",
    }));
    expect(msg.type).toBe("media_take");
  });

  it("rejects media_take with volume > 1", () => {
    expect(() => decodeClient(JSON.stringify({
      type: "media_take", channel: "program", rowId: "r1",
      assetUrl: "/a.mp4", volume: 1.5, endAction: "clear",
    }))).toThrow();
  });

  it("decodes media_control seek with time", () => {
    const msg = decodeClient(encode({
      type: "media_control", channel: "program", takenAt: 5, action: "seek", time: 30,
    }));
    if (msg.type !== "media_control") throw new Error("wrong type");
    expect(msg.time).toBe(30);
  });

  it("decodes media_status and media_clear", () => {
    expect(decodeClient(encode({
      type: "media_status", channel: "program", takenAt: 5,
      status: "playing", currentTime: 1.2, duration: 300,
    })).type).toBe("media_status");
    expect(decodeClient(encode({ type: "media_clear", channel: "program" })).type).toBe("media_clear");
  });

  it("decodes media_playback", () => {
    const msg = decodeServer(encode({
      type: "media_playback", channel: "program", takenAt: 5,
      playback: { status: "playing", currentTime: 2, duration: 300, updatedAt: 99 },
    }));
    if (msg.type !== "media_playback") throw new Error("wrong type");
    expect(msg.playback.currentTime).toBe(2);
  });

  it("decodes media_take transitions and media_clear cut", () => {
    const take = decodeClient(encode({
      type: "media_take", channel: "program", rowId: "r1",
      assetUrl: "/assets/a.mp4", volume: 1, endAction: "clear",
      transitionIn: { style: "zoom", durationMs: 800 },
      transitionOut: { style: "slide", durationMs: 300 },
    }));
    if (take.type !== "media_take") throw new Error("wrong type");
    expect(take.transitionIn).toEqual({ style: "zoom", durationMs: 800 });
    const clear = decodeClient(encode({ type: "media_clear", channel: "program", cut: true }));
    if (clear.type !== "media_clear") throw new Error("wrong type");
    expect(clear.cut).toBe(true);
  });

  it("rejects an unknown transition style", () => {
    expect(() => decodeClient(JSON.stringify({
      type: "media_take", channel: "program", rowId: "r1",
      assetUrl: "/a.mp4", volume: 1, endAction: "clear",
      transitionIn: { style: "spin", durationMs: 500 },
    }))).toThrow();
  });

  it("is protocol version 3", () => {
    expect(PROTOCOL_VERSION).toBe(3);
  });
});

describe("decodeServerTolerant", async () => {
  const { decodeServerTolerant } = await import("./index");

  it("returns null for a message type this client doesn't know", () => {
    expect(decodeServerTolerant(JSON.stringify({ type: "some_future_message", x: 1 }))).toBeNull();
  });

  it("decodes known types and still rejects malformed known types", () => {
    expect(decodeServerTolerant(encode({ type: "stt_levels", levels: [0.5], channels: [17] }))?.type).toBe(
      "stt_levels",
    );
    expect(() => decodeServerTolerant(JSON.stringify({ type: "stt_levels", levels: "x" }))).toThrow();
  });
});

describe("stt_levels_subscribe", () => {
  it("decodes the operator's opt-in", () => {
    expect(decodeClient(encode({ type: "stt_levels_subscribe", on: true }))).toEqual({
      type: "stt_levels_subscribe",
      on: true,
    });
  });
});

describe("stage layout messages", () => {
  it("parses save_stage_layout with the Speaker layout", () => {
    const m = decodeClient(JSON.stringify({ type: "save_stage_layout", layout: SPEAKER_LAYOUT }));
    expect(m.type).toBe("save_stage_layout");
  });
  it("parses stage_layout_preview with a null layout", () => {
    const m = decodeClient(JSON.stringify({ type: "stage_layout_preview", channel: "stage1", layout: null }));
    expect(m.type).toBe("stage_layout_preview");
  });
  it("decodes stage_layout_previews", () => {
    const msg = decodeServer(
      encode({ type: "stage_layout_previews", previews: [{ channel: "stage1", layoutId: "draft" }] }),
    );
    if (msg.type !== "stage_layout_previews") throw new Error("wrong type");
    expect(msg.previews[0]!.layoutId).toBe("draft");
  });
});

describe("[I5] error op/id and requestRef", () => {
  it("error replies may carry the request op and id", () => {
    const m = ServerMessageSchema.parse({ type: "error", code: "invalid", message: "Duplicate slide id", op: "save_deck", id: "d1" });
    expect(m).toEqual({ type: "error", code: "invalid", message: "Duplicate slide id", op: "save_deck", id: "d1" });
  });
  it("requestRef names the entity of save, delete and other requests", () => {
    expect(requestRef({ type: "save_deck", deck: { id: "d1" } } as never)).toEqual({ op: "save_deck", id: "d1" });
    expect(requestRef({ type: "delete_template", templateId: "t1" } as never)).toEqual({ op: "delete_template", id: "t1" });
    expect(requestRef({ type: "save_channel", config: { id: "c1" } } as never)).toEqual({ op: "save_channel", id: "c1" });
    expect(requestRef({ type: "clear_all_channels" } as never)).toEqual({ op: "clear_all_channels" });
  });
});
