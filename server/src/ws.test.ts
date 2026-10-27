import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { ServerMessage } from "@overlaysys/ws-protocol";
import { handleConnection } from "./ws";
import * as channels from "./channels";
import * as shows from "./shows";
import * as songs from "./songs";
import * as songSession from "./songSession";
import * as templates from "./templates";
import * as stageState from "./stageState";
import * as stageLayouts from "./stageLayouts";
import * as stageFeedHub from "./stageFeedHub";
import { SPEAKER_LAYOUT, ShowSchema, SongSchema, StageLayoutSchema } from "@overlaysys/core";

/**
 * Minimal stand-in for a `ws` socket: an EventEmitter with the readyState +
 * send surface handleConnection touches. Messages the server sends are
 * decoded into `sent` so tests can assert on the sequence.
 */
class FakeSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  sent: ServerMessage[] = [];
  send(raw: string): void {
    this.sent.push(JSON.parse(raw) as ServerMessage);
  }
  /** Deliver a client message as the ws library would. */
  async client(msg: unknown): Promise<void> {
    this.emit("message", Buffer.from(JSON.stringify(msg)));
    // handleConnection's listener is async; let it settle.
    await new Promise((r) => setImmediate(r));
  }
}

const silentLog = {
  info() {},
  warn() {},
  error() {},
  debug() {},
  trace() {},
  fatal() {},
  child() {
    return silentLog;
  },
} as unknown as Parameters<typeof handleConnection>[2];

function connect(): FakeSocket {
  const sock = new FakeSocket();
  handleConnection(sock as never, {} as never, silentLog);
  return sock;
}

function states(sock: FakeSocket, channel: string) {
  return sock.sent.filter((m) => m.type === "state" && m.channel === channel);
}

describe("ws subscribe", () => {
  it("pushes current state immediately on subscribe", async () => {
    const ch = `t-${Date.now()}-a`;
    channels.take(ch, "tpl", { a: "1" });
    const sock = connect();
    await sock.client({ type: "subscribe", channel: ch, role: "renderer" });
    const got = states(sock, ch);
    expect(got).toHaveLength(1);
    expect(got[0]?.type === "state" && got[0].state.active?.templateId).toBe("tpl");
  });

  it("re-pushes current state on a duplicate subscribe instead of going silent", async () => {
    // A mirror renderer that re-subscribes after learning its source (or a
    // client that retries) must be able to resync from the server's copy;
    // a silent no-op leaves it painting whatever it last saw.
    const ch = `t-${Date.now()}-b`;
    channels.take(ch, "tpl", { a: "1" });
    const sock = connect();
    await sock.client({ type: "subscribe", channel: ch, role: "renderer" });
    channels.take(ch, "tpl2", { a: "2" });
    // The live subscription already delivered tpl2; a duplicate subscribe
    // must deliver it once more rather than nothing.
    const before = states(sock, ch).length;
    await sock.client({ type: "subscribe", channel: ch, role: "renderer" });
    const after = states(sock, ch);
    expect(after.length).toBe(before + 1);
    const last = after[after.length - 1];
    expect(last?.type === "state" && last.state.active?.templateId).toBe("tpl2");
  });

  it("keeps a single live listener per channel across duplicate subscribes", async () => {
    const ch = `t-${Date.now()}-c`;
    const sock = connect();
    await sock.client({ type: "subscribe", channel: ch, role: "renderer" });
    await sock.client({ type: "subscribe", channel: ch, role: "renderer" });
    const before = states(sock, ch).length;
    channels.take(ch, "tpl", {});
    await new Promise((r) => setImmediate(r));
    // Exactly one delta for the take — not one per subscribe call.
    expect(states(sock, ch).length).toBe(before + 1);
  });
});

