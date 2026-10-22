import { describe, expect, it } from "vitest";
import type { ChannelConfig } from "@overlaysys/core";
import { createMirrorSubscription } from "./mirrorSubscription";

const alphaCfg: ChannelConfig = {
  id: "alpha-program",
  name: "Alpha (Program)",
  kind: "graphics",
  renderMode: "matte",
  mirrorOf: "program",
  background: "transparent",
};

const sub = (ch: string) => ({ type: "subscribe", channel: ch, role: "renderer" });
const getCfg = (ch: string) => ({ type: "get_channel", channelId: ch });

describe("createMirrorSubscription", () => {
  it("first hello subscribes to the URL channel and asks for config", () => {
    const m = createMirrorSubscription("alpha-program");
    expect(m.hello()).toEqual([sub("alpha-program"), getCfg("alpha-program")]);
    expect(m.source).toBe("alpha-program");
    expect(m.accepts("alpha-program")).toBe(true);
    expect(m.accepts("program")).toBe(false);
  });

  it("retargets to mirrorOf when the config arrives", () => {
    const m = createMirrorSubscription("alpha-program");
    m.hello();
    expect(m.channelConfig(alphaCfg)).toEqual([sub("program")]);
    expect(m.source).toBe("program");
    expect(m.accepts("program")).toBe(true);
    // The URL channel's own (empty) state must now be ignored, otherwise
    // an idle alpha-program state would clear what program painted.
    expect(m.accepts("alpha-program")).toBe(false);
  });

  it("re-subscribes to the mirror source on every reconnect", () => {
    // This is the bug that blacked out the alpha output: after a WS drop
    // the server has an empty subscription map for the new socket, and
    // the old code only re-sent the URL channel.
    const m = createMirrorSubscription("alpha-program");
    m.hello();
    m.channelConfig(alphaCfg);
    expect(m.hello()).toEqual([
      sub("alpha-program"),
      sub("program"),
      getCfg("alpha-program"),
    ]);
    expect(m.accepts("program")).toBe(true);
  });

  it("does not re-send a subscribe when the config re-arrives unchanged", () => {
    const m = createMirrorSubscription("alpha-program");
    m.hello();
    m.channelConfig(alphaCfg);
    expect(m.channelConfig(alphaCfg)).toEqual([]);
  });

  it("ignores config messages for other channels", () => {
    const m = createMirrorSubscription("alpha-program");
    m.hello();
    expect(
      m.channelConfig({ ...alphaCfg, id: "program", mirrorOf: undefined }),
    ).toEqual([]);
    expect(m.source).toBe("alpha-program");
  });

  it("follows a changed mirrorOf and reverts to self when it is cleared", () => {
    const m = createMirrorSubscription("alpha-program");
    m.hello();
    m.channelConfig(alphaCfg);
    expect(m.channelConfig({ ...alphaCfg, mirrorOf: "preview" })).toEqual([
      sub("preview"),
    ]);
    expect(m.accepts("program")).toBe(false);
    expect(m.accepts("preview")).toBe(true);
    // Cleared → paint our own channel; it is already subscribed from hello.
    expect(m.channelConfig({ ...alphaCfg, mirrorOf: undefined })).toEqual([]);
    expect(m.source).toBe("alpha-program");
    expect(m.accepts("alpha-program")).toBe(true);
  });

  it("treats a self-referential mirrorOf as no mirror", () => {
    const m = createMirrorSubscription("program");
    m.hello();
    expect(m.channelConfig({ ...alphaCfg, id: "program", mirrorOf: "program" })).toEqual([]);
    expect(m.source).toBe("program");
  });

  it("picks up a late config from a channel_list broadcast", () => {
    // Fresh install / sync pull: get_channel answered not_found, then the
    // config lands and the server broadcasts channel_list (never a
    // per-channel `channel`). The window must retarget from that.
    const m = createMirrorSubscription("alpha-program");
    m.hello();
    expect(
      m.channelList([{ ...alphaCfg, id: "program", mirrorOf: undefined }, alphaCfg]),
    ).toEqual([sub("program")]);
    expect(m.source).toBe("program");
    expect(m.config?.renderMode).toBe("matte");
  });

  it("channel_list without our entry changes nothing", () => {
    const m = createMirrorSubscription("alpha-program");
    m.hello();
    expect(m.channelList([{ ...alphaCfg, id: "program", mirrorOf: undefined }])).toEqual([]);
    expect(m.source).toBe("alpha-program");
  });
});
