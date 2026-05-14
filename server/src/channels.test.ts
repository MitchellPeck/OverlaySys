import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Template } from "@overlaysys/core";
import * as channels from "./channels";
import * as templates from "./templates";

// Two stub templates: one with autoOutMs configured, one without. The
// autoOut behavior is driven by `getTemplate` returning the autoOutMs,
// so we mock that module rather than touching disk.
const TEMPLATE_AUTO: Template = {
  id: "auto-out-tpl",
  name: "Auto-out",
  size: { w: 100, h: 100 },
  fields: [],
  layers: [],
  timelines: { in: { duration: 0, tracks: [] }, out: { duration: 0, tracks: [] } },
  fonts: [],
  autoOutMs: 1000,
};
const TEMPLATE_PLAIN: Template = {
  ...TEMPLATE_AUTO,
  id: "plain-tpl",
  name: "Plain",
  autoOutMs: undefined,
};

describe("channels auto-out", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(templates, "getTemplate").mockImplementation(async (id) => {
      if (id === TEMPLATE_AUTO.id) return TEMPLATE_AUTO;
      if (id === TEMPLATE_PLAIN.id) return TEMPLATE_PLAIN;
      return null;
    });
    // Reset any state left from earlier tests by clearing the channel.
    channels.clear("test");
    channels.setActiveNull("test");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("clears the channel after autoOutMs when an autoOut template is taken", async () => {
    channels.take("test", TEMPLATE_AUTO.id, {});
    expect(channels.getState("test").active?.templateId).toBe(TEMPLATE_AUTO.id);
    expect(channels.getState("test").active?.phase).toBe("in");

    // Let the async getTemplate lookup resolve so the timer is scheduled.
    // Flush the async getTemplate microtask without advancing the fake
    // clock — we don't want the auto-out setTimeout to fire here.
    await vi.advanceTimersByTimeAsync(0);

    // Just before the timer fires, we should still be in phase "in".
    vi.advanceTimersByTime(999);
    expect(channels.getState("test").active?.phase).toBe("in");

    // At T=autoOutMs, the timer fires and clear() runs → phase "out".
    vi.advanceTimersByTime(1);
    expect(channels.getState("test").active?.phase).toBe("out");
  });

  it("does NOT auto-clear templates without autoOutMs", async () => {
    channels.take("test", TEMPLATE_PLAIN.id, {});
    // Flush the async getTemplate microtask without advancing the fake
    // clock — we don't want the auto-out setTimeout to fire here.
    await vi.advanceTimersByTimeAsync(0);
    vi.advanceTimersByTime(5000);
    expect(channels.getState("test").active?.phase).toBe("in");
  });

  it("a subsequent take cancels the prior auto-out timer", async () => {
    channels.take("test", TEMPLATE_AUTO.id, {});
    // Flush the async getTemplate microtask without advancing the fake
    // clock — we don't want the auto-out setTimeout to fire here.
    await vi.advanceTimersByTimeAsync(0);
    // Advance partway through the timer, then take a different template.
    vi.advanceTimersByTime(500);
    channels.take("test", TEMPLATE_PLAIN.id, {});
    // Flush the async getTemplate microtask without advancing the fake
    // clock — we don't want the auto-out setTimeout to fire here.
    await vi.advanceTimersByTimeAsync(0);
    // Past the original timer's would-have-fired moment.
    vi.advanceTimersByTime(1000);
    expect(channels.getState("test").active?.templateId).toBe(TEMPLATE_PLAIN.id);
    expect(channels.getState("test").active?.phase).toBe("in");
  });

  it("a manual clear cancels the auto-out timer", async () => {
    channels.take("test", TEMPLATE_AUTO.id, {});
    // Flush the async getTemplate microtask without advancing the fake
    // clock — we don't want the auto-out setTimeout to fire here.
    await vi.advanceTimersByTimeAsync(0);
    channels.clear("test");
    expect(channels.getState("test").active?.phase).toBe("out");
    // Advance past when the timer would have fired — no second clear or
    // re-trigger should happen (active goes to null at 1500ms grace).
    vi.advanceTimersByTime(2000);
    expect(channels.getState("test").active).toBeNull();
  });

  it("takePvwToPgm schedules auto-out on the destination channel", async () => {
    channels.take("preview", TEMPLATE_AUTO.id, {});
    // Flush the async getTemplate microtask without advancing the fake
    // clock — we don't want the auto-out setTimeout to fire here.
    await vi.advanceTimersByTimeAsync(0);
    channels.takePvwToPgm("preview", "program");
    // Flush the async getTemplate microtask without advancing the fake
    // clock — we don't want the auto-out setTimeout to fire here.
    await vi.advanceTimersByTimeAsync(0);
    expect(channels.getState("program").active?.templateId).toBe(TEMPLATE_AUTO.id);
    // Original preview timer should NOT fire on preview (preview is now cleared).
    vi.advanceTimersByTime(1001);
    expect(channels.getState("program").active?.phase).toBe("out");
    // Cleanup
    channels.setActiveNull("preview");
    channels.setActiveNull("program");
  });
});
