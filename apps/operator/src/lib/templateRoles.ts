import type { TemplateMeta } from "@overlaysys/core";

export type TemplateUse = "graphic" | "lyric" | "scripture" | "title";

/** Explicit `role` wins; otherwise infer from the template name. */
export function templateRole(meta: Pick<TemplateMeta, "name" | "role">): TemplateUse | "other" {
  if (meta.role) return meta.role;
  const n = meta.name;
  if (/^old\b/i.test(n)) return "other";
  if (/lyric/i.test(n)) return "lyric";
  if (/scripture|verse/i.test(n)) return "scripture";
  if (/intro|title|outro/i.test(n)) return "title";
  return "graphic";
}

const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);

/**
 * Split templates into those suited to `use` and the rest. `suggested` lists
 * `recentIds` (in that order) first, then the remaining matches by name.
 * Nothing is dropped.
 */
export function templatesFor<T extends Pick<TemplateMeta, "id" | "name" | "role">>(
  metas: T[],
  use: TemplateUse,
  recentIds: string[] = [],
): { suggested: T[]; others: T[] } {
  const matching = metas.filter((m) => templateRole(m) === use);
  const matchIds = new Set(matching.map((m) => m.id));
  const byId = new Map(matching.map((m) => [m.id, m]));
  const recent: T[] = [];
  const seen = new Set<string>();
  for (const id of recentIds) {
    const m = byId.get(id);
    if (m && !seen.has(id)) {
      recent.push(m);
      seen.add(id);
    }
  }
  const rest = matching.filter((m) => !seen.has(m.id)).sort(byName);
  const others = metas.filter((m) => !matchIds.has(m.id)).sort(byName);
  return { suggested: [...recent, ...rest], others };
}
