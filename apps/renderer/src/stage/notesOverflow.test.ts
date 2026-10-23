import { describe, expect, it } from "vitest";
import { overflowDirection } from "./notesOverflow";

const base = { boxHeight: 1000, anchor: 0.33, pointTop: 0, pointHeight: 600, isFirst: false, isLast: false };

describe("overflowDirection", () => {
  it("no overflow while the point is still visible", () => {
    expect(overflowDirection({ ...base, scrollOffset: 0.2 })).toBeNull();
  });
  it("next once the point's bottom scrolls above the anchor", () => {
    // anchor line at 330px; point bottom = 330 + 600 - scroll*1000
    expect(overflowDirection({ ...base, scrollOffset: 0.61 })).toBe("next");
  });
  it("prev once scrolled up past the point's top by a full anchor gap", () => {
    expect(overflowDirection({ ...base, scrollOffset: -0.34 })).toBe("prev");
    expect(overflowDirection({ ...base, scrollOffset: -0.1 })).toBeNull();
  });
  it("never past the ends", () => {
    expect(overflowDirection({ ...base, scrollOffset: 0.9, isLast: true })).toBeNull();
    expect(overflowDirection({ ...base, scrollOffset: -0.9, isFirst: true })).toBeNull();
  });
  it("with anchor 0, a small scroll-up stays on the point; a quarter-box scroll moves back", () => {
    const top0 = { ...base, anchor: 0 };
    expect(overflowDirection({ ...top0, scrollOffset: -0.1 })).toBeNull();
    expect(overflowDirection({ ...top0, scrollOffset: -0.26 })).toBe("prev");
  });
});
