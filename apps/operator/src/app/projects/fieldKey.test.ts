import { describe, expect, it } from "vitest";
import { deriveFieldKey } from "./fieldKey";

describe("deriveFieldKey", () => {
  it("snake_cases a label", () => {
    expect(deriveFieldKey("Speaker name", [])).toBe("speaker_name");
  });
  it("suffixes collisions", () => {
    expect(deriveFieldKey("Speaker name", ["speaker_name"])).toBe("speaker_name_2");
    expect(deriveFieldKey("Speaker name", ["speaker_name", "speaker_name_2"])).toBe("speaker_name_3");
  });
  it("falls back to field for an empty label", () => {
    expect(deriveFieldKey("  ", [])).toBe("field");
    expect(deriveFieldKey("日本", [])).toBe("field");
  });
  it("keeps digits and strips punctuation and accents", () => {
    expect(deriveFieldKey("Hymn # (1st) Café", [])).toBe("hymn_1st_cafe");
  });
});
