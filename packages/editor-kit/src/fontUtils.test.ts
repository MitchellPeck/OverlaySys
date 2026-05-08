import { describe, expect, it } from "vitest";
import { fontFamilyFromFilename, fontPickerOptions } from "./fontUtils";

describe("fontFamilyFromFilename", () => {
  it("strips a single extension", () => {
    expect(fontFamilyFromFilename("acme-sans.woff2")).toBe("Acme Sans");
  });

  it("title-cases hyphen and underscore separators", () => {
    expect(fontFamilyFromFilename("my_cool_font.ttf")).toBe("My Cool Font");
    expect(fontFamilyFromFilename("display-bold.otf")).toBe("Display Bold");
  });

  it("preserves spaces and trims them", () => {
    expect(fontFamilyFromFilename("  Big  Display .woff")).toBe("Big Display");
  });

  it("falls back to 'Custom Font' for empty input", () => {
    expect(fontFamilyFromFilename("")).toBe("Custom Font");
    expect(fontFamilyFromFilename(".woff2")).toBe("Custom Font");
  });
});

describe("fontPickerOptions", () => {
  it("returns the system fallbacks alone when template has no fonts and current is one of them", () => {
    expect(fontPickerOptions([], "Inter")).toEqual([
      "Inter",
      "system-ui",
      "Arial",
      "Georgia",
      "Times New Roman",
    ]);
  });

  it("appends template fonts after fallbacks, deduped", () => {
    expect(
      fontPickerOptions([{ family: "Acme Sans", src: "x" }], "Acme Sans"),
    ).toEqual([
      "Inter",
      "system-ui",
      "Arial",
      "Georgia",
      "Times New Roman",
      "Acme Sans",
    ]);
  });

  it("appends the current value if it isn't already present", () => {
    expect(fontPickerOptions([], "Helvetica Neue")).toEqual([
      "Inter",
      "system-ui",
      "Arial",
      "Georgia",
      "Times New Roman",
      "Helvetica Neue",
    ]);
  });

  it("ignores empty current value", () => {
    expect(fontPickerOptions([], "")).toEqual([
      "Inter",
      "system-ui",
      "Arial",
      "Georgia",
      "Times New Roman",
    ]);
  });

  it("dedupes a template font that matches a fallback", () => {
    expect(fontPickerOptions([{ family: "Inter", src: "x" }], "Inter")).toEqual([
      "Inter",
      "system-ui",
      "Arial",
      "Georgia",
      "Times New Roman",
    ]);
  });
});
