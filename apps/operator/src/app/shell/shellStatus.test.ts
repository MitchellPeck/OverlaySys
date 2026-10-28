import { describe, expect, it } from "vitest";
import {
  DISCONNECTED_GRACE_MS,
  buildChecklist,
  checklistProgress,
  describeDesktopEvent,
  shouldShowDisconnected,
  syncView,
} from "./shellStatus";

describe("shouldShowDisconnected", () => {
  it("never shows while open", () => {
    expect(shouldShowDisconnected("open", 0, 1e9)).toBe(false);
  });
  it("waits out the grace period before showing", () => {
    expect(shouldShowDisconnected("closed", 1000, 1000 + DISCONNECTED_GRACE_MS - 1)).toBe(false);
    expect(shouldShowDisconnected("closed", 1000, 1000 + DISCONNECTED_GRACE_MS)).toBe(true);
    expect(shouldShowDisconnected("connecting", 0, DISCONNECTED_GRACE_MS + 5)).toBe(true);
  });
});

describe("describeDesktopEvent", () => {
  it("makes give-ups and display losses sticky", () => {
    expect(describeDesktopEvent({ kind: "window-reload-gave-up", target: "program", reason: "x" }).sticky).toBe(true);
    expect(describeDesktopEvent({ kind: "output-hidden", channelId: "program", reason: "display disconnected" }).sticky).toBe(true);
    expect(describeDesktopEvent({ kind: "window-reloaded", target: "operator", reason: "x" }).text).toMatch(/^The console/);
  });
  it("reports the restart delay in seconds", () => {
    expect(
      describeDesktopEvent({ kind: "server-restarting", attempt: 2, delayMs: 2000, reason: "exited code=1" }).text,
    ).toContain("Restarting in 2s");
  });
});

const base = { paired: true, running: false, lastRanAt: null, lastError: null, lastResult: null };
const NOW = Date.parse("2026-10-28T12:00:00Z");

describe("syncView", () => {
  it("hides when signed out and healthy", () => {
    expect(syncView({ ...base, paired: false }, NOW)).toBeNull();
  });
  it("never hides an unpaired error", () => {
    expect(syncView({ ...base, paired: false, lastError: "missing env" }, NOW)).toMatchObject({
      tone: "bad",
      label: "sync unavailable",
      error: "missing env",
    });
  });
  it("lists per-record errors and exposes them for copying", () => {
    const v = syncView(
      {
        ...base,
        lastRanAt: "2026-10-28T11:55:00Z",
        lastResult: { pulled: 1, pushed: 0, errors: [{ kind: "song", id: "a", message: "boom" }], overwrites: [] },
      },
      NOW,
    );
    expect(v?.label).toBe("sync 1 err");
    expect(v?.error).toBe("[song:a] boom");
    expect(v?.details[0]).toBe("Last pass 5m ago");
  });
  it("is good after a clean pass", () => {
    expect(
      syncView({ ...base, lastRanAt: "2026-10-28T11:59:30Z", lastResult: { pulled: 2, pushed: 3, errors: [], overwrites: [] } }, NOW),
    ).toMatchObject({ tone: "good", label: "synced just now", details: ["Last pass just now", "Pulled 2, pushed 3"] });
  });
});

describe("first-run checklist", () => {
  it("counts only required steps", () => {
    const items = buildChecklist({ outputsConfigured: true, pcoConnected: false, sttConfigured: false, cloudSignedIn: true });
    expect(checklistProgress(items)).toEqual({ done: 1, total: 3 });
    expect(items.map((i) => i.href)).toEqual(["/settings/channels", "/settings/integrations", "/settings/stt", "/account"]);
  });
});
