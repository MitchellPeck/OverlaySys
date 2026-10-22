import { describe, expect, it } from "vitest";
import { normalizeImportedMarkdown, titleFromFileName } from "./notesImport";

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

describe("titleFromFileName", () => {
  it("strips the extension", () => {
    expect(titleFromFileName("Sunday Sermon.docx")).toBe("Sunday Sermon");
    expect(titleFromFileName("notes")).toBe("notes");
  });
});
