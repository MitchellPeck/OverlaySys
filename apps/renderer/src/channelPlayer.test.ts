import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelState, Template } from "@overlaysys/core";
import { createChannelPlayer, type PlayerMount } from "./channelPlayer";
import { createTemplateLoader, TemplateLoadError } from "./templateLoader";

function tpl(id: string): Template {
  return { id, name: id, size: { w: 1920, h: 1080 } } as unknown as Template;
}

class FakeMount implements PlayerMount {
  log: string[] = [];
  destroyed = false;
  constructor(readonly templateId: string, public data: Record<string, string>) {}
  playIn() {
    this.log.push("in");
    return Promise.resolve();
  }
  playOut() {
    this.log.push("out");
    return Promise.resolve();
  }
  playOutTimeline() {
    this.log.push("outTl");
    return Promise.resolve();
  }
  playAutoOut() {
    this.log.push("autoOut");
    return Promise.resolve();
  }
  update(d: Record<string, string>) {
    this.data = d;
    this.log.push("update");
  }
  destroy() {
    this.destroyed = true;
  }
}

function state(active: ChannelState["active"]): ChannelState {
  return { channel: "program", active };
}
function take(templateId: string, takenAt: number, data: Record<string, string> = {}, phase: "in" | "out" = "in"): ChannelState {
  return state({ templateId, data, phase, takenAt });
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("templateLoader", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("requests once and resolves every waiter", async () => {
    const request = vi.fn();
    const l = createTemplateLoader({ request });
    const a = l.get("t1");
    const b = l.get("t1");
    expect(request).toHaveBeenCalledTimes(1);
    l.received(tpl("t1"));
    await expect(a).resolves.toMatchObject({ id: "t1" });
    await expect(b).resolves.toMatchObject({ id: "t1" });
    // Cached now: no new request.
    await l.get("t1");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("rejects on not_found for that id only", async () => {
    const l = createTemplateLoader({ request: () => {} });
    const p = l.get("gone");
    expect(l.notFound("program")).toBe(false);
    expect(l.notFound("gone")).toBe(true);
    await expect(p).rejects.toBeInstanceOf(TemplateLoadError);
    expect(l.pendingIds()).toEqual([]);
  });

  it("rejects after the timeout", async () => {
    const l = createTemplateLoader({ request: () => {}, timeoutMs: 5000 });
    const p = l.get("slow");
    const caught = p.catch((e: TemplateLoadError) => e.reason);
    vi.advanceTimersByTime(5001);
    await expect(caught).resolves.toBe("timeout");
  });

  it("re-requests pending ids on resend and restarts their deadline", async () => {
    const request = vi.fn();
    const l = createTemplateLoader({ request, timeoutMs: 5000 });
    const p = l.get("t2");
    vi.advanceTimersByTime(4000);
    l.resend();
    expect(request).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(4000);
    l.received(tpl("t2"));
    await expect(p).resolves.toMatchObject({ id: "t2" });
  });
});

describe("channelPlayer", () => {
  function setup(load?: (id: string) => Promise<Template>) {
    const mounts: FakeMount[] = [];
    const loader = createTemplateLoader({ request: () => {} });
    const errors: string[] = [];
    const player = createChannelPlayer<FakeMount>({
      loadTemplate: load ?? ((id) => loader.get(id)),
      mount: (t, data) => {
        const m = new FakeMount(t.id, data);
        mounts.push(m);
        return m;
      },
      onLoadError: (id) => errors.push(id),
    });
    return { player, loader, mounts, errors };
  }

  it("mounts a take and plays it in", async () => {
    const { player, loader, mounts } = setup();
    const done = player.apply(take("a", 1, { x: "1" }));
    loader.received(tpl("a"));
    await done;
    expect(mounts).toHaveLength(1);
    expect(mounts[0]!.log).toEqual(["in"]);
    expect(player.currentTemplate?.id).toBe("a");
  });

  it("takes the previous graphic down even when the next template fails to load", async () => {
    const { player, loader, mounts, errors } = setup();
    const first = player.apply(take("a", 1));
    loader.received(tpl("a"));
    await first;
    const second = player.apply(take("missing", 2));
    loader.notFound("missing");
    await second;
    await flush();
    expect(mounts[0]!.log).toContain("out");
    expect(mounts[0]!.destroyed).toBe(true);
    expect(errors).toEqual(["missing"]);
    expect(player.currentTemplate).toBeNull();
    expect(player.loading).toBe(false);
  });

  it("a clear (phase out) while the template is loading cancels the mount", async () => {
    const { player, loader, mounts } = setup();
    const pending = player.apply(take("a", 1));
    await player.apply(take("a", 1, {}, "out"));
    loader.received(tpl("a"));
    await pending;
    expect(mounts).toHaveLength(0);
    expect(player.loading).toBe(false);
  });

  it("a null active while the template is loading cancels the mount", async () => {
    const { player, loader, mounts } = setup();
    const pending = player.apply(take("a", 1));
    await player.apply(state(null));
    loader.received(tpl("a"));
    await pending;
    expect(mounts).toHaveLength(0);
  });

  it("clear always takes down what is on screen", async () => {
    const { player, loader, mounts } = setup();
    const p = player.apply(take("a", 1));
    loader.received(tpl("a"));
    await p;
    await player.apply(take("a", 1, {}, "out"));
    expect(mounts[0]!.destroyed).toBe(true);
    // A second out delivery doesn't replay the animation.
    await player.apply(take("a", 1, {}, "out"));
    expect(mounts[0]!.log.filter((l) => l === "out")).toHaveLength(1);
  });

  it("an auto-out clear plays the template's own out (no fade), a manual clear the fade", async () => {
    const { player, loader, mounts } = setup();
    const p = player.apply(take("a", 1));
    loader.received(tpl("a"));
    await p;
    await player.apply(state({ templateId: "a", data: {}, phase: "out", takenAt: 1, outReason: "auto" }));
    expect(mounts[0]!.log).toEqual(["in", "autoOut"]);
    expect(mounts[0]!.destroyed).toBe(true);

    const q = player.apply(take("b", 2));
    loader.received(tpl("b"));
    await q;
    await player.apply(take("b", 2, {}, "out"));
    expect(mounts[1]!.log).toEqual(["in", "out"]);
  });

  it("the server dropping active mid auto-out doesn't restart it as a fade", async () => {
    const { player, loader, mounts } = setup();
    const p = player.apply(take("a", 1));
    loader.received(tpl("a"));
    await p;
    let finish!: () => void;
    mounts[0]!.playAutoOut = () => {
      mounts[0]!.log.push("autoOut");
      return new Promise<void>((r) => (finish = r));
    };
    const out = player.apply(state({ templateId: "a", data: {}, phase: "out", takenAt: 1, outReason: "auto" }));
    const gone = player.apply(state(null));
    finish();
    await Promise.all([out, gone]);
    expect(mounts[0]!.log).toEqual(["in", "autoOut"]);
    expect(mounts[0]!.destroyed).toBe(true);
  });

  it("a newer take while loading wins", async () => {
    const { player, loader, mounts } = setup();
    const p1 = player.apply(take("a", 1));
    const p2 = player.apply(take("b", 2));
    loader.received(tpl("b"));
    await p2;
    loader.received(tpl("a"));
    await p1;
    expect(mounts.map((m) => m.templateId)).toEqual(["b"]);
  });

  it("same-template takes reuse the mount", async () => {
    const { player, loader, mounts } = setup();
    const p = player.apply(take("lyric", 1, { l: "one" }));
    loader.received(tpl("lyric"));
    await p;
    await player.apply(take("lyric", 2, { l: "two" }));
    expect(mounts).toHaveLength(1);
    expect(mounts[0]!.log).toEqual(["in", "outTl", "update", "in"]);
    expect(mounts[0]!.data).toEqual({ l: "two" });
  });

  it("an update during the load is applied to the mount", async () => {
    const { player, loader, mounts } = setup();
    const p = player.apply(take("a", 1, { v: "1" }));
    await player.apply(take("a", 1, { v: "2" }));
    loader.received(tpl("a"));
    await p;
    expect(mounts[0]!.data).toEqual({ v: "2" });
  });

  it("reset destroys immediately", async () => {
    const { player, loader, mounts } = setup();
    const p = player.apply(take("a", 1));
    loader.received(tpl("a"));
    await p;
    player.reset();
    expect(mounts[0]!.destroyed).toBe(true);
    expect(player.currentTemplate).toBeNull();
  });
});
