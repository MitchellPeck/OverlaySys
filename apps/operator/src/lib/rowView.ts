import type {
  ChannelState,
  Deck,
  ImageRow,
  MediaItem,
  Section,
  Show,
  ShowSong,
  Song,
  SongMeta,
  Template,
  TemplateMeta,
  VideoRow,
} from "@overlaysys/core";
import { resolveArrangement } from "@overlaysys/core";
import type { ItemKind } from "@overlaysys/ui";
import { formatClock } from "./mediaTake";
import { effectiveRowData, type RowDataOverrides } from "./rowData";
import type { RowLike } from "./rowLike";
import { slidesRowViewFor, type LiveFolderMap } from "./slidesRowView";

export type { RowLike } from "./rowLike";

export type RowViewCtx = {
  show: Show;
  songs: SongMeta[];
  songCache: Record<string, Song>;
  templates: TemplateMeta[];
  templateCache: Record<string, Template>;
  overrides: RowDataOverrides;
  deckCache: Record<string, Deck>;
  /** Decks the server answered "not found" for: shown as missing, not loading. */
  deckNotFound?: Record<string, true>;
  /** Media library, so a row picked from it shows the item's name. */
  mediaItems?: Pick<MediaItem, "id" | "name">[];
  /** Live-folder files (store liveFolderFiles): a live-folder deck's slides come from its folder. */
  liveFolderFiles?: LiveFolderMap;
  /** Live: an on-air live-folder row counts the server session's own list. */
  channelStates?: Record<string, ChannelState | undefined>;
};

/** A Media row's name: its label, else its library item's name, else the file name. */
export function mediaRowName(
  row: { label?: string; mediaItemId?: string; assetUrl: string },
  mediaItems: Pick<MediaItem, "id" | "name">[] = [],
): string {
  const label = row.label?.trim();
  if (label) return label;
  const item = row.mediaItemId ? mediaItems.find((m) => m.id === row.mediaItemId) : undefined;
  if (item?.name) return item.name;
  return row.assetUrl.split("/").pop() ?? row.assetUrl;
}

/** A video row or a photo row: both play in the media slot and read as "Media". */
export function isMediaRow(row: RowLike): row is VideoRow | ImageRow {
  return row.kind === "video" || row.kind === "media";
}

export type RowView = {
  kind: ItemKind;
  title: string;
  detail: string | null;
  chips: string[];
  moreChips: number;
  tag: string | null;
  lengthSec: number | null;
  supported: boolean;
  /** Warning for the rundown (for example slides skipped because they left the deck); null when fine. */
  warning?: string | null;
};

const MAX_CHIPS = 3;

const KIND_LETTER: Record<string, string> = {
  verse: "V",
  chorus: "C",
  bridge: "B",
  tag: "T",
  intro: "I",
  outro: "O",
  other: "X",
};

/** "V1", "C", "C2", "B", "T", "I", "O", "X". */
export function sectionShortLabel(section: Section, sections: Section[]): string {
  const letter = KIND_LETTER[section.kind] ?? "X";
  const sameKind = sections.filter((s) => s.kind === section.kind);
  const ordinal = Math.max(1, sameKind.findIndex((s) => s.id === section.id) + 1);
  if (section.kind === "verse") return `${letter}${ordinal}`;
  return ordinal >= 2 ? `${letter}${ordinal}` : letter;
}

const base = (row: RowLike, kind: ItemKind): RowView => ({
  kind,
  title: "",
  detail: null,
  chips: [],
  moreChips: 0,
  tag: null,
  lengthSec: typeof row.lengthSec === "number" ? row.lengthSec : null,
  supported: true,
});

