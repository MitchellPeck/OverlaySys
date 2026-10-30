import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { _settleWritesForTest } from "./storage";
import { EventEmitter } from "node:events";
import type { ServerMessage } from "@overlaysys/ws-protocol";
import { handleConnection, replyTo } from "./ws";
import * as channels from "./channels";
import * as outputs from "./outputs";
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

// CCLI usage logging writes to the data dir; keep tests off disk.
vi.mock("./songUsage", () => ({ recordSongUse: vi.fn(async () => false) }));

// Capture the module-scope level listener ws.ts registers at import, so a test
// can fire a meter update without a real spawner.
const spawnerHooks = vi.hoisted(() => ({
  levels: null as null | ((l: number[], c: number[]) => void),
  match: null as null | ((...a: unknown[]) => void),
}));
vi.mock("./songSession", async (importOriginal) => {
  const real = await importOriginal<typeof import("./songSession")>();
  return {
    ...real,
    onMatch: (fn: never) => {
      spawnerHooks.match = fn;
      return real.onMatch(fn);
    },
  };
});
vi.mock("./sttSpawner", async (importOriginal) => {
  const real = await importOriginal<typeof import("./sttSpawner")>();
  return {
    ...real,
    subscribeLevels: (fn: (l: number[], c: number[]) => void) => {
      spawnerHooks.levels = fn;
      return real.subscribeLevels(fn);
    },
  };
});

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
  await _settleWritesForTest();
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

