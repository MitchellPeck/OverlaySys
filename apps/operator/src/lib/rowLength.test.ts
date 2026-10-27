import { describe, expect, it } from "vitest";
import { formatRowLength, parseRowLength } from "./rowLength";

describe("rowLength", () => {
  it("formats", () => {
    expect(formatRowLength(undefined)).toBe("");
    expect(formatRowLength(300)).toBe("5:00");
    expect(formatRowLength(3725)).toBe("1:02:05");
  });
  it("parses", () => {
    expect(parseRowLength("")).toEqual({ ok: true, sec: undefined });
    expect(parseRowLength("  ")).toEqual({ ok: true, sec: undefined });
    expect(parseRowLength("4:30")).toEqual({ ok: true, sec: 270 });
    expect(parseRowLength("abc")).toEqual({ ok: false });
  });
});
