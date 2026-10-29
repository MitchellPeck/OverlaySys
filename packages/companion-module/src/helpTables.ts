import { actionDefinitions } from "./actions";
import { feedbackDefinitionsForSDK } from "./feedbacks";
import { variableDefinitions } from "./variables";
import { initialState } from "./types";

export const GENERATED_START = "<!-- generated:start -->";
export const GENERATED_END = "<!-- generated:end -->";

interface NamedOption {
  id: string;
  label?: string;
}
interface HelpEntry {
  name: string;
  description?: string;
  options?: NamedOption[];
}
export interface HelpDefs {
  actions: Record<string, HelpEntry>;
  feedbacks: Record<string, HelpEntry>;
  variables: { variableId: string; name: string }[];
}

const cell = (s: string): string => s.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim();

function inputs(e: HelpEntry): string {
  const labels = (e.options ?? []).map((o) => o.label ?? o.id);
  return labels.length ? cell(labels.join(", ")) : "−";
}

function entryTable(
  title: string,
  defs: Record<string, HelpEntry>,
  withDescription: boolean,
): string {
  const head = withDescription
    ? "| Name | Id | Inputs | When it is on |\n|------|----|--------|---------------|"
    : "| Name | Id | Inputs |\n|------|----|--------|";
  const rows = Object.entries(defs).map(([id, e]) => {
    const base = `| ${cell(e.name)} | \`${id}\` | ${inputs(e)} |`;
    return withDescription ? `${base} ${cell(e.description ?? "")} |` : base;
  });
  return [`### ${title}`, "", head, ...rows].join("\n");
}

/** Markdown placed between the generated markers in HELP.md. */
export function renderHelpTables(defs: HelpDefs): string {
  const vars = [
    "### Variables",
    "",
    "`<c>` is a channel id (for example `program`); `<n>` counts from 1.",
    "",
    "| Variable | What it holds |",
    "|----------|---------------|",
    ...defs.variables.map((v) => `| \`${v.variableId}\` | ${cell(v.name)} |`),
  ].join("\n");
  return [
    entryTable("Actions", defs.actions, false),
    entryTable("Feedbacks", defs.feedbacks, true),
    vars,
  ].join("\n\n");
}

/** Variables with the per-channel and per-row repeats collapsed to `<c>` / `<n>`. */
function collapsedVariables(): HelpDefs["variables"] {
  const out: HelpDefs["variables"] = [];
  for (const v of variableDefinitions(["<c>"])) {
    const m = /^(.*?_)(\d+)(_.*)$/.exec(v.variableId);
    if (!m) {
      out.push(v);
      continue;
    }
    if (m[2] !== "1") continue;
    out.push({
      variableId: `${m[1]}<n>${m[3]}`,
      name: v.name.replace(/\b1\b/, "<n>"),
    });
  }
  return out;
}

/** The definitions as the module registers them today. */
export function currentHelpDefs(): HelpDefs {
  const state = initialState();
  return {
    actions: actionDefinitions(state, () => {}) as unknown as HelpDefs["actions"],
    feedbacks: feedbackDefinitionsForSDK(state, () => false) as unknown as HelpDefs["feedbacks"],
    variables: collapsedVariables(),
  };
}

/** Replace the generated block of a HELP.md body. */
export function spliceHelp(markdown: string, block: string): string {
  const a = markdown.indexOf(GENERATED_START);
  const b = markdown.indexOf(GENERATED_END);
  if (a < 0 || b < a) throw new Error("HELP.md is missing the generated markers");
  return `${markdown.slice(0, a + GENERATED_START.length)}\n${block}\n${markdown.slice(b)}`;
}

/** The text currently between the generated markers. */
export function extractGenerated(markdown: string): string {
  const a = markdown.indexOf(GENERATED_START);
  const b = markdown.indexOf(GENERATED_END);
  if (a < 0 || b < a) throw new Error("HELP.md is missing the generated markers");
  return markdown.slice(a + GENERATED_START.length, b).replace(/^\n/, "").replace(/\n$/, "");
}
