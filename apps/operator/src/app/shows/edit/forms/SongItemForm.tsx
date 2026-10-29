"use client";

import { useMemo, useState } from "react";
import type { Song, SongRow } from "@overlaysys/core";
import { resolveArrangement } from "@overlaysys/core";
import { Plus, RotateCcw, X } from "lucide-react";
import { Button, colors, fontSize, useContextMenu } from "@overlaysys/ui";
import { sectionShortLabel } from "@/lib/rowView";
import { useStore } from "@/lib/store";
import { useResolvedChannelConfigs } from "@/lib/useResolvedChannels";
import { SongPickerDialog } from "../SongPickerDialog";
import { SongRowIntroOutro } from "../SongOverrideEditor";
import { TemplateSelect } from "../TemplateSelect";
import type { ItemFormProps } from "./types";
import { FormRow, ItemCommonFields, ItemFormFrame } from "./ItemCommonFields";
import {
  arrangementAppend,
  arrangementMove,
  arrangementRemove,
  patchRow,
  recentSongIds,
  recentTemplateIds,
} from "./itemFormModel";

/**
 * Song item. Changing the song only swaps `songId` (plus the lyric template
 * cascade and dropping the old song's intro/outro overrides); the page keeps
 * the show-wide song defaults in step.
 */
export function SongItemForm({ row, show, onChange }: ItemFormProps<SongRow>) {
  const songs = useStore((s) => s.songs);
  const song = useStore((s) => s.songCache[row.songId]) as Song | undefined;
  const songCache = useStore((s) => s.songCache);
  const templates = useStore((s) => s.templates);
  const channels = useResolvedChannelConfigs();
  const [pickerOpen, setPickerOpen] = useState(false);
  const showSong = show.songs.find((e) => e.songId === row.songId);
  const title = song?.title ?? songs.find((s) => s.id === row.songId)?.title ?? "Missing song";
  const patch = (p: Record<string, unknown>) => onChange(patchRow(row, p));
  const recentLyric = useMemo(() => recentTemplateIds(show, "lyric"), [show]);
  const recentSongs = useMemo(() => recentSongIds(show), [show]);

  function changeSong(songId: string) {
    setPickerOpen(false);
    if (songId === row.songId) return;
    const lyricTemplateId =
      show.songs.find((e) => e.songId === songId)?.lyricTemplateId ??
      songCache[songId]?.defaultLyricTemplateId ??
      row.lyricTemplateId;
    // Intro/outro overrides and the arrangement belong to the old song.
    onChange(
      patchRow(row, {
        songId,
        lyricTemplateId,
        arrangement: undefined,
        introTemplateId: undefined,
        introFieldMap: undefined,
        introFieldLiterals: undefined,
        outroTemplateId: undefined,
        outroFieldMap: undefined,
        outroFieldLiterals: undefined,
        skipIntro: undefined,
        skipOutro: undefined,
      }),
    );
  }

  const inheritedChannel = showSong?.channelOverride ?? song?.defaultChannel;
  const inheritedName = inheritedChannel ? channels.find((c) => c.id === inheritedChannel)?.name ?? inheritedChannel : null;
  const inheritedLyric = showSong?.lyricTemplateId ?? song?.defaultLyricTemplateId;

  return (
    <ItemFormFrame row={row} show={show} name={title}>
      <FormRow label="Song">
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: fontSize.md, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
          <Button size="sm" onClick={() => setPickerOpen(true)}>
            Change song…
          </Button>
        </div>
      </FormRow>
      <FormRow label="Lyric template">
        <TemplateSelect
          label="Lyric template"
          use="lyric"
          value={row.lyricTemplateId}
          recentIds={recentLyric}
          onChange={(id) => patch({ lyricTemplateId: id })}
        />
        {inheritedLyric && row.lyricTemplateId !== inheritedLyric && (
          <div style={{ fontSize: fontSize.xs, color: colors.textMuted, marginTop: 4 }}>
            Show default: {templates.find((t) => t.id === inheritedLyric)?.name ?? "Missing template"}
          </div>
        )}
      </FormRow>
      <FormRow label="Arrangement">
        {song ? (
          <ArrangementEditor
            song={song}
            value={row.arrangement}
            resolved={resolveArrangement(row, showSong, song)}
            onChange={(arrangement) => patch({ arrangement })}
          />
        ) : (
          <span style={{ fontSize: fontSize.sm, color: colors.textMuted }}>Loading song…</span>
        )}
      </FormRow>
      <FormRow label="Intro / outro">
        <SongRowIntroOutro row={row} showSong={showSong} song={song} templates={templates} onPatch={patch} />
      </FormRow>
      <ItemCommonFields
        row={row}
        onChange={(p) => patch(p)}
        showSermonNotes={false}
        sets={[]}
        outputHint={inheritedName ? `Unset: ${inheritedName} (song default)` : null}
      />
      <SongPickerDialog
        open={pickerOpen}
        single
        recentIds={recentSongs}
        onClose={() => setPickerOpen(false)}
        onAdd={(ids) => ids[0] && changeSong(ids[0])}
      />
    </ItemFormFrame>
  );
}

