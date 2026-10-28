import { describe, expect, it } from "vitest";
import { findLikelySongDuplicate, setAllConflicts } from "./bundleDuplicates";

const library = [
  { id: "grace", title: "Amazing Grace", ccliNumber: "22025" },
  { id: "oceans", title: "Oceans (Where Feet May Fail)" },
];

describe("findLikelySongDuplicate", () => {
  it("matches by CCLI number under a different id", () => {
    expect(findLikelySongDuplicate({ id: "x", title: "Different", ccliNumber: " 22025 " }, library)).toEqual({
      id: "grace",
      title: "Amazing Grace",
      reason: "ccli",
    });
  });
  it("matches by title ignoring case and punctuation", () => {
    expect(findLikelySongDuplicate({ id: "y", title: "oceans - where feet may fail" }, library)?.reason).toBe("title");
  });
  it("ignores the same id (that's a conflict, not a duplicate)", () => {
    expect(findLikelySongDuplicate({ id: "grace", title: "Amazing Grace", ccliNumber: "22025" }, library)).toBeNull();
  });
  it("returns null when nothing matches", () => {
    expect(findLikelySongDuplicate({ id: "z", title: "New Song" }, library)).toBeNull();
  });
});

describe("setAllConflicts", () => {
  it("only changes conflicting rows", () => {
    const rows = [
      { id: "a", conflict: true, decision: "skip" as const },
      { id: "b", conflict: false, decision: "save" as const },
    ];
    expect(setAllConflicts(rows, "save").map((r) => r.decision)).toEqual(["save", "save"]);
    expect(setAllConflicts(rows, "skip").map((r) => r.decision)).toEqual(["skip", "save"]);
  });
});
