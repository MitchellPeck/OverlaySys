import { describe, it, expect } from "vitest";
import { decodeClient, decodeServer, encode, PROTOCOL_VERSION } from "./index";

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

  it("is protocol version 2", () => {
    expect(PROTOCOL_VERSION).toBe(2);
  });
});
