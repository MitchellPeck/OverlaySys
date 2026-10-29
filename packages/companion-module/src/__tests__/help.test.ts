import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  currentHelpDefs,
  extractGenerated,
  renderHelpTables,
} from "../helpTables";
// Copied from apps/operator/src/app/shell/glossary.ts (cross-package import isn't possible).
const BANNED_COPY: RegExp[] = [
  /Cue → PVW|Cue Preview|Start Program|Take → Program|TAKE \(PVW/,
  /STT Spawner/,
  /Trust Mode/,
  /Pastor notes/,
  /\bFire hotcard\b/,
  /Channel hint/,
];

const helpMd = readFileSync(new URL("../../companion/HELP.md", import.meta.url), "utf8");
const defs = currentHelpDefs();
const NAME = /^[A-Z][a-z-]*( [a-z(]|\b)/;

describe("HELP.md", () => {
  it("generated tables match the current definitions (run gen:help if this fails)", () => {
    expect(extractGenerated(helpMd)).toBe(renderHelpTables(defs));
  });

  it("opens with the volunteer quick start", () => {
    expect(helpMd).toMatch(/^# [^\n]+\n+## Quick start \(volunteers\)/);
  });
});

describe("names", () => {
  const named = [
    ...Object.entries(defs.actions).map(([id, d]) => ["action", id, d.name] as const),
    ...Object.entries(defs.feedbacks).map(([id, d]) => ["feedback", id, d.name] as const),
  ];

  it.each(named)("%s %s uses '<Area>: <verb> <object>'", (_k, _id, name) => {
    expect(name).toMatch(NAME);
    expect(name).toContain(": ");
  });

  it("has no banned copy in names, descriptions or variable names", () => {
    const text = [
      ...named.map((n) => n[2]),
      ...Object.values(defs.feedbacks).map((d) => d.description ?? ""),
      ...defs.variables.map((v) => v.name),
    ];
    for (const t of text) for (const p of BANNED_COPY) expect(t, t).not.toMatch(p);
  });

  it("uses the true minus sign, not a hyphen, for negatives", () => {
    for (const v of defs.variables) expect(v.name).not.toMatch(/ -under|\(-\d/);
  });
});
