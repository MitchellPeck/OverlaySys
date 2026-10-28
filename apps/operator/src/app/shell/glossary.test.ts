import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import { BANNED_COPY } from "./glossary";

const REPO = resolve(__dirname, "../../../../..");
const APP = join(REPO, "apps/operator/src/app");

// Directories whose owning copy-fix task hasn't merged yet are `todo`; each
// task flips its entry to "enforced" in the same commit as its copy fix.
const DIRS: { dir: string; status: "enforced" | "todo" }[] = [
  { dir: join(APP, "shell"), status: "enforced" },
  { dir: join(APP, "settings"), status: "todo" },
  { dir: join(APP, "account"), status: "todo" },
  { dir: join(APP, "design/edit"), status: "todo" },
  { dir: join(APP, "design/stage"), status: "todo" },
  { dir: join(APP, "hotcards/edit"), status: "todo" },
  { dir: join(APP, "pco"), status: "todo" },
  { dir: join(APP, "data"), status: "todo" },
  { dir: join(APP, "projects"), status: "todo" },
  { dir: join(REPO, "packages/companion-module/src"), status: "todo" },
];

function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && name !== "glossary.ts") out.push(p);
  }
  return out;
}

/** String-literal and JSX-text contents of a file (comments are never visited). */
function strings(file: string): string[] {
  const src = readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: string[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isJsxText(n)) out.push(n.text);
    else if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) out.push(n.text);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

describe("glossary: no banned copy in UI strings", () => {
  for (const { dir, status } of DIRS) {
    const name = dir.replace(REPO + "/", "");
    if (status === "todo") {
      it.todo(name);
      continue;
    }
    it(name, () => {
      const hits: string[] = [];
      for (const f of files(dir)) {
        for (const s of strings(f)) {
          for (const { pattern, use } of BANNED_COPY) {
            if (pattern.test(s)) hits.push(`${f.replace(REPO + "/", "")}: "${s.trim().slice(0, 60)}" -> use ${use}`);
          }
        }
      }
      expect(hits).toEqual([]);
    });
  }
});
