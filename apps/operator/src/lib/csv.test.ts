import { describe, expect, it } from "vitest";
import type { Field, TemplateMeta } from "@overlaysys/core";
import { EXAMPLE_CSV, parseCsvText, recordsToRows, resolveTemplate } from "./csv";

const templates = [
  { id: "lt-1", name: "Lower Third" },
  { id: "title", name: "Full Title" },
] as TemplateMeta[];

const ltFields: Field[] = [
  { key: "name", label: "Name", type: "text" },
  { key: "role", label: "Job Title", type: "text" },
];

let n = 0;
const makeId = () => `row-${++n}`;

describe("resolveTemplate", () => {
  it("matches by id, then case-insensitive id or name", () => {
    expect(resolveTemplate("lt-1", templates)?.id).toBe("lt-1");
    expect(resolveTemplate("LOWER THIRD", templates)?.id).toBe("lt-1");
    expect(resolveTemplate("Title", templates)?.id).toBe("title");
    expect(resolveTemplate("nope", templates)).toBeNull();
  });
});

describe("recordsToRows", () => {
  it("maps template names and field labels, keeps notes, reports skipped rows", () => {
    n = 0;
    const { records } = parseCsvText(
      "Template,Name,Job Title,extra,notes\n" +
        "Lower Third,Ann,Pastor,x,say hi\n" +
        ",Bob,,,\n" +
        "Ghost,Cy,,,\n" +
        "title,,,,\n",
    );
    const out = recordsToRows(records, templates, (id) => (id === "lt-1" ? ltFields : undefined), makeId);
    expect(out.rows).toEqual([
      { kind: "graphic", id: "row-1", templateId: "lt-1", data: { name: "Ann", role: "Pastor", extra: "x" }, notes: "say hi" },
      { kind: "graphic", id: "row-2", templateId: "title", data: {} },
    ]);
    expect(out.skipped).toEqual([
      { line: 3, reason: "no template" },
      { line: 4, reason: 'unknown template "Ghost"' },
    ]);
    expect(out.unmatchedColumns).toEqual({ "lt-1": ["extra"] });
  });
});

describe("parseCsvText", () => {
  it("ignores blank lines and reports a bad template on its spreadsheet line", () => {
    n = 0;
    const text = "title,template\nA,Lower Third\n\nB,Lower Third\nC,Ghost\n";
    const parsed = parseCsvText(text, { required: ["title"] });
    expect(parsed.lines).toEqual([2, 4, 5]);
    const out = recordsToRows(parsed.records, templates, () => undefined, makeId, parsed.lines);
    expect(out.skipped).toEqual([{ line: 5, reason: 'unknown template "Ghost"' }]);
  });

  it("reports a missing required header once", () => {
    const parsed = parseCsvText("name,template\nA,x\n", { required: ["title"] });
    expect(parsed.errors).toEqual([{ line: 1, message: "Missing column: title" }]);
    expect(parsed.records).toEqual([]);
  });

  it("drops an unknown column and reports it once; keepUnknown keeps it", () => {
    const text = "title,colour,template\nA,red,x\nB,blue,y\n";
    const known = ["title", "subtitle", "template", "length"];
    const dropped = parseCsvText(text, { known });
    expect(dropped.warnings).toEqual([{ line: 1, message: "Ignored column: colour" }]);
    expect(dropped.records[0]).toEqual({ title: "A", template: "x" });
    const kept = parseCsvText(text, { known, keepUnknown: true });
    expect(kept.warnings).toEqual([]);
    expect(kept.records[0]).toEqual({ title: "A", colour: "red", template: "x" });
  });

  it("ships an example with the documented header", () => {
    expect(EXAMPLE_CSV.split("\n")[0]).toBe("title,subtitle,template,length");
  });
});