function graphicView(row: Extract<RowLike, { kind: "graphic" }>, ctx: RowViewCtx): RowView {
  const data = effectiveRowData(row, ctx.overrides);
  const template = ctx.templateCache[row.templateId];
  const name = ctx.templates.find((t) => t.id === row.templateId)?.name ?? template?.name ?? row.templateId;
  const fieldTypes = new Map((template?.fields ?? []).map((f) => [f.key, f.type]));
  const keys = template ? template.fields.map((f) => f.key) : Object.keys(data);
  const values: string[] = [];
  for (const k of keys) {
    const t = fieldTypes.get(k);
    if (t === "image" || t === "color") continue;
    const v = data[k];
    if (typeof v !== "string") continue;
    const trimmed = v.trim();
    if (!trimmed || trimmed.startsWith("data:") || trimmed.startsWith("/assets/")) continue;
    values.push(trimmed);
  }
  return { ...base(row, "graphic"), title: values[0] ?? name, detail: values[1] ?? null, tag: name };
}

function songView(row: Extract<RowLike, { kind: "song" }>, ctx: RowViewCtx): RowView {
  const v = base(row, "song");
  const meta = ctx.songs.find((s) => s.id === row.songId);
  const song = ctx.songCache[row.songId];
  v.title = song?.title ?? meta?.title ?? "Song";
  if (!song) return { ...v, detail: "Default arrangement" };
  const showSong: ShowSong | undefined = ctx.show.songs.find((s) => s.songId === row.songId);
  const arrangement = resolveArrangement(row, showSong, song);
  const labels: string[] = [];
  for (const id of arrangement) {
    const section = song.sections.find((s) => s.id === id);
    if (section) labels.push(sectionShortLabel(section, song.sections));
  }
  return { ...v, chips: labels.slice(0, MAX_CHIPS), moreChips: Math.max(0, labels.length - MAX_CHIPS) };
}

function rowViewInner(row: RowLike, ctx: RowViewCtx): RowView {
  switch (row.kind) {
    case "graphic":
      return graphicView(row as Extract<RowLike, { kind: "graphic" }>, ctx);
    case "song":
      return songView(row as Extract<RowLike, { kind: "song" }>, ctx);
    case "scripture": {
      const r = row as Extract<RowLike, { kind: "scripture" }>;
      const detail = r.translationAbbreviation || (r.translation ? r.translation.toUpperCase() : null);
      return { ...base(row, "scripture"), title: r.reference, detail };
    }
    case "video": {
      const r = row as Extract<RowLike, { kind: "video" }>;
      return {
        ...base(row, "video"),
        title: mediaRowName(r, ctx.mediaItems) || "Video",
        detail: typeof r.durationSec === "number" ? formatClock(r.durationSec) : null,
      };
    }
    case "media": {
      // Photo rows share the video bar colour; they have no length.
      const r = row as Extract<RowLike, { kind: "media" }>;
      return { ...base(row, "video"), title: mediaRowName(r, ctx.mediaItems) || "Photo", lengthSec: null };
    }
    case "slides": {
      const deckId = (row as { deckId?: string }).deckId;
      const deck = !deckId ? null : ctx.deckNotFound?.[deckId] ? null : ctx.deckCache[deckId];
      const v = slidesRowViewFor(row, deck, ctx.liveFolderFiles, ctx.channelStates);
      if (!v) {
        return { ...base(row, "slides"), title: "Slides deck", detail: "Needs Slides decks", supported: false };
      }
      const warning = v.blockedReason
        ? v.blockedReason
        : v.missingSlides > 0
          ? `${v.missingSlides} slide${v.missingSlides === 1 ? "" : "s"} no longer in the deck`
          : null;
      return { ...base(row, "slides"), title: v.title, detail: v.detail, supported: !v.missingDeck, warning };
    }
    default:
      return { ...base(row, "graphic"), title: "Unsupported item", supported: false };
  }
}

/** The display model for one rundown row. Never throws; unknown kinds read as unsupported. */
export function rowView(row: RowLike, ctx: RowViewCtx): RowView {
  try {
    return rowViewInner(row, ctx);
  } catch {
    return { ...base(row, "graphic"), title: "Unsupported item", supported: false };
  }
}
