import { describe, expect, it } from "vitest";
import type { Field, TemplateMeta } from "@overlaysys/core";
import { parseCsvText, recordsToRows, resolveTemplate } from "./csv";

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
      { line: 2, reason: "no template" },
      { line: 3, reason: 'unknown template "Ghost"' },
    ]);
    expect(out.unmatchedColumns).toEqual({ "lt-1": ["extra"] });
  });
});
