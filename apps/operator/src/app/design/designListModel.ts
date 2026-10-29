import type { StageLayoutMeta, TemplateMeta } from "@overlaysys/core";
import type { Column, FilterSpec, MenuItem, SortSpec } from "@overlaysys/ui";
import { formatRelative } from "../../lib/listFormat";
import { templateRole } from "../../lib/templateRoles";

export const GRAPHICS_STORAGE_KEY = "design-graphics";
export const STAGE_STORAGE_KEY = "design-stage";
export const DEFAULT_GRAPHICS_SORT = "edited-desc";
export const DEFAULT_STAGE_SORT = "name-asc";

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

/** updatedAt desc, items without a date last, then name. */
function byEdited(a: { name: string; updatedAt?: string }, b: { name: string; updatedAt?: string }): number {
  if (a.updatedAt && b.updatedAt && a.updatedAt !== b.updatedAt) return b.updatedAt.localeCompare(a.updatedAt);
  if (a.updatedAt && !b.updatedAt) return -1;
  if (!a.updatedAt && b.updatedAt) return 1;
  return byName(a, b);
}

export const formatSize = (s: { w: number; h: number }) => `${s.w}×${s.h}`;

export const ROLE_LABEL = {
  graphic: "Graphic",
  lyric: "Lyric",
  scripture: "Scripture",
  title: "Title",
  other: "Other",
} as const;

export const roleLabel = (t: Pick<TemplateMeta, "name" | "role">) => ROLE_LABEL[templateRole(t)];

export const templateSorts: SortSpec<TemplateMeta>[] = [
  { id: "edited-desc", label: "Recently edited", compare: byEdited },
  { id: "name-asc", label: "Name", compare: byName },
];

export const templateFilters: FilterSpec<TemplateMeta>[] = [
  {
    id: "role",
    label: "types",
    options: (["graphic", "lyric", "scripture", "title", "other"] as const).map((v) => ({
      value: v,
      label: ROLE_LABEL[v],
    })),
    test: (t, v) => templateRole(t) === v,
  },
];

export const templateColumns = (now: () => Date = () => new Date()): Column<TemplateMeta>[] => [
  { id: "type", label: "Type", width: "96px", render: roleLabel },
  { id: "size", label: "Size", width: "100px", render: (t) => formatSize(t.size) },
  { id: "edited", label: "Edited", width: "120px", render: (t) => formatRelative(t.updatedAt, now()) },
];

/** "1920×1080 · edited 2 days ago" (no "edited" part without a date). */
export function templateSecondary(t: Pick<TemplateMeta, "size" | "updatedAt">, now: Date): string {
  const edited = formatRelative(t.updatedAt, now);
  return edited ? `${formatSize(t.size)} · edited ${edited}` : formatSize(t.size);
}

export const stageSorts: SortSpec<StageLayoutMeta>[] = [
  {
    id: "name-asc",
    label: "Name",
    compare: (a, b) => (a.builtIn === b.builtIn ? byName(a, b) : a.builtIn ? -1 : 1),
  },
  { id: "edited-desc", label: "Recently edited", compare: byEdited },
];

export const BUILT_IN_DELETE_REASON = "Built-in layouts can't be deleted";

export type DesignActions<T> = {
  open(t: T): void;
  duplicate(t: T): void;
  rename(t: T): void;
  delete(t: T): void;
  copyId(t: T): void;
  export?(t: T): void;
};

export const OFFLINE_REASON = "Reconnect to edit designs";

/** `offlineReason` disables the actions that need the server (shown as the tooltip). */
export function templateMenuItems(t: TemplateMeta, a: DesignActions<TemplateMeta>, offlineReason?: string): MenuItem[] {
  const off = offlineReason ? { disabled: offlineReason } : {};
  return [
    { id: "open", label: "Open", onSelect: () => a.open(t) },
    { id: "duplicate", label: "Duplicate", ...off, onSelect: () => a.duplicate(t) },
    { id: "rename", label: "Rename…", ...off, onSelect: () => a.rename(t) },
    { id: "export", label: "Export JSON", onSelect: () => a.export?.(t) },
    { id: "copy-id", label: "Copy id", onSelect: () => a.copyId(t) },
    { separator: true },
    { id: "delete", label: "Delete…", danger: true, ...off, onSelect: () => a.delete(t) },
  ];
}

export function stageMenuItems(l: StageLayoutMeta, a: DesignActions<StageLayoutMeta>, offlineReason?: string): MenuItem[] {
  const off = offlineReason ? { disabled: offlineReason } : {};
  const items: MenuItem[] = [
    { id: "open", label: l.builtIn ? "View" : "Open", onSelect: () => a.open(l) },
    { id: "duplicate", label: "Duplicate", ...off, onSelect: () => a.duplicate(l) },
  ];
  if (!l.builtIn) items.push({ id: "rename", label: "Rename…", ...off, onSelect: () => a.rename(l) });
  items.push({ id: "copy-id", label: "Copy id", onSelect: () => a.copyId(l) }, { separator: true });
  items.push({
    id: "delete",
    label: "Delete…",
    danger: true,
    disabled: l.builtIn ? BUILT_IN_DELETE_REASON : (offlineReason ?? false),
    onSelect: () => a.delete(l),
  });
  return items;
}

/** Names of the stage channels using a layout, "—" when none. */
export function usedByLabel(channels: { id: string; name?: string }[]): string {
  return channels.length === 0 ? "—" : channels.map((c) => c.name || c.id).join(", ");
}
