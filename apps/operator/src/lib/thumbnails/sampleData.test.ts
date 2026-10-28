import { describe, expect, it } from "vitest";
import { sampleData } from "./sampleData";

describe("sampleData", () => {
  it("uses defaults, else per-type placeholders", () => {
    expect(
      sampleData({
        fields: [
          { key: "title", label: "Title", type: "text" },
          { key: "sub", label: "Subtitle", type: "text", default: "Placeholder subtitle" },
          { key: "clock", label: "Clock", type: "time" },
          { key: "bg", label: "Background", type: "image" },
          { key: "n", label: "Count", type: "number" },
          { key: "c", label: "Tint", type: "color" },
          { key: "v", label: "Clip", type: "video" },
        ],
      }),
    ).toEqual({
      title: "Title",
      sub: "Placeholder subtitle",
      clock: "10:00",
      bg: "",
      n: "0",
      c: "#ffffff",
      v: "",
    });
  });
});
