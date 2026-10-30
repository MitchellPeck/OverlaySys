import { describe, expect, it } from "vitest";
import { latestOnly } from "./latestOnly";

describe("latestOnly", () => {
  it("keeps a single run current", () => {
    const gate = latestOnly();
    const isCurrent = gate.begin();
    expect(isCurrent()).toBe(true);
  });

  it("makes an earlier run stale once a later one begins", () => {
    const gate = latestOnly();
    const first = gate.begin();
    const second = gate.begin();
    // the slow first read finishing last must be dropped
    expect(second()).toBe(true);
    expect(first()).toBe(false);
  });

  it("keeps separate gates independent", () => {
    const a = latestOnly();
    const b = latestOnly();
    const runA = a.begin();
    b.begin();
    expect(runA()).toBe(true);
  });
});
