import { describe, expect, it } from "vitest";
import { RECORD_ID_MAX_LENGTH, STAGE_LAYOUT_ID_PATTERN, fitRecordId, resolveImportedSongId, slugifyTitle } from "./index";

const long = "a-very-long-hymn-title-that-goes-on-and-on-and-on-and-on-forever-and-ever-amen";

describe("record id length", () => {
  it("matches the stage layout id limit (64)", () => {
    expect(RECORD_ID_MAX_LENGTH).toBe(64);
    expect(STAGE_LAYOUT_ID_PATTERN.test("a".repeat(RECORD_ID_MAX_LENGTH))).toBe(true);
    expect(STAGE_LAYOUT_ID_PATTERN.test("a".repeat(RECORD_ID_MAX_LENGTH + 1))).toBe(false);
  });

  it("fitRecordId leaves short ids alone and cuts long ones, suffix included", () => {
    expect(fitRecordId("be-thou-my-vision")).toBe("be-thou-my-vision");
    expect(fitRecordId("be-thou-my-vision", "-2")).toBe("be-thou-my-vision-2");
    expect(fitRecordId(long)).toHaveLength(RECORD_ID_MAX_LENGTH);
    const withSuffix = fitRecordId(long, "-12");
    expect(withSuffix.length).toBeLessThanOrEqual(RECORD_ID_MAX_LENGTH);
    expect(withSuffix.endsWith("-12")).toBe(true);
  });

  it("does not leave a dash dangling where it cut", () => {
    // Cut lands right after a dash: "aaa…a-" → no trailing dash, no "--2".
    const base = `${"a".repeat(RECORD_ID_MAX_LENGTH - 1)}-bbbb`;
    expect(fitRecordId(base)).toBe("a".repeat(RECORD_ID_MAX_LENGTH - 1));
    expect(fitRecordId(`${"a".repeat(RECORD_ID_MAX_LENGTH - 3)}-bbbb`, "-2")).toBe(`${"a".repeat(RECORD_ID_MAX_LENGTH - 3)}-2`);
  });

  it("slugifyTitle never exceeds the limit", () => {
    expect(slugifyTitle(long.replace(/-/g, " ")).length).toBeLessThanOrEqual(RECORD_ID_MAX_LENGTH);
  });

  it("resolveImportedSongId keeps suffixed ids within the limit", () => {
    const pcoSong = { id: "1", title: long.replace(/-/g, " ") } as Parameters<typeof resolveImportedSongId>[0];
    const first = resolveImportedSongId(pcoSong, new Set());
    expect(first.length).toBeLessThanOrEqual(RECORD_ID_MAX_LENGTH);
    const second = resolveImportedSongId(pcoSong, new Set([first]));
    expect(second).not.toBe(first);
    expect(second.length).toBeLessThanOrEqual(RECORD_ID_MAX_LENGTH);
    expect(second.endsWith("-2")).toBe(true);
  });
});
