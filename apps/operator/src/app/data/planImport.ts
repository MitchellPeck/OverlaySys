export type ImportDecision = "import" | "replace" | "copy" | "skip";

export interface PlanInputRow {
  kind: string;
  id: string;
  name: string;
  conflict?: { name: string; updatedAt?: string };
  /** Truthy when the item probably duplicates something already in the library. */
  likelyDuplicate?: unknown;
  /** Project the item came from, when the bundle says. */
  project?: string;
}

export type PlannedRow<R extends PlanInputRow = PlanInputRow> = R & {
  decision: ImportDecision;
  targetProject: string;
};

/** Default decisions: conflicts replace, likely duplicates skip, everything else imports. */
export function planImport<R extends PlanInputRow>(
  rows: readonly R[],
  defaults: { currentProject: string },
): { rows: PlannedRow<R>[]; summary: string } {
  const planned = rows.map<PlannedRow<R>>((r) => ({
    ...r,
    decision: r.conflict ? "replace" : r.likelyDuplicate ? "skip" : "import",
    targetProject: r.project || defaults.currentProject,
  }));
  return { rows: planned, summary: summarizePlan(planned) };
}

/** "Import 2, replace 2, skip 1" (zero parts are left out). */
export function summarizePlan(rows: readonly { decision: ImportDecision }[]): string {
  const n = (d: ImportDecision) => rows.filter((r) => r.decision === d).length;
  const parts: string[] = [];
  const add = (label: string, count: number) => {
    if (count > 0) parts.push(`${parts.length ? label.toLowerCase() : label} ${count}`);
  };
  add("Import", n("import"));
  add("Replace", n("replace"));
  add("Copy", n("copy"));
  add("Skip", n("skip"));
  return parts.length ? parts.join(", ") : "Nothing to import";
}
