import { describe, expect, it } from "vitest";
import type { ServerMessage } from "@overlaysys/ws-protocol";
import {
  attachStageLayoutStatusFeed,
  getStageLayoutStatuses,
  reasonLabel,
  resetStageLayoutStatusForTests,
  setStageLayoutMessage,
  subscribeStageLayoutStatus,
} from "./stageLayoutStatus";

function fakeClient() {
  const listeners = new Set<(m: ServerMessage) => void>();
  return {
    on(l: (m: ServerMessage) => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    emit(m: ServerMessage) {
      listeners.forEach((l) => l(m));
    },
  };
}

describe("stageLayoutStatus", () => {
  it("labels reasons", () => {
    expect(reasonLabel("rule:song")).toBe("Rule: song");
    expect(reasonLabel("manual")).toBe("Manual");
    expect(reasonLabel("item")).toBe("This item");
    expect(reasonLabel("default")).toBe("Default");
  });
  it("builds the set message", () => {
    expect(setStageLayoutMessage("stage1", null)).toEqual({ type: "set_stage_layout", channel: "stage1", layoutId: null });
    expect(setStageLayoutMessage("stage1", "lyrics")).toEqual({ type: "set_stage_layout", channel: "stage1", layoutId: "lyrics" });
  });
  it("keeps the last status for a later subscriber", () => {
    resetStageLayoutStatusForTests();
    const c = fakeClient();
    attachStageLayoutStatusFeed(c);
    attachStageLayoutStatusFeed(c); // idempotent
    const screens = [{ channel: "s1", layoutId: "lyrics", reason: "rule:song" as const, manual: null }];
    c.emit({ type: "stage_layout_status", screens } as ServerMessage);
    let calls = 0;
    subscribeStageLayoutStatus(() => calls++);
    expect(getStageLayoutStatuses()).toEqual(screens);
    c.emit({ type: "stage_layout_status", screens: [] } as ServerMessage);
    expect(calls).toBe(1);
    expect(getStageLayoutStatuses()).toEqual([]);
  });
});
