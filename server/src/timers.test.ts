import { beforeEach, describe, expect, it, vi } from "vitest";
import { _resetForTest, createTimer, dispatchTimers, getTimers, subscribeTimers } from "./timers";

beforeEach(() => _resetForTest());

describe("timers engine", () => {
  it("createTimer returns an id present in getTimers", () => {
    const id = createTimer({ label: "Talk", mode: "countdown", durationMs: 60_000, overtime: true });
    expect(getTimers().some((t) => t.id === id)).toBe(true);
  });

  it("fires a listener once per change and not for a no-op", () => {
    const l = vi.fn();
    subscribeTimers(l);
    createTimer({ label: "A", mode: "countup", overtime: false });
    expect(l).toHaveBeenCalledTimes(1);
    dispatchTimers({ type: "pause", id: "missing" });
    expect(l).toHaveBeenCalledTimes(1);
  });

  it("a throwing listener does not stop the others", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const second = vi.fn();
    subscribeTimers(() => {
      throw new Error("boom");
    });
    subscribeTimers(second);
    createTimer({ label: "A", mode: "countup", overtime: false });
    expect(second).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
