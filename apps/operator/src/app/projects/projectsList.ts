import type { MenuItem, SortSpec } from "@overlaysys/ui";

export type ProjectRow = {
  id: string;
  name: string;
  shows: number;
  hotcards: number;
  isCurrent: boolean;
  isDefault: boolean;
};

export type ProjectActions = {
  makeCurrent(): void;
  rename(): void;
  customFields(): void;
  copyId(): void;
  remove(): void;
  /** Desktop only; omitted elsewhere. */
  publish?: { run(): void; disabledReason?: string };
};

const byName = (a: ProjectRow, b: ProjectRow) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });

export const projectSorts: SortSpec<ProjectRow>[] = [
  { id: "name-asc", label: "Name A–Z", compare: byName },
  {
    id: "current-first",
    label: "Current first",
    compare: (a, b) => Number(b.isCurrent) - Number(a.isCurrent) || byName(a, b),
  },
];

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** "3 shows · 2 hotcards". Never the id. */
export function projectSecondary(row: ProjectRow): string {
  return `${plural(row.shows, "show")} · ${plural(row.hotcards, "hotcard")}`;
}

export function projectDeleteDisabledReason(row: ProjectRow): string | undefined {
  if (row.isDefault) return "The default project can't be deleted";
  if (row.shows + row.hotcards > 0) return "Move or delete its shows and hotcards first";
  return undefined;
}

export function projectMenuItems(row: ProjectRow, actions: ProjectActions): MenuItem[] {
  const items: MenuItem[] = [
    {
      id: "make-current",
      label: "Make current",
      disabled: row.isCurrent ? "Already the current project" : false,
      onSelect: actions.makeCurrent,
    },
    { id: "rename", label: "Rename…", onSelect: actions.rename },
    { id: "custom-fields", label: "Custom fields…", onSelect: actions.customFields },
  ];
  if (actions.publish) {
    items.push({
      id: "publish",
      label: "Publish to cloud…",
      disabled: actions.publish.disabledReason ?? false,
      onSelect: actions.publish.run,
    });
  }
  items.push(
    { id: "copy-id", label: "Copy id", onSelect: actions.copyId },
    { separator: true },
    {
      id: "delete",
      label: "Delete…",
      danger: true,
      disabled: projectDeleteDisabledReason(row) ?? false,
      onSelect: actions.remove,
    },
  );
  return items;
}

/** "test" vs ["Test"] is a duplicate (case-insensitive, trimmed). */
export function projectNameError(name: string, others: string[]): string | null {
  const n = name.trim();
  if (!n) return "Enter a name";
  const key = n.toLowerCase();
  if (others.some((o) => o.trim().toLowerCase() === key)) {
    return `A project named "${n}" already exists`;
  }
  return null;
}

/** Items whose projectId isn't a live project. */
export function unassignedItems<S extends { projectId: string }, H extends { projectId: string }>(
  shows: S[],
  hotcards: H[],
  projectIds: Iterable<string>,
): { shows: S[]; hotcards: H[] } {
  const live = new Set(projectIds);
  return {
    shows: shows.filter((s) => !live.has(s.projectId)),
    hotcards: hotcards.filter((h) => !live.has(h.projectId)),
  };
}
