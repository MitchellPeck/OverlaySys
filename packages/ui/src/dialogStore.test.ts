import { describe, expect, it } from "vitest";
import { createDialogStore, type DialogSpec } from "./dialogStore";

describe("createDialogStore", () => {
  it("shows one dialog at a time, FIFO", async () => {
    const s = createDialogStore();
    const a = s.open({ kind: "confirm", title: "A" } as DialogSpec, false);
    const b = s.open({ kind: "confirm", title: "B" } as DialogSpec, false);
    expect(s.current()?.spec.title).toBe("A");
    s.resolve(true);
    await expect(a).resolves.toBe(true);
    expect(s.current()?.spec.title).toBe("B");
    s.resolve(undefined);
    await expect(b).resolves.toBe(false); // undefined → fallback
    expect(s.current()).toBeNull();
  });

  it("notifies subscribers on open and resolve, and stops after unsubscribe", () => {
    const s = createDialogStore();
    let calls = 0;
    const off = s.subscribe(() => calls++);
    void s.open({ kind: "alert", title: "A" } as DialogSpec, undefined);
    expect(calls).toBe(1);
    s.resolve(undefined);
    expect(calls).toBe(2);
    off();
    void s.open({ kind: "alert", title: "B" } as DialogSpec, undefined);
    expect(calls).toBe(2);
  });

  it("keeps current() stable between changes and ignores resolve with nothing open", () => {
    const s = createDialogStore();
    s.resolve(true);
    expect(s.current()).toBeNull();
    void s.open({ kind: "confirm", title: "A" } as DialogSpec, false);
    expect(s.current()).toBe(s.current());
  });
});
