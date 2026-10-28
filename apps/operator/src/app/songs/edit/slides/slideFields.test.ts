import { describe, expect, it } from "vitest";
import { slideFieldsFor } from "./slideFields";

describe("slideFieldsFor", () => {
  it("text fields are multiline, time is single line, image and colour are skipped", () =>
    expect(
      slideFieldsFor({
        fields: [
          { key: "leader", label: "Leader", type: "text" },
          { key: "bg", label: "Background", type: "image" },
          { key: "c", label: "Colour", type: "color" },
          { key: "t", label: "Time", type: "time" },
        ],
      } as never),
    ).toEqual([
      { key: "leader", label: "Leader", multiline: true },
      { key: "t", label: "Time", multiline: false },
    ]));
  it("no template gives one Text field", () =>
    expect(slideFieldsFor(null)).toEqual([{ key: "text", label: "Text", multiline: true }]));
});
