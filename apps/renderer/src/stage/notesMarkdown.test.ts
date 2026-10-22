import { describe, expect, it } from "vitest";
import { parseNotesMarkdown } from "./notesMarkdown";

describe("parseNotesMarkdown", () => {
  it("parses headings, paragraphs and emphasis", () => {
    expect(parseNotesMarkdown("## Grace\nIt is **free** and *undeserved*.")).toEqual([
      { kind: "heading", level: 2, spans: [{ text: "Grace" }] },
      {
        kind: "para",
        spans: [{ text: "It is " }, { text: "free", bold: true }, { text: " and " }, { text: "undeserved", italic: true }, { text: "." }],
      },
    ]);
  });
  it("joins consecutive lines into one paragraph and splits on blank lines", () => {
    expect(parseNotesMarkdown("a\nb\n\nc").map((b) => b.kind)).toEqual(["para", "para"]);
    expect(parseNotesMarkdown("a\nb")[0]).toEqual({ kind: "para", spans: [{ text: "a b" }] });
  });
  it("parses bulleted and numbered lists", () => {
    expect(parseNotesMarkdown("- one\n- two\n\n1. first\n2) second")).toEqual([
      { kind: "list", ordered: false, items: [[{ text: "one" }], [{ text: "two" }]] },
      { kind: "list", ordered: true, items: [[{ text: "first" }], [{ text: "second" }]] },
    ]);
  });
  it("leaves unmatched markers as text", () => {
    expect(parseNotesMarkdown("2 * 3 = 6")[0]).toEqual({ kind: "para", spans: [{ text: "2 * 3 = 6" }] });
  });
});
