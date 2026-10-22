import { describe, expect, it } from "vitest";
import { normalizeImportedMarkdown, notesFromFile, titleFromFileName } from "./notesImport";

describe("normalizeImportedMarkdown", () => {
  it("drops images and table pipes, keeps headings, emphasis and lists", () => {
    const md = "# Title\n\n![](data:image/png;base64,AAA)\n\n__Bold__ and _it_\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n* one\n* two";
    expect(normalizeImportedMarkdown(md)).toBe("# Title\n\n**Bold** and *it*\n\na b\n1 2\n\n- one\n- two");
  });
  it("unescapes mammoth's backslash escapes and collapses blank runs", () => {
    expect(normalizeImportedMarkdown("Point 1\\. Grace\n\n\n\nNext")).toBe("Point 1. Grace\n\nNext");
  });
  it("trims trailing spaces and the whole document", () => {
    expect(normalizeImportedMarkdown("  \nA  \nB\n\n")).toBe("A\nB");
  });
  it("leaves snake_case words untouched", () => {
    expect(normalizeImportedMarkdown("use snake_case_name here")).toBe("use snake_case_name here");
  });
});

describe("escaped underscores", () => {
  it("keeps foo\\_bar\\_ baz as foo_bar_ baz", () => {
    expect(normalizeImportedMarkdown("foo\\_bar\\_ baz")).toBe("foo_bar_ baz");
  });
});

describe("notesFromFile guards", () => {
  const mk = (name: string, size: number, text: string) => ({
    name,
    size,
    text: async () => text,
    arrayBuffer: async () => new ArrayBuffer(0),
  });
  it("rejects empty content", async () => {
    await expect(notesFromFile(mk("a.txt", 3, "  \n "))).rejects.toThrow("No text found in that file");
  });
  it("rejects files over 5 MB", async () => {
    await expect(notesFromFile(mk("a.txt", 5 * 1024 * 1024 + 1, "x"))).rejects.toThrow("File is too large (max 5 MB)");
  });
  it("returns title and body for good files", async () => {
    await expect(notesFromFile(mk("Sermon.md", 5, "# A"))).resolves.toEqual({ title: "Sermon", body: "# A" });
  });
});

describe("titleFromFileName", () => {
  it("strips the extension", () => {
    expect(titleFromFileName("Sunday Sermon.docx")).toBe("Sunday Sermon");
    expect(titleFromFileName("notes")).toBe("notes");
  });
});
