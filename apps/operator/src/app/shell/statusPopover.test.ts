import { describe, expect, it } from "vitest";
import { statusPopoverModel } from "./statusPopover";

describe("statusPopoverModel", () => {
  it("server closed leads with Retry now", () => {
    const m = statusPopoverModel("server", { conn: "closed" });
    expect(m.actions[0]!.label).toBe("Retry now");
    expect(m.actions[0]!.id).toBe("retry");
  });
  it("server open has no retry", () => {
    const m = statusPopoverModel("server", { conn: "open", url: "ws://x:4000" });
    expect(m.actions.some((a) => a.id === "retry")).toBe(false);
    expect(m.lines.join("\n")).toContain("ws://x:4000");
  });
  it("stt with an unknown state has no Missing line", () => {
    const m = statusPopoverModel("stt", {});
    expect(m.title).toBe("Speech-to-text");
    expect(m.lines.some((l) => l.startsWith("Missing"))).toBe(false);
  });
  it("stt without a config says what is missing", () => {
    const m = statusPopoverModel("stt", { state: "idle", hasConfig: false });
    expect(m.lines.some((l) => l.startsWith("Missing"))).toBe(true);
  });
  it("stt error offers Retry and Copy error", () => {
    const m = statusPopoverModel("stt", { state: "error", lastError: "boom", hasConfig: true });
    expect(m.actions.map((a) => a.label)).toEqual(expect.arrayContaining(["Retry", "Copy error"]));
  });
  it("sync shows details and Sync now only when paired", () => {
    const m = statusPopoverModel("sync", { details: ["Last pass just now"], paired: true });
    expect(m.title).toBe("Cloud sync");
    expect(m.actions[0]!.label).toBe("Sync now");
    expect(statusPopoverModel("sync", { details: [], paired: false }).actions).toEqual([]);
  });
});