describe("ws output presence", () => {
  function lastOutputs(sock: FakeSocket) {
    const all = sock.sent.filter((m) => m.type === "outputs_state");
    const last = all[all.length - 1];
    return last?.type === "outputs_state" ? last.outputs : undefined;
  }

  it("broadcasts outputs_state when a renderer subscribes and when it leaves", async () => {
    const ch = `t-${Date.now()}-out`;
    const operator = connect();
    expect(lastOutputs(operator)).toBeDefined();
    const renderer = connect();
    await renderer.client({ type: "subscribe", channel: ch, role: "renderer", label: "OBS" });
    expect(lastOutputs(operator)?.[ch]).toMatchObject({ count: 1, labels: ["OBS"] });
    renderer.emit("close");
    expect(lastOutputs(operator)?.[ch]).toBeUndefined();
  });

  it("operator subscriptions and a mirror's source subscription aren't outputs", async () => {
    const ch = `t-${Date.now()}-out2`;
    const operator = connect();
    await operator.client({ type: "subscribe", channel: ch, role: "operator" });
    const alpha = connect();
    await alpha.client({ type: "subscribe", channel: ch, role: "renderer", mirrorFor: `${ch}-alpha` });
    expect(lastOutputs(operator)?.[ch]).toBeUndefined();
    alpha.emit("close");
  });

  it("only the first renderer on a channel reports media status", async () => {
    const ch = `t-${Date.now()}-media`;
    channels.mediaTake(ch, { rowId: "r", assetUrl: "/assets/x.mp4", volume: 1, endAction: "hold" });
    const takenAt = channels.getState(ch).media!.takenAt;
    const a = connect();
    const b = connect();
    const report = (currentTime: number) => ({
      type: "media_status",
      channel: ch,
      takenAt,
      status: "playing",
      currentTime,
      duration: 10,
    });
    await a.client(report(1));
    await b.client(report(5));
    expect(channels.getState(ch).media!.playback.currentTime).toBe(1);
    a.emit("close");
    await b.client(report(6));
    expect(channels.getState(ch).media!.playback.currentTime).toBe(6);
    b.emit("close");
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

  it("stt_match goes only to sockets that subscribed", async () => {
    vi.spyOn(shows, "getShow").mockResolvedValue(show);
    vi.spyOn(songs, "getSong").mockResolvedValue(song);
    vi.spyOn(templates, "getTemplate").mockResolvedValue(null);
    const ch = `t-${Date.now()}-stt`;
    const operator = connect();
    const renderer = connect();
    await operator.client({ type: "stt_match_subscribe", on: true });
    await operator.client({ type: "song_take", channel: ch, showId: "show-lr", songRowId: "row-lr" });
    await vi.waitFor(() => expect(songSession.getSession(ch)).toBeTruthy());
    await renderer.client({ type: "stt_hypothesis", audioSourceId: "a1", text: "amazing grace", t: Date.now() });
    await vi.waitFor(() => expect(operator.sent.some((m) => m.type === "stt_match")).toBe(true));
    expect(renderer.sent.some((m) => m.type === "stt_match")).toBe(false);
    songSession.end(ch);
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
    // Messages from one socket are handled in order, so the newer "on" only
    // starts once the slow one has finished — and it wins.
    const other = StageLayoutSchema.parse({ id: "stage-layout-wsws0002", name: "WS2", widgets: [] });
    const releases: (() => void)[] = [];
    vi.spyOn(channelConfigs, "getChannelConfig").mockImplementation(async (id) => {
      await new Promise<void>((r) => releases.push(r));
      return stageCh(id);
    });
    const sock = connect();
    await sock.client({ type: "stage_layout_preview", channel: "stage-ws-race2", layout });
    await sock.client({ type: "stage_layout_preview", channel: "stage-ws-race2", layout: other });
    expect(releases).toHaveLength(1);
    releases[0]?.();
    await new Promise((r) => setTimeout(r, 0));
    expect(releases).toHaveLength(2);
    releases[1]?.();
    await new Promise((r) => setTimeout(r, 0));
    expect(stageFeedHub.listPreviews()).toEqual([{ channel: "stage-ws-race2", layoutId: other.id }]);
    sock.emit("close");
  });

  it("handles one socket's messages in arrival order", async () => {
    // A slow first handler must not let a later message overtake it.
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    vi.spyOn(channelConfigs, "getChannelConfig").mockImplementation(async (id) => {
      await gate;
      return stageCh(id);
    });
    const ch = `t-${Date.now()}-order`;
    const sock = connect();
    await sock.client({ type: "stage_layout_preview", channel: "stage-ws-order", layout });
    await sock.client({ type: "take", channel: ch, templateId: "after", data: {} });
    expect(channels.getState(ch).active).toBeNull();
    release();
    await new Promise((r) => setTimeout(r, 0));
    expect(channels.getState(ch).active?.templateId).toBe("after");
    sock.emit("close");
  });

  it("stage_layout_preview on a non-stage channel errors not_stage_channel", async () => {
    vi.spyOn(channelConfigs, "getChannelConfig").mockResolvedValue(
      ChannelConfigSchema.parse({ id: "program", name: "Program", kind: "graphics" }),
    );
    const sock = connect();
    await sock.client({ type: "stage_layout_preview", channel: "program", layout });
    expect(sock.sent).toContainEqual(expect.objectContaining({ type: "error", code: "not_stage_channel", message: "program", op: "stage_layout_preview" }));
    expect(stageFeedHub.listPreviews()).toEqual([]);
  });
});

describe("ws machine-admin operations", () => {
  function connectFrom(remoteAddress: string): FakeSocket {
    const sock = new FakeSocket();
    sockets.push(sock);
    handleConnection(sock as never, { socket: { remoteAddress } } as never, silentLog);
    return sock;
  }

  it("refuses STT installs and model downloads from another machine", async () => {
    const sock = connectFrom("192.0.2.44");
    await sock.client({ type: "stt_download_model", url: "https://huggingface.co/x.bin", filename: "x.bin" });
    await sock.client({ type: "stt_install_binary" });
    await sock.client({ type: "stt_spawner_start", config: { autoStart: false } });
    const refused = sock.sent.filter((m) => m.type === "error" && m.code === "forbidden_remote");
    expect(refused).toHaveLength(3);
  });

  it("still lets a remote operator take graphics", async () => {
    const ch = `t-${Date.now()}-remote`;
    const sock = connectFrom("192.0.2.44");
    await sock.client({ type: "take", channel: ch, templateId: "tpl", data: {} });
    expect(channels.getState(ch).active?.templateId).toBe("tpl");
    expect(sock.sent.some((m) => m.type === "error")).toBe(false);
  });
});

describe("ws delete_template protection", () => {
  it("refuses to delete the built-in lyric template", async () => {
    const spy = vi.spyOn(templates, "deleteTemplate");
    const sock = connect();
    await sock.client({ type: "delete_template", templateId: "lyric-default" });
    expect(spy).not.toHaveBeenCalled();
    expect(sock.sent.some((m) => m.type === "error" && m.code === "protected")).toBe(true);
    spy.mockRestore();
  });

  it("[I5] the error reply carries the request op and id", async () => {
    const sock = connect();
    await sock.client({ type: "delete_template", templateId: "lyric-default" });
    expect(sock.sent.find((m) => m.type === "error" && m.code === "protected")).toMatchObject({
      op: "delete_template",
      id: "lyric-default",
    });
  });
});

describe("ws save_template draft ids", () => {
  it("refuses to save a __draft__ id, with the op/id on the error", async () => {
    const spy = vi.spyOn(templates, "saveTemplate");
    const sock = connect();
    await sock.client({
      type: "save_template",
      template: {
        id: "__draft__lt",
        name: "Draft",
        size: { w: 1920, h: 1080 },
        fields: [],
        layers: [],
        timelines: { in: { duration: 0, tracks: [] }, out: { duration: 0, tracks: [] } },
      },
    });
    expect(spy).not.toHaveBeenCalled();
    expect(sock.sent.find((m) => m.type === "error")).toMatchObject({
      code: "invalid",
      op: "save_template",
      id: "__draft__lt",
    });
    expect(sock.sent.some((m) => m.type === "ack")).toBe(false);
    spy.mockRestore();
  });
});

describe("[I5] replyTo", () => {
  it("tags untagged errors with the request ref, leaves other messages and tagged errors alone", () => {
    const out: ServerMessage[] = [];
    const reply = replyTo((m) => out.push(m), { type: "save_deck", deck: { id: "d1" } } as never);
    reply({ type: "error", code: "invalid", message: "Duplicate slide id" });
    reply({ type: "error", code: "x", message: "y", op: "other", id: "z" });
    reply({ type: "ack", op: "save_deck", id: "d1" });
    expect(out).toEqual([
      { type: "error", code: "invalid", message: "Duplicate slide id", op: "save_deck", id: "d1" },
      { type: "error", code: "x", message: "y", op: "other", id: "z" },
      { type: "ack", op: "save_deck", id: "d1" },
    ]);
  });
});

// [P2b.11] draft guard, end to end: the operator's Take button, hotkeys and
// Companion all send take_pvw_to_pgm / take / cue over this socket.
describe("ws: a draft on preview never reaches program", () => {
  it("take_pvw_to_pgm, take and cue of a draft all leave program unchanged", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    channels.take("program", "on-air", { a: "1" });
    const before = channels.getState("program").active;
    channels.take("preview", "__draft__lt", {});
    const sock = connect();
    await sock.client({ type: "take_pvw_to_pgm", fromChannel: "preview", toChannel: "program" });
    await sock.client({ type: "take", channel: "program", templateId: "__draft__lt", data: {} });
    await sock.client({ type: "cue", channel: "program", templateId: "__draft__lt", data: {} });
    expect(channels.getState("program").active).toBe(before);
    expect(channels.getState("preview").active?.templateId).toBe("__draft__lt");
    channels.setActiveNull("preview");
    channels.setActiveNull("program");
    warn.mockRestore();
  });
});
// [/P2b.11]

// S1: a record id becomes a filename, so a LAN client must not be able to
// steer a save outside its directory (e.g. into data/stt/config.json, whose
// customCommand the STT spawner runs).
describe("ws: record ids can't escape their directory", () => {
  const sttConfig = (): string => path.join(dataDir, "stt", "config.json");
  const exists = (p: string): Promise<boolean> =>
    fs.stat(p).then(
      () => true,
      () => false,
    );

  it("save_deck with a traversal id errors and writes nothing", async () => {
    const sock = connect();
    await sock.client({
      type: "save_deck",
      deck: {
        id: "../stt/config",
        name: "x",
        tags: [],
        defaultTemplateId: "t",
        licensing: { kind: "own" },
        slides: [],
        createdAt: "2026-10-30T00:00:00.000Z",
        customCommand: "touch /tmp/pwned",
      },
    });
    await vi.waitFor(() =>
      expect(sock.sent.some((m) => m.type === "error" && m.op === "save_deck" && /record id/i.test(m.message))).toBe(true),
    );
    expect(sock.sent.some((m) => m.type === "ack" && m.op === "save_deck")).toBe(false);
    expect(await exists(sttConfig())).toBe(false);
  });

  it("save_song with a traversal id errors; an ordinary id still saves", async () => {
    const sock = connect();
    const song = {
      title: "Be Thou My Vision",
      sections: [{ id: "v1", kind: "verse", label: "Verse 1", slides: [{ id: "s1", lines: ["Be thou my vision"] }] }],
      defaultArrangement: ["v1"],
    };
    await sock.client({ type: "save_song", song: { ...song, id: "../stt/config" } });
    await vi.waitFor(() =>
      expect(sock.sent.some((m) => m.type === "error" && m.op === "save_song" && /record id/i.test(m.message))).toBe(true),
    );
    expect(await exists(sttConfig())).toBe(false);
    await sock.client({ type: "save_song", song: { ...song, id: "be-thou-my-vision" } });
    await vi.waitFor(() =>
      expect(sock.sent).toContainEqual({ type: "ack", op: "save_song", id: "be-thou-my-vision" }),
    );
  });
});

describe("ws: stream subscriptions don't leak", () => {
  const levelsSeen = (sock: FakeSocket) => sock.sent.filter((m) => m.type === "stt_levels").length;

  it("subscribing twice then unsubscribing stops stt_levels", async () => {
    const sock = connect();
    await sock.client({ type: "stt_levels_subscribe", on: true });
    await sock.client({ type: "stt_levels_subscribe", on: true });
    spawnerHooks.levels?.([0.5], [1]);
    expect(levelsSeen(sock)).toBe(1);
    await sock.client({ type: "stt_levels_subscribe", on: false });
    spawnerHooks.levels?.([0.5], [1]);
    expect(levelsSeen(sock)).toBe(1);
  });

  it("closing the socket drops its stt_levels and stt_match subscribers", async () => {
    const sock = connect();
    await sock.client({ type: "stt_levels_subscribe", on: true });
    await sock.client({ type: "stt_match_subscribe", on: true });
    sock.emit("close");
    const sendSpy = vi.spyOn(sock, "send");
    spawnerHooks.levels?.([0.5], [1]);
    spawnerHooks.match?.("ch", null, "x", { latencyMs: 1, isFinal: true });
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("subscribing stt_match twice then unsubscribing stops stt_match", async () => {
    const sock = connect();
    const matches = () => sock.sent.filter((m) => m.type === "stt_match").length;
    await sock.client({ type: "stt_match_subscribe", on: true });
    await sock.client({ type: "stt_match_subscribe", on: true });
    spawnerHooks.match?.("ch", null, "x", { latencyMs: 1, isFinal: true });
    expect(matches()).toBe(1);
    await sock.client({ type: "stt_match_subscribe", on: false });
    spawnerHooks.match?.("ch", null, "x", { latencyMs: 1, isFinal: true });
    expect(matches()).toBe(1);
  });

  it("a subscribe that runs after close adds no output", async () => {
    const addOutput = vi.spyOn(outputs, "addOutput");
    const sock = connect();
    sock.emit("close");
    await sock.client({ type: "subscribe", channel: `t-${Date.now()}-late`, role: "renderer" });
    expect(addOutput).not.toHaveBeenCalled();
    addOutput.mockRestore();
  });
});
