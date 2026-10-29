import type { PcoPlanItem } from "@overlaysys/core";

export type ImportAs = "graphic" | "song" | "skip";

export interface ImportOption {
  value: ImportAs;
  label: string;
}

/**
 * Options for a row's "Import as" select. Kept as one array so later kinds
 * (slides) append additively. "Song" only when PCO has a song for the item.
 */
export function importOptions(item: Pick<PcoPlanItem, "song">): ImportOption[] {
  const options: ImportOption[] = [];
  if (item.song) options.push({ value: "song", label: "Song" });
  options.push({ value: "graphic", label: "Graphic" });
  options.push({ value: "skip", label: "Skip" });
  return options;
}

export interface SummaryRow {
  include: boolean;
  importAs: ImportAs;
}

/** Footer text, e.g. "Import 7 items (2 songs)". */
export function importSummary(rows: SummaryRow[]): { label: string; count: number } {
  const chosen = rows.filter((r) => r.include && r.importAs !== "skip");
  const count = chosen.length;
  const songs = chosen.filter((r) => r.importAs === "song").length;
  let label = `Import ${count} ${count === 1 ? "item" : "items"}`;
  if (songs > 0) label += ` (${songs} ${songs === 1 ? "song" : "songs"})`;
  return { label, count };
}

const TYPE_LABELS: Record<string, string> = {
  song: "Song",
  item: "Item",
  media: "Media",
  header: "Header",
};

export function humaniseItemType(t: string): string {
  return TYPE_LABELS[t] ?? (t ? t.charAt(0).toUpperCase() + t.slice(1) : "Item");
}