/**
 * "Arrangement for this item": chips with short section labels. Drag to
 * reorder, × to remove, "+ section" to append, "Reset to song default" to
 * drop the item's own order. The first edit copies the inherited order.
 */
function ArrangementEditor({
  song,
  value,
  resolved,
  onChange,
}: {
  song: Song;
  value: string[] | undefined;
  resolved: string[];
  onChange(next: string[] | undefined): void;
}) {
  const menu = useContextMenu();
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const seq = value ?? resolved;
  const label = (id: string) => {
    const s = song.sections.find((x) => x.id === id);
    return s ? sectionShortLabel(s, song.sections) : "?";
  };
  const name = (id: string) => song.sections.find((x) => x.id === id)?.label ?? "Removed section";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: fontSize.xs, color: colors.textMuted }}>
        Arrangement for this item{value === undefined ? " (show / song default)" : ""}
      </div>
      <div role="list" aria-label="Arrangement for this item" style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        {seq.map((id, i) => (
          <span
            key={`${id}-${i}`}
            role="listitem"
            draggable
            title={`${name(id)}. Drag to reorder.`}
            onDragStart={(e) => {
              setDragFrom(i);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(e) => {
              if (dragFrom === null) return;
              e.preventDefault();
              setDropAt(i);
            }}
            onDragEnd={() => {
              setDragFrom(null);
              setDropAt(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragFrom !== null) onChange(arrangementMove(seq, dragFrom, i));
              setDragFrom(null);
              setDropAt(null);
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 2,
              height: 24,
              padding: "0 2px 0 8px",
              borderRadius: 4,
              border: `1px solid ${dropAt === i && dragFrom !== i ? colors.accent : colors.border}`,
              background: colors.surface2,
              fontSize: fontSize.sm,
              fontWeight: 600,
              cursor: "grab",
              opacity: dragFrom === i ? 0.5 : 1,
            }}
          >
            {label(id)}
            <button
              type="button"
              aria-label={`Remove ${name(id)} (position ${i + 1})`}
              onClick={() => onChange(arrangementRemove(seq, i))}
              style={{
                display: "inline-flex",
                background: "transparent",
                border: "none",
                color: colors.textDim,
                cursor: "pointer",
                padding: 2,
              }}
            >
              <X size={12} aria-hidden />
            </button>
          </span>
        ))}
        <Button
          size="sm"
          variant="ghost"
          icon={<Plus size={14} />}
          aria-haspopup="menu"
          onClick={(e) =>
            menu.open(
              e,
              song.sections.map((s) => ({
                id: s.id,
                label: `${sectionShortLabel(s, song.sections)} · ${s.label}`,
                onSelect: () => onChange(arrangementAppend(seq, s.id)),
              })),
            )
          }
          disabled={song.sections.length === 0}
        >
          section
        </Button>
      </div>
      <div>
        <Button size="sm" variant="ghost" icon={<RotateCcw size={14} />} disabled={value === undefined} onClick={() => onChange(undefined)}>
          Reset to song default
        </Button>
      </div>
      {menu.menu}
    </div>
  );
}
