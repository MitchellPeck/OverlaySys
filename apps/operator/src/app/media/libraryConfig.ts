import { liveFolderFileUrl, type LiveFolderFile, type MediaItem, type MediaItemMeta } from "@overlaysys/core";
import type { FilterSpec, MenuItem, SortSpec } from "@overlaysys/ui";

export const MEDIA_LIST_STORAGE_KEY = "media";
export const DEFAULT_MEDIA_SORT = "name-asc";
/** Filter value for items that are in no folder ("" and "all" mean "no filter"). */
export const NO_FOLDER = "__none__";

export const mediaSorts: SortSpec<MediaItemMeta>[] = [
  { id: "name-asc", label: "Name", compare: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) },
  { id: "added-desc", label: "Recently added", compare: (a, b) => b.createdAt.localeCompare(a.createdAt) },
];

export function folderNames(items: Pick<MediaItem, "folder">[]): string[] {
  return [...new Set(items.map((m) => m.folder).filter((f): f is string => !!f))].sort((x, y) => x.localeCompare(y));
}

export const typeLabel = (m: Pick<MediaItem, "kind" | "mediaType">): string =>
  m.kind === "live-folder" ? "Live folder" : m.mediaType === "video" ? "Video" : "Photo";

/** Type filter always; folder filter once any item is in a folder. */
export function mediaFilters(items: MediaItemMeta[]): FilterSpec<MediaItemMeta>[] {
  const out: FilterSpec<MediaItemMeta>[] = [
    {
      id: "type",
      label: "types",
      options: [
        { value: "image", label: "Photos" },
        { value: "video", label: "Videos" },
        { value: "live-folder", label: "Live folders" },
      ],
      test: (m, v) => (v === "live-folder" ? m.kind === "live-folder" : m.kind === "file" && m.mediaType === v),
    },
  ];
  const folders = folderNames(items);
  if (folders.length > 0) {
    out.push({
      id: "folder",
      label: "folders",
      options: [...folders.map((f) => ({ value: f, label: f })), { value: NO_FOLDER, label: "No folder" }],
      test: (m, v) => (v === NO_FOLDER ? !m.folder : m.folder === v),
    });
  }
  return out;
}

export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export type Thumbnail = { kind: "image"; url: string } | { kind: "video"; url: string } | { kind: "folder" };

/** What to draw for an item. A video's `url` is its asset URL (the view swaps in the poster). */
export function thumbnailSource(item: MediaItem, liveFiles: LiveFolderFile[] | undefined): Thumbnail {
  if (item.kind === "live-folder") {
    const first = liveFiles?.find((f) => f.mediaType === "image");
    return first ? { kind: "image", url: liveFolderFileUrl(item.id, first.name) } : { kind: "folder" };
  }
  if (!item.assetUrl) return { kind: "folder" };
  return { kind: item.mediaType === "video" ? "video" : "image", url: item.assetUrl };
}

export type MediaActions = {
  rename(m: MediaItemMeta): void;
  move(m: MediaItemMeta): void;
  replace(m: MediaItemMeta): void;
  /** Live folders only: choose a different folder on this computer. */
  chooseFolder(m: MediaItemMeta): void;
  delete(m: MediaItemMeta): void;
};

/** `offlineReason` disables every action (they all need the server). Live folders have no file to replace. */
export function mediaMenuItems(m: MediaItemMeta, actions: MediaActions, offlineReason?: string): MenuItem[] {
  const off = offlineReason ? { disabled: offlineReason } : {};
  const items: MenuItem[] = [
    { id: "rename", label: "Rename…", ...off, onSelect: () => actions.rename(m) },
    { id: "move", label: "Move to folder…", ...off, onSelect: () => actions.move(m) },
  ];
  if (m.kind === "file") items.push({ id: "replace", label: "Replace file…", ...off, onSelect: () => actions.replace(m) });
  if (m.kind === "live-folder") items.push({ id: "folder", label: "Change folder…", ...off, onSelect: () => actions.chooseFolder(m) });
  items.push({ separator: true }, { id: "delete", label: "Delete…", danger: true, ...off, onSelect: () => actions.delete(m) });
  return items;
}

/** Confirm copy when the item is used; null = delete straight away (Undo is in the toast). */
export function mediaDeleteConfirm(
  m: Pick<MediaItemMeta, "name" | "usedBy">,
): { title: string; message: string; confirmLabel: string; danger: true } | null {
  if (m.usedBy <= 0) return null;
  return {
    title: "Delete from Media?",
    message: `"${m.name}" is in use. Used by ${m.usedBy}. Those rows will show missing media until you restore it.`,
    confirmLabel: "Delete",
    danger: true,
  };
}

export function liveFolderCountText(n: number): string {
  return n === 1 ? "1 photo or video" : `${n} photos and videos`;
}

/** Plain-language text for a failed import; never shows raw status text. */
export function importErrorText(e: unknown): string {
  const text = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  const status = /\((\d{3})\)/.exec(text)?.[1];
  if (status === "413") return "That file is too large for this computer's upload limit.";
  if (/failed to fetch|networkerror|\bload failed/i.test(text)) return "Couldn't reach the show computer.";
  if (status || /^asset upload/i.test(text)) return "The upload didn't work. Try again.";
  return text.replace(/^Error:\s*/, "") || "Something went wrong.";
}
