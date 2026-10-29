import { describe, expect, it } from "vitest";
import { createToastQueue } from "./toastQueue";

function clock() {
  let t = 0;
  return { now: () => t, set: (v: number) => (t = v) };
}

describe("createToastQueue", () => {
  it("dedupes an identical message within 1 s", () => {
    const c = clock();
    const q = createToastQueue(c.now);
    const a = q.push({ message: "Saved", tone: "ok" });
    c.set(900);
    expect(q.push({ message: "Saved", tone: "ok" })).toBe(a);
    expect(q.list()).toHaveLength(1);
    c.set(1100);
    expect(q.push({ message: "Saved", tone: "ok" })).not.toBe(a);
    expect(q.list()).toHaveLength(2);
  });

  it("does not dedupe the same message with a different tone", () => {
    const q = createToastQueue(() => 0);
    q.push({ message: "Saved", tone: "ok" });
    q.push({ message: "Saved", tone: "warn" });
    expect(q.list()).toHaveLength(2);
  });

  it("keeps at most 3, dropping the oldest", () => {
    const q = createToastQueue(() => 0);
    const ids = ["1", "2", "3", "4"].map((m) => q.push({ message: m }));
    expect(q.list().map((t) => t.id)).toEqual(ids.slice(1));
  });

  it("expires info after 4 s and error after 8 s", () => {
    const c = clock();
    const q = createToastQueue(c.now);
    q.push({ message: "info" });
    q.push({ message: "bad", tone: "error" });
    q.push({ message: "undo", action: { label: "Undo", onClick() {} } });
    c.set(3999);
    q.expire();
    expect(q.list()).toHaveLength(3);
    c.set(4000);
    q.expire();
    expect(q.list().map((t) => t.message)).toEqual(["bad", "undo"]);
    c.set(8000);
    q.expire();
    expect(q.list()).toHaveLength(0);
  });

  it("honours durationMs and dismiss", () => {
    const c = clock();
    const q = createToastQueue(c.now);
    const a = q.push({ message: "a", durationMs: 500 });
    const b = q.push({ message: "b" });
    c.set(500);
    q.expire();
    expect(q.list().map((t) => t.id)).toEqual([b]);
    q.dismiss(b);
    q.dismiss(a); // already gone: no-op
    expect(q.list()).toEqual([]);
  });

  it("returns a new list reference only when entries change", () => {
    const q = createToastQueue(() => 0);
    const before = q.list();
    q.expire();
    expect(q.list()).toBe(before);
    q.push({ message: "x" });
    expect(q.list()).not.toBe(before);
  });

  it("persistent toasts (durationMs null) never expire and can be dismissed by id", () => {
    const c = clock();
    const q = createToastQueue(c.now);
    const id = q.push({ message: "Server restarting", durationMs: null });
    c.set(10 * 60_000);
    q.expire();
    expect(q.list().map((e) => e.id)).toEqual([id]);
    q.dismiss(id);
    expect(q.list()).toHaveLength(0);
  });
  it("non-persistent toasts never evict a persistent one", () => {
    const c = clock();
    const q = createToastQueue(c.now);
    const p = q.push({ message: "Persistent", durationMs: null });
    for (const m of ["a", "b", "c", "d"]) {
      c.set(c.now() + 2000);
      q.push({ message: m });
    }
    const list = q.list();
    expect(list).toHaveLength(3);
    expect(list[0]!.id).toBe(p);
    expect(list.map((e) => e.message)).toEqual(["Persistent", "c", "d"]);
  });
});
