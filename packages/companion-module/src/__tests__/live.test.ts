import { describe, expect, it } from "vitest";
import type { ChannelState } from "@overlaysys/core";
import { apply } from "../state";
import { initialState, type CompanionState } from "../types";
import { feedbackPredicate } from "../feedbacks";
import { dispatchAction } from "../actions";
import { projectVariables, variableDefinitions } from "../variables";
import { sttSilentSec, videoInfo } from "../live";

function withVideo(state: CompanionState, channel = "program"): CompanionState {
  const st: ChannelState = {
    channel,
    active: null,
    media: {
      rowId: "row-1",
      label: "Announcements",
      assetUrl: "/assets/a.mp4",
      volume: 1,
      endAction: "hold",
      transitionIn: { style: "fade", durationMs: 500 },
      transitionOut: { style: "fade", durationMs: 500 },
      takenAt: 10,
      paused: false,
      playback: { status: "playing", currentTime: 0, duration: 95, updatedAt: 1 },
    },
  };
  return apply(state, { type: "state", channel, state: st });
}

describe("video variables", () => {
  it("follow the playback ticks", () => {
    let s = withVideo(initialState());
    s = apply(s, {
      type: "media_playback",
      channel: "program",
      takenAt: 10,
      playback: { status: "playing", currentTime: 30.4, duration: 95, updatedAt: 2 },
    });
    expect(videoInfo(s, "program")).toMatchObject({ title: "Announcements", elapsedSec: 30, remainingSec: 65, progress: 32 });
    const vars = projectVariables(s, ["program"]);
    expect(vars["program_video_title"]).toBe("Announcements");
    expect(vars["program_video_elapsed"]).toBe("0:30");
    expect(vars["program_video_remaining"]).toBe("1:05");
    expect(vars["program_video_progress"]).toBe("32");
  });

  it("ignore a tick from a previous take", () => {
    let s = withVideo(initialState());
    s = apply(s, {
      type: "media_playback",
      channel: "program",
      takenAt: 9,
      playback: { status: "playing", currentTime: 80, duration: 95, updatedAt: 2 },
    });
    expect(videoInfo(s, "program")?.elapsedSec).toBe(0);
  });

  it("are defined per channel", () => {
    const ids = variableDefinitions(["program"]).map((d) => d.variableId);
    expect(ids).toEqual(expect.arrayContaining(["program_video_remaining", "program_outputs", "server_version", "stt_silent_sec"]));
  });
});

describe("new feedbacks", () => {
  it("video remaining below N", () => {
    let s = withVideo(initialState());
    s = apply(s, {
      type: "media_playback",
      channel: "program",
      takenAt: 10,
      playback: { status: "playing", currentTime: 88, duration: 95, updatedAt: 2 },
    });
    expect(feedbackPredicate(s, "video_remaining_below", { channel: "program", seconds: 10 })).toBe(true);
    expect(feedbackPredicate(s, "video_remaining_below", { channel: "program", seconds: 5 })).toBe(false);
  });

  it("video errored", () => {
    let s = withVideo(initialState());
    s = apply(s, {
      type: "media_playback",
      channel: "program",
      takenAt: 10,
      playback: { status: "error", currentTime: 0, duration: 0, updatedAt: 2, error: "decode" },
    });
    expect(feedbackPredicate(s, "video_errored", { channel: "program" })).toBe(true);
  });

  it("output offline only once the server has reported outputs", () => {
    let s = initialState();
    expect(feedbackPredicate(s, "output_offline", { channel: "program" })).toBe(false);
    s = apply(s, { type: "outputs_state", outputs: { preview: { count: 1, lastSeen: 1, labels: [] } } });
    expect(feedbackPredicate(s, "output_offline", { channel: "program" })).toBe(true);
    expect(feedbackPredicate(s, "output_offline", { channel: "preview" })).toBe(false);
    expect(projectVariables(s, ["program", "preview"])["preview_outputs"]).toBe("1");
  });

  it("STT silent counts from the song going live or the last suggestion", () => {
    let s = initialState();
    expect(sttSilentSec(s)).toBeNull();
    s = apply(s, {
      type: "state",
      channel: "program",
      state: {
        channel: "program",
        active: null,
        songSession: { songId: "s", arrangement: [], cursor: { sectionIdx: 0, slideIdx: 0 }, blanked: false, trustMode: false },
      } as unknown as ChannelState,
    });
    const since = s.songLiveSince!;
    expect(sttSilentSec(s, since + 20_000)).toBe(20);
    s = { ...s, stt: { confidence: 0.8, lastHypothesis: "amazing grace", lastMatchAt: since + 15_000 } };
    expect(sttSilentSec(s, since + 20_000)).toBe(5);
    expect(feedbackPredicate({ ...s, songLiveSince: since - 60_000, stt: { ...s.stt, lastMatchAt: null } }, "stt_silent", { seconds: 10 })).toBe(true);
  });
});

describe("new actions", () => {
  it("panic clears every channel and cuts video", () => {
    expect(dispatchAction(initialState(), "panic", {}).messages).toEqual([{ type: "clear_all_channels", cutVideo: true }]);
    expect(dispatchAction(initialState(), "panic", { keepVideo: true }).messages).toEqual([
      { type: "clear_all_channels", cutVideo: false },
    ]);
  });

  it("create countdown starts a timer", () => {
    expect(dispatchAction(initialState(), "create_countdown", { label: "Walk-in", minutes: 2, seconds: 30 }).messages).toEqual([
      { type: "timer_create", label: "Walk-in", mode: "countdown", durationMs: 150_000, overtime: true, start: true },
    ]);
    expect(dispatchAction(initialState(), "create_countdown", { minutes: 0, seconds: 0 }).messages).toEqual([]);
  });

  it("cursor back one row", () => {
    expect(dispatchAction(initialState(), "cursor_prev", {}).localEvents).toEqual([{ type: "local_cursor_advance", delta: -1 }]);
  });
});

describe("hello", () => {
  it("records the server version", () => {
    const s = apply(initialState(), { type: "hello", protocolVersion: 3, serverTime: Date.now(), serverVersion: "1.2.3" });
    expect(projectVariables(s, [])["server_version"]).toBe("1.2.3");
  });
});
