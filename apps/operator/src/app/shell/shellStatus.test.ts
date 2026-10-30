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
  it("explains Blackmagic output status in plain words", () => {
    const ev = (status: never) => ({ kind: "decklink-status" as const, channelId: "stage", device: "UltraStudio", status });
    const on = describeDesktopEvent(ev({ state: "running" } as never));
    expect(on).toEqual({ tone: "good", text: "“UltraStudio” is on air for stage.", sticky: false });
    const busy = describeDesktopEvent(ev({ state: "restarting", code: "device-busy", attempt: 1, delayMs: 1000 } as never));
    expect(busy.tone).toBe("warn");
    expect(busy.text).toBe("“UltraStudio” is in use by another program (Narthex TV, or a leftover ffmpeg). Restarting.");
    const missing = describeDesktopEvent(ev({ state: "failed", code: "ffmpeg-not-found" } as never));
    expect(missing.tone).toBe("bad");
    expect(missing.sticky).toBe(true);
    expect(missing.text).toContain("Settings → Connection");
  });

  it("makes give-ups and display losses sticky", () => {
    const waiting = describeDesktopEvent({ kind: "window-reload-waiting", target: "program", reason: "x", delayMs: 120_000 });
    expect(waiting.sticky).toBe(true);
    expect(waiting.text).toContain("Trying again in 2 min");
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
  it("[I4] warns when the server kept a local show over a lossy cloud copy", () => {
    const v = syncView(
      {
        ...base,
        lastRanAt: "2026-10-28T11:59:30Z",
        lastResult: { pulled: 0, pushed: 0, errors: [], overwrites: [], warnings: [{ kind: "shows", id: "sh", message: "cloud copy has no rows" }] },
      },
      NOW,
    );
    expect(v).toMatchObject({ tone: "warn", label: "synced · 1 kept local" });
    expect(v?.details).toContain("[shows:sh] cloud copy has no rows");
    expect(v?.error).toBe("[shows:sh] cloud copy has no rows");
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
