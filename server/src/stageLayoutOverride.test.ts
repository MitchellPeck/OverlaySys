import { beforeEach, describe, expect, it } from "vitest";
import {
  getManualStageLayout,
  noteFollowedRow,
  resetStageLayoutOverrides,
  setManualStageLayout,
} from "./stageLayoutOverride";

describe("stageLayoutOverride", () => {
  beforeEach(resetStageLayoutOverrides);

  it("sets and reads, and null returns to automatic", () => {
    expect(getManualStageLayout("s1")).toBeNull();
    setManualStageLayout("s1", "lyrics");
    expect(getManualStageLayout("s1")).toBe("lyrics");
    setManualStageLayout("s1", null);
    expect(getManualStageLayout("s1")).toBeNull();
  });

  it("keeps the manual layout while the same row stays live", () => {
    noteFollowedRow("s1", "r1");
    setManualStageLayout("s1", "lyrics");
    expect(noteFollowedRow("s1", "r1")).toBe(false);
    expect(getManualStageLayout("s1")).toBe("lyrics");
  });

  it("clears on a different row id", () => {
    noteFollowedRow("s1", "r1");
    setManualStageLayout("s1", "lyrics");
    expect(noteFollowedRow("s1", "r2")).toBe(true);
    expect(getManualStageLayout("s1")).toBeNull();
  });

  it("counts null -> row as a new row", () => {
    noteFollowedRow("s1", null);
    setManualStageLayout("s1", "lyrics");
    expect(noteFollowedRow("s1", "x")).toBe(true);
    expect(getManualStageLayout("s1")).toBeNull();
  });

  it("tracks channels independently", () => {
    noteFollowedRow("s1", "r1");
    noteFollowedRow("s2", "r1");
    setManualStageLayout("s2", "lyrics");
    noteFollowedRow("s1", "r2");
    expect(getManualStageLayout("s2")).toBe("lyrics");
  });
});
