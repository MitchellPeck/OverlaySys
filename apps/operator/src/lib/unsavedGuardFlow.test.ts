import { describe, expect, it } from "vitest";
import { afterChoice, guardActions, guardedNavigate, leaveMethod, registerLeaveGuard } from "./unsavedGuardFlow";

describe("unsavedGuardFlow", () => {
  it("replaces the sentinel entry when leaving by link", () => {
    expect(leaveMethod(true)).toBe("replace");
    expect(leaveMethod(false)).toBe("push");
  });

  it("offers Save and leave only when the page can save", () => {
    expect(guardActions(false).map((a) => a.id)).toEqual(["stay", "discard"]);
    expect(guardActions(true).map((a) => a.label)).toEqual(["Stay", "Discard changes", "Save and leave"]);
    expect(guardActions(true).map((a) => a.variant)).toEqual(["secondary", "danger", "primary"]);
  });

  it("maps a choice to navigation and history steps", () => {
    expect(afterChoice("discard", null, "pop")).toEqual({ navigate: true, historySteps: -2 });
    expect(afterChoice("discard", null, "link")).toEqual({ navigate: true, historySteps: 0 });
    expect(afterChoice("save", false, "link")).toEqual({ navigate: false, historySteps: 0 });
    expect(afterChoice("save", true, "pop")).toEqual({ navigate: true, historySteps: -2 });
    expect(afterChoice("stay", null, "pop")).toEqual({ navigate: false, historySteps: 0 });
  });
});

describe("guardedNavigate", () => {
  const mkRouter = () => {
    const calls: string[] = [];
    return { calls, push: (h: string) => void calls.push(`push ${h}`), replace: (h: string) => void calls.push(`replace ${h}`) };
  };

  it("pushes straight away with no dirty editor", async () => {
    const r = mkRouter();
    await guardedNavigate("/shows", r);
    expect(r.calls).toEqual(["push /shows"]);
  });

  it("stays put when the guard says stay", async () => {
    const r = mkRouter();
    const off = registerLeaveGuard(async () => ({ navigate: false, method: "push" }));
    await guardedNavigate("/shows", r);
    off();
    expect(r.calls).toEqual([]);
  });

  it("navigates with the method the guard chose, and asks the latest guard", async () => {
    const r = mkRouter();
    const off1 = registerLeaveGuard(async () => ({ navigate: false, method: "push" }));
    const off2 = registerLeaveGuard(async () => ({ navigate: true, method: "replace" }));
    await guardedNavigate("/live", r);
    off2();
    off1();
    expect(r.calls).toEqual(["replace /live"]);
  });

  it("stops asking once the guard is unregistered", async () => {
    const r = mkRouter();
    registerLeaveGuard(async () => ({ navigate: false, method: "push" }))();
    await guardedNavigate("/a", r);
    expect(r.calls).toEqual(["push /a"]);
  });
});
