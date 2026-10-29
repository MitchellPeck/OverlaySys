import { describe, expect, it } from "vitest";
import { findLikelySongDuplicate, setAllFlagged } from "./bundleDuplicates";

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

describe("setAllFlagged", () => {
  const rows = [
    { id: "a", kind: "song", conflict: { name: "A" }, decision: "skip" as const },
    { id: "b", kind: "song", decision: "import" as const },
    { id: "c", kind: "song", likelyDuplicate: true, decision: "skip" as const },
    { id: "d", kind: "template", conflict: { name: "D" }, decision: "replace" as const },
  ];
  it("replace-all replaces conflicts and imports likely duplicates, leaving others alone", () => {
    expect(setAllFlagged(rows, "replace").map((r) => r.decision)).toEqual(["replace", "import", "import", "replace"]);
  });
  it("skip-all skips conflicts and duplicates", () => {
    expect(setAllFlagged(rows, "skip").map((r) => r.decision)).toEqual(["skip", "import", "skip", "skip"]);
  });
  it("copy-all copies flagged rows except templates", () => {
    expect(setAllFlagged(rows, "copy").map((r) => r.decision)).toEqual(["copy", "import", "copy", "skip"]);
  });
});
