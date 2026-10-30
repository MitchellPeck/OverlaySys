import { describe, expect, it } from "vitest";
import { decodeTimerValue } from "@overlaysys/core";
import { countdownTimerValue, remainingDurationText } from "./timeFieldValue";

// `now` is the server clock (local Date.now() + serverTimeOffsetMs).
const serverNow = 1_000_000_000_000;

describe("countdownTimerValue", () => {
  it("anchors the countdown on the given (server) clock and keeps the duration", () => {
    const v = countdownTimerValue("10:00", serverNow);
    expect(v).not.toBeNull();
    expect(decodeTimerValue(v!)).toMatchObject({ anchor: serverNow + 600_000, durationMs: 600_000 });
  });
  it("returns null for text that isn't a duration", () => {
    expect(countdownTimerValue("soon", serverNow)).toBeNull();
  });
});

describe("remainingDurationText", () => {
  it("reads the remaining time against the given (server) clock", () => {
    const v = countdownTimerValue("10:00", serverNow)!;
    expect(remainingDurationText(v, serverNow)).toBe("10:00");
    expect(remainingDurationText(v, serverNow + 90_000)).toBe("8:30");
    expect(remainingDurationText(v, serverNow - 3_000_000)).toBe("1:00:00");
  });
  it("is empty for unset or elapsed countdowns", () => {
    expect(remainingDurationText(undefined, serverNow)).toBe("");
    const v = countdownTimerValue("0:05", serverNow)!;
    expect(remainingDurationText(v, serverNow + 5_000)).toBe("");
  });
});
