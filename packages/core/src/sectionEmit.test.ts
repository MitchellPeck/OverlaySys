import { describe, expect, it } from "vitest";
import { emitSections, inferKind, generateSectionId } from "./sectionEmit";

describe("inferKind", () => {
  it("recognizes core kinds", () => {
    expect(inferKind("Verse 1")).toBe("verse");
    expect(inferKind("Chorus")).toBe("chorus");
    expect(inferKind("Bridge")).toBe("bridge");
    expect(inferKind("Tag")).toBe("tag");
    expect(inferKind("Intro")).toBe("intro");
    expect(inferKind("Outro")).toBe("outro");
  });
  it("treats Pre-Chorus and Post-Chorus as other", () => {
    expect(inferKind("Pre-Chorus")).toBe("other");
    expect(inferKind("Post-Chorus")).toBe("other");
  });
  it("falls back to other for unknown labels", () => {
    expect(inferKind("Vamp")).toBe("other");
  });
});

describe("generateSectionId", () => {
  it("counts per kind", () => {
    const counts = new Map();
    expect(generateSectionId("verse", counts)).toBe("v1");
    expect(generateSectionId("verse", counts)).toBe("v2");
    expect(generateSectionId("chorus", counts)).toBe("c1");
  });
});

describe("emitSections", () => {
  it("emits sections with stable ids and default arrangement", () => {
    const out = emitSections([
      { header: "Verse 1", blocks: [["a", "b"]] },
      { header: "Chorus", blocks: [["c"]] },
      { header: "Verse 2", blocks: [["d"]] },
    ]);
    expect(out.sections.map((s) => s.id)).toEqual(["v1", "c1", "v2"]);
    expect(out.defaultArrangement).toEqual(["v1", "c1", "v2"]);
  });
  it("emits one empty slide for sections with no blocks", () => {
    const out = emitSections([{ header: "Verse 1", blocks: [] }]);
    expect(out.sections[0]!.slides).toEqual([{ id: "v1s1", lines: [""] }]);
  });
});
