import { describe, expect, it } from "vitest";
import { BundledProvider, type BundleFile } from "./bundled";
import { parseReference } from "../reference";
import miniRaw from "../__fixtures__/mini-kjv.json";

const mini = miniRaw;

const bundle = mini as BundleFile;

describe("BundledProvider", () => {
  const provider = new BundledProvider([bundle]);

  it("exposes the bundle's translation meta", () => {
    expect(provider.translations).toHaveLength(1);
    expect(provider.translations[0]!.id).toBe("MINI_KJV");
  });

  it("fetches a single verse", async () => {
    const refs = parseReference("John 3:16");
    const res = await provider.fetchPassage(refs, "MINI_KJV");
    expect(res.verses).toHaveLength(1);
    expect(res.verses[0]!.book).toBe("JHN");
    expect(res.verses[0]!.chapter).toBe(3);
    expect(res.verses[0]!.verse).toBe(16);
    expect(res.verses[0]!.text).toMatch(/^For God so loved/);
    expect(res.attribution).toMatch(/Public Domain/);
  });

  it("fetches a same-chapter range", async () => {
    const refs = parseReference("John 3:16-18");
    const res = await provider.fetchPassage(refs, "MINI_KJV");
    expect(res.verses.map((v) => v.verse)).toEqual([16, 17, 18]);
  });

  it("fetches a cross-chapter range", async () => {
    const refs = parseReference("John 3:17-4:2");
    const res = await provider.fetchPassage(refs, "MINI_KJV");
    expect(res.verses.map((v) => `${v.chapter}:${v.verse}`)).toEqual([
      "3:17", "3:18", "4:1", "4:2",
    ]);
  });

  it("fetches a multi-passage list, preserving order", async () => {
    const refs = parseReference("Rom 8:28; John 3:16");
    const res = await provider.fetchPassage(refs, "MINI_KJV");
    expect(res.verses.map((v) => `${v.book} ${v.chapter}:${v.verse}`)).toEqual([
      "ROM 8:28",
      "JHN 3:16",
    ]);
  });

  it("throws on an unknown translation id", async () => {
    const refs = parseReference("John 3:16");
    await expect(provider.fetchPassage(refs, "UNKNOWN"))
      .rejects.toThrow(/unknown translation/i);
  });

  it("throws on a chapter that doesn't exist in this book", async () => {
    const refs = parseReference("John 99:1");
    await expect(provider.fetchPassage(refs, "MINI_KJV"))
      .rejects.toThrow(/chapter/i);
  });

  it("throws on a verse that doesn't exist in this chapter", async () => {
    const refs = parseReference("John 3:99");
    await expect(provider.fetchPassage(refs, "MINI_KJV"))
      .rejects.toThrow(/verse/i);
  });
});
