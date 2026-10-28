import { describe, expect, it } from "vitest";
import { templateDeleteConfirm, type TemplateUsage } from "./templateUsage";

const usage = (over: Partial<TemplateUsage> = {}): TemplateUsage => ({
  shows: [],
  hotcards: [],
  songs: [],
  scriptureDefault: false,
  protected: false,
  ...over,
});
const named = (...n: string[]) => n.map((name) => ({ id: name, name }));

describe("templateDeleteConfirm", () => {
  it("names the first 3 and counts the rest", () => {
    const c = templateDeleteConfirm("Lower Third", usage({ shows: named("A", "B", "C", "D") }));
    expect(c.blocked).toBe(false);
    expect(c.title).toBe('Delete "Lower Third"?');
    expect(c.message).toContain("A, B, C and 1 more");
    expect(c.message).toContain("Used in 4 shows");
    expect(c.message).toContain('Those items will show "missing template".');
    expect(c.message.endsWith("This can't be undone.")).toBe(true);
    expect(c.confirmLabel).toBe("Delete");
  });
  it("joins shows and hotcards", () => {
    const c = templateDeleteConfirm("X", usage({ shows: named("A", "B", "C"), hotcards: named("H") }));
    expect(c.message).toContain("Used in 3 shows (A, B, C) and 1 hotcard.");
  });
  it("blocks the built-in lyric template", () => {
    const c = templateDeleteConfirm("Lyric — Default", usage({ protected: true }));
    expect(c.blocked).toBe(true);
    expect(c.title).toBe('Can\'t delete "Lyric — Default"');
    expect(c.message).toBe("This is the built-in lyric template. Duplicate it to make your own version.");
    expect(c.confirmLabel).toBe("OK");
  });
  it("plain copy when unknown or unused", () => {
    expect(templateDeleteConfirm("X", null).message).toBe("This can't be undone.");
    expect(templateDeleteConfirm("X", usage()).message).toBe("This can't be undone.");
  });
});
