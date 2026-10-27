import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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
import * as channelConfigs from "./channelConfigs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ChannelConfigSchema, SPEAKER_LAYOUT, ShowSchema, SongSchema, StageLayoutSchema } from "@overlaysys/core";

// Hermetic: the whole file runs against a temp data dir (connect() lazily
// seeds storage, so the env must stay fixed until everything has settled).
let dataDir: string;
let prevDataDir: string | undefined;
beforeAll(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "overlaysys-ws-stage-"));
  prevDataDir = process.env["OVERLAYSYS_DATA_DIR"];
  process.env["OVERLAYSYS_DATA_DIR"] = dataDir;
});
afterAll(async () => {
  // Close every socket first so nothing new starts, then let the lazy
  // seeding writes connect() kicked off finish before removing the dir
  // (removing it under an in-flight write would reject with ENOENT).
  // Only sockets a test didn't already close, so no close handler runs twice.
  for (const s of sockets) if (!s.closed) s.emit("close");
  await new Promise((r) => setTimeout(r, 300));
  await fs.rm(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  if (prevDataDir === undefined) delete process.env["OVERLAYSYS_DATA_DIR"];
  else process.env["OVERLAYSYS_DATA_DIR"] = prevDataDir;
});

/**
 * Minimal stand-in for a `ws` socket: an EventEmitter with the readyState +
 * send surface handleConnection touches. Messages the server sends are
 * decoded into `sent` so tests can assert on the sequence.
 */
class FakeSocket extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  /** Set once "close" was emitted (by a test or afterAll). */
  closed = false;
  sent: ServerMessage[] = [];
  constructor() {
    super();
    this.once("close", () => {
      this.closed = true;
    });
  }
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

const sockets: FakeSocket[] = [];
function connect(): FakeSocket {
  const sock = new FakeSocket();
  sockets.push(sock);
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
  const stageCh = (id: string) => ChannelConfigSchema.parse({ id, name: id, kind: "stage" });
  function mockStageChannels(): void {
    vi.spyOn(channelConfigs, "getChannelConfig").mockImplementation(async (id) =>
      id.startsWith("stage-") ? stageCh(id) : null,
    );
  }
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

  it("sends a stage_layout_previews snapshot on connect", async () => {
    mockStageChannels();
    const owner = connect();
    await owner.client({ type: "stage_layout_preview", channel: "stage-ws-snap", layout });
    const late = connect();
    expect(late.sent).toContainEqual({
      type: "stage_layout_previews",
      previews: [{ channel: "stage-ws-snap", layoutId: layout.id }],
    });
    owner.emit("close");
  });

  it("clears a socket's previews when it closes", async () => {
    mockStageChannels();
    const sock = connect();
    await sock.client({ type: "stage_layout_preview", channel: "stage-ws-prev", layout });
    expect(stageFeedHub.listPreviews()).toContainEqual({ channel: "stage-ws-prev", layoutId: layout.id });
    sock.emit("close");
    expect(stageFeedHub.listPreviews()).toEqual([]);
  });

  it("closing one socket keeps another socket's preview on a different channel", async () => {
    mockStageChannels();
    const a = connect();
    const b = connect();
    await a.client({ type: "stage_layout_preview", channel: "stage-ws-a", layout });
    await b.client({ type: "stage_layout_preview", channel: "stage-ws-b", layout });
    a.emit("close");
    expect(stageFeedHub.listPreviews()).toEqual([{ channel: "stage-ws-b", layoutId: layout.id }]);
    b.emit("close");
  });

  it("saving a layout clears its previews", async () => {
    mockStageChannels();
    vi.spyOn(stageLayouts, "saveStageLayout").mockImplementation(async (l) => l);
    vi.spyOn(stageLayouts, "listStageLayoutMetas").mockResolvedValue([]);
    const sock = connect();
    await sock.client({ type: "stage_layout_preview", channel: "stage-ws-save", layout });
    expect(stageFeedHub.listPreviews()).toHaveLength(1);
    await sock.client({ type: "save_stage_layout", layout });
    expect(stageFeedHub.listPreviews()).toEqual([]);
    sock.emit("close");
  });

  it("a quick preview on→off from one socket ends off even if the channel lookup is slow", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    vi.spyOn(channelConfigs, "getChannelConfig").mockImplementation(async (id) => {
      await gate;
      return stageCh(id);
    });
    const sock = connect();
    await sock.client({ type: "stage_layout_preview", channel: "stage-ws-race", layout });
    await sock.client({ type: "stage_layout_preview", channel: "stage-ws-race", layout: null });
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(stageFeedHub.listPreviews()).toEqual([]);
    sock.emit("close");
  });

  it("a slow preview on that lands after the socket closed is dropped", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    vi.spyOn(channelConfigs, "getChannelConfig").mockImplementation(async (id) => {
      await gate;
      return stageCh(id);
    });
    const sock = connect();
    await sock.client({ type: "stage_layout_preview", channel: "stage-ws-race3", layout });
    sock.emit("close");
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(stageFeedHub.listPreviews()).toEqual([]);
  });

  it("a slow preview on is superseded by a newer on from the same socket", async () => {
    const other = StageLayoutSchema.parse({ id: "stage-layout-wsws0002", name: "WS2", widgets: [] });
    const releases: (() => void)[] = [];
    vi.spyOn(channelConfigs, "getChannelConfig").mockImplementation(async (id) => {
      await new Promise<void>((r) => releases.push(r));
      return stageCh(id);
    });
    const sock = connect();
    await sock.client({ type: "stage_layout_preview", channel: "stage-ws-race2", layout });
    await sock.client({ type: "stage_layout_preview", channel: "stage-ws-race2", layout: other });
    releases[1]?.();
    await new Promise((r) => setTimeout(r, 0));
    releases[0]?.();
    await new Promise((r) => setTimeout(r, 0));
    expect(stageFeedHub.listPreviews()).toEqual([{ channel: "stage-ws-race2", layoutId: other.id }]);
    sock.emit("close");
  });

  it("stage_layout_preview on a non-stage channel errors not_stage_channel", async () => {
    vi.spyOn(channelConfigs, "getChannelConfig").mockResolvedValue(
      ChannelConfigSchema.parse({ id: "program", name: "Program", kind: "graphics" }),
    );
    const sock = connect();
    await sock.client({ type: "stage_layout_preview", channel: "program", layout });
    expect(sock.sent).toContainEqual({ type: "error", code: "not_stage_channel", message: "program" });
    expect(stageFeedHub.listPreviews()).toEqual([]);
  });
});