describe("ws song takes set liveRow", () => {
  const song = SongSchema.parse({
    id: "song-lr",
    title: "Amazing Grace",
    sections: [{ id: "v1", kind: "verse", label: "Verse 1", slides: [{ id: "s1", lines: ["Amazing grace"] }] }],
    defaultArrangement: ["v1"],
  });
  const show = ShowSchema.parse({
    id: "show-lr",
    name: "Sunday",
    projectId: "p",
    songs: [],
    rows: [{ kind: "song", id: "row-lr", songId: "song-lr", lyricTemplateId: "lyrics" }],
  });
  const SRC = { showId: "show-lr", rowId: "row-lr" };

  function mockLibrary() {
    vi.spyOn(shows, "getShow").mockResolvedValue(show);
    vi.spyOn(songs, "getSong").mockResolvedValue(song);
    vi.spyOn(templates, "getTemplate").mockResolvedValue(null);
    vi.spyOn(songSession, "start").mockImplementation(() => {});
    vi.spyOn(songSession, "promoteTo").mockImplementation(() => {});
  }
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("song_take sets liveRow on its channel", async () => {
    mockLibrary();
    const ch = `t-${Date.now()}-song`;
    const sock = connect();
    await sock.client({ type: "song_take", channel: ch, showId: "show-lr", songRowId: "row-lr" });
    await vi.waitFor(() => expect(channels.getState(ch).liveRow).toEqual(SRC));
  });

  it("song_take_pvw_to_pgm sets liveRow on toChannel, not fromChannel", async () => {
    mockLibrary();
    const from = `t-${Date.now()}-from`;
    const to = `t-${Date.now()}-to`;
    const sock = connect();
    await sock.client({ type: "song_take_pvw_to_pgm", showId: "show-lr", songRowId: "row-lr", fromChannel: from, toChannel: to });
    await vi.waitFor(() => expect(channels.getState(to).liveRow).toEqual(SRC));
    expect(channels.getState(from).liveRow).toBeUndefined();
  });

  it("take_song_sub lyrics sets liveRow on the resolved channel", async () => {
    mockLibrary();
    const ch = `t-${Date.now()}-sub`;
    const sock = connect();
    await sock.client({ type: "take_song_sub", showId: "show-lr", songRowId: "row-lr", sub: "lyrics", channel: ch });
    await vi.waitFor(() => expect(channels.getState(ch).liveRow).toEqual(SRC));
  });
});

describe("ws show writes reconcile the active notes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    stageState._resetForTest();
  });

  it("delete_show of the active notes' show clears them", async () => {
    await stageState.dispatchStage({ type: "select", showId: "gone-show", notesId: "n1" });
    vi.spyOn(shows, "deleteShow").mockResolvedValue(true);
    vi.spyOn(shows, "getShow").mockResolvedValue(null);
    vi.spyOn(shows, "listShowMetas").mockResolvedValue([]);
    const sock = connect();
    await sock.client({ type: "delete_show", showId: "gone-show" });
    await new Promise((r) => setImmediate(r));
    expect(stageState.getStageState().notes).toBeNull();
    const last = sock.sent.filter((m) => m.type === "stage_state").at(-1);
    expect(last).toMatchObject({ state: { notes: null } });
  });
});

describe("ws stage layouts", () => {
  const layout = StageLayoutSchema.parse({ id: "stage-layout-wsws0001", name: "WS", widgets: [] });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("save_stage_layout acks and broadcasts list and layout", async () => {
    vi.spyOn(stageLayouts, "saveStageLayout").mockImplementation(async (l) => l);
    vi.spyOn(stageLayouts, "listStageLayoutMetas").mockResolvedValue([]);
    const sock = connect();
    await sock.client({ type: "save_stage_layout", layout });
    expect(sock.sent).toContainEqual({ type: "ack", op: "save_stage_layout", id: layout.id });
    expect(sock.sent.some((m) => m.type === "stage_layout_list")).toBe(true);
    expect(sock.sent.some((m) => m.type === "stage_layout" && m.layout.id === layout.id)).toBe(true);
  });

  it("save_stage_layout of a built-in id errors read_only", async () => {
    const sock = connect();
    await sock.client({ type: "save_stage_layout", layout: SPEAKER_LAYOUT });
    await vi.waitFor(() =>
      expect(sock.sent.some((m) => m.type === "error" && m.code === "read_only")).toBe(true),
    );
  });

  it("clears a socket's previews when it closes", async () => {
    const sock = connect();
    await sock.client({ type: "stage_layout_preview", channel: "stage-ws-prev", layout });
    expect(stageFeedHub.listPreviews()).toContainEqual({ channel: "stage-ws-prev", layoutId: layout.id });
    sock.emit("close");
    expect(stageFeedHub.listPreviews()).toEqual([]);
  });
});
