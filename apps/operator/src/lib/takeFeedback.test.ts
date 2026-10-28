import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "./store";
import { awaitChannelEcho } from "./takeFeedback";

beforeEach(() => {
  vi.useFakeTimers();
  useStore.setState({ channelStates: {} });
});
afterEach(() => {
  vi.useRealTimers();
});

describe("awaitChannelEcho", () => {
  it("resolves true when the channel's state is echoed", async () => {
    const { done } = awaitChannelEcho("program", 2000);
    useStore.getState().setChannelState({ channel: "program", active: null });
    await expect(done).resolves.toBe(true);
  });

  it("ignores other channels and times out false", async () => {
    const { done } = awaitChannelEcho("program", 2000);
    useStore.getState().setChannelState({ channel: "preview", active: null });
    vi.advanceTimersByTime(2000);
    await expect(done).resolves.toBe(false);
  });
});
