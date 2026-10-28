import { describe, expect, it } from "vitest";
import { cumulativeStarts, formatRowLength, lengthEcho, parseRowLength, showTotal } from "./rowLength";

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
  it("decimal minutes", () => {
    expect(parseRowLength("1.5")).toEqual({ ok: true, sec: 90 });
  });
  it.each([["5", 300], ["4.5", 270], ["1:30", 90], ["90s", 90], ["2m", 120], ["2m30s", 150], ["1:02:03", 3723], ["0", undefined], ["0s", undefined], ["0:00", undefined], ["", undefined]])(
    "parseRowLength(%s) [D13]",
    (t, sec) => expect(parseRowLength(t as string)).toEqual({ ok: true, sec }),
  );
  it.each(["abc", "1:75", "-3", "5x"])("rejects %s", (t) => expect(parseRowLength(t)).toEqual({ ok: false }));
  it("lengthEcho echoes minutes", () => {
    expect(lengthEcho("5")).toBe("= 5:00");
    expect(lengthEcho("")).toBeNull();
    expect(lengthEcho("abc")).toBeNull();
  });
  it("cumulativeStarts and total", () => {
    const l = (lengthSec?: number) => ({ lengthSec });
    expect(cumulativeStarts([l(60), l(90), l(30)])).toEqual([0, 60, 150]);
    expect(cumulativeStarts([l(60), l(), l(30)])).toEqual([0, 60, null]);
    expect(showTotal([l(60), l(90)])).toBe(150);
    expect(showTotal([l()])).toBeNull();
  });
  it("round-trips an hour-plus length", () => {
    const text = formatRowLength(3725);
    expect(text).toBe("1:02:05");
    expect(parseRowLength(text)).toEqual({ ok: true, sec: 3725 });
  });
});
