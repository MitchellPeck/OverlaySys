"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Music, X } from "lucide-react";
import {
  type ChannelConfig,
  type Show,
  type ShowSong,
  type Song,
  type SongMeta,
  type Template,
  type TemplateMeta,
} from "@overlaysys/core";
import { Button, IconButton, Pill, Select, StatusDot, colors } from "@overlaysys/ui";
import { SongOverrideEditor } from "./SongOverrideEditor";

interface SongsInShowPanelProps {
  draft: Show;
  songs: SongMeta[];
  songCache: Record<string, Song>;
  templates: TemplateMeta[];
  templateCache: Record<string, Template>;
  channels: ChannelConfig[];
  onUpdate: (recipe: (s: Show) => void) => void;
}

/**
 * Panel listing each ShowSong in the draft show. Each entry can be expanded
 * inline to override the channel, lyric/intro/outro templates + field maps,
 * and per-song customField values via {@link SongOverrideEditor}.
 *
 * Add-song picker only lists library songs not already in `draft.songs`.
 * Delete is blocked when the row is referenced by any SongRow in the rundown.
 */
export function SongsInShowPanel({
  draft,
  songs,
  songCache,
  templates,
  templateCache,
  channels,
  onUpdate,
}: SongsInShowPanelProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [warning, setWarning] = useState<Record<string, string>>({});
  const [pickerValue, setPickerValue] = useState<string>("");

  function toggleExpanded(songId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(songId)) next.delete(songId);
      else next.add(songId);
      return next;
    });
  }

  // Songs not yet added to this show — surfaced by the picker.
  const availableSongs = useMemo(() => {
    const used = new Set(draft.songs.map((s) => s.songId));
    return songs.filter((s) => !used.has(s.id));
  }, [draft.songs, songs]);

  function addSong(songId: string) {
    if (!songId) return;
    onUpdate((s) => {
      if (s.songs.some((e) => e.songId === songId)) return;
      s.songs.push({ songId });
    });
    setPickerValue("");
    // Auto-expand new entries so the operator immediately sees the override
    // controls. They can collapse with the disclosure header.
    setExpanded((prev) => {
      const next = new Set(prev);
      next.add(songId);
      return next;
    });
  }

  function removeSong(songId: string) {
    const refCount = draft.rows.filter(
      (r) => r.kind === "song" && r.songId === songId,
    ).length;
    if (refCount > 0) {
      setWarning((prev) => ({
        ...prev,
        [songId]: `Used by ${refCount} item${refCount === 1 ? "" : "s"} in the rundown. Remove those first.`,
      }));
      return;
    }
    setWarning((prev) => {
      const next = { ...prev };
      delete next[songId];
      return next;
    });
    setExpanded((prev) => {
      const next = new Set(prev);
      next.delete(songId);
      return next;
    });
    onUpdate((s) => {
      s.songs = s.songs.filter((e) => e.songId !== songId);
    });
  }

  function patchEntry(songId: string, patch: Partial<ShowSong>) {
    onUpdate((s) => {
      const e = s.songs.find((x) => x.songId === songId);
      if (!e) return;
      // Apply each entry — explicit `undefined` clears the key rather than
      // persisting as undefined-in-object (the schema treats these as
      // `.optional()`, and we want absent-vs-empty to be canonical).
      for (const [key, value] of Object.entries(patch) as Array<
        [keyof ShowSong, ShowSong[keyof ShowSong]]
      >) {
        if (value === undefined) {
          delete (e as Record<string, unknown>)[key as string];
        } else {
          (e as Record<string, unknown>)[key as string] = value;
        }
      }
    });
  }

  return (
    <div>
      <p style={{ fontSize: 12, color: colors.textMuted, margin: "0 0 8px" }}>
        {draft.songs.length === 0
          ? "No show-wide song defaults yet. Songs added to the rundown appear here."
          : "Defaults apply to every item of that song in this show; an item's own settings win."}
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {draft.songs.map((entry) => {
          const song = songCache[entry.songId];
          const songMeta = songs.find((s) => s.id === entry.songId);
          const title = song?.title ?? songMeta?.title ?? entry.songId;
          const isExpanded = expanded.has(entry.songId);
          const warn = warning[entry.songId];
          const customOverrideCount = entry.customFieldOverrides
            ? Object.keys(entry.customFieldOverrides).length
            : 0;
          return (
            <div
              key={entry.songId}
              style={{
                border: `1px solid ${colors.border}`,
                borderRadius: 4,
                background: colors.surface2,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 10px",
                }}
              >
                <IconButton
                  onClick={() => toggleExpanded(entry.songId)}
                  aria-label={`${isExpanded ? "Collapse" : "Expand"} ${title}`}
                  aria-expanded={isExpanded}
                >
                  {isExpanded ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
                </IconButton>
                <span style={{ fontWeight: 600, fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                  <Music size={14} aria-hidden style={{ flexShrink: 0 }} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
                </span>
                <div style={{ display: "flex", gap: 4, marginLeft: 8, flexWrap: "wrap" }}>
                  <OverrideChip label="Intro" overridden={entry.introTemplateId !== undefined} />
                  <OverrideChip label="Lyrics" overridden={entry.lyricTemplateId !== undefined} />
                  <OverrideChip label="Outro" overridden={entry.outroTemplateId !== undefined} />
                  <OverrideChip label="Channel" overridden={entry.channelOverride !== undefined} />
                  {customOverrideCount > 0 && (
                    <Pill tone="accent">
                      Custom fields ({customOverrideCount})
                    </Pill>
                  )}
                </div>
                <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                  <Button onClick={() => toggleExpanded(entry.songId)} size="sm">
                    {isExpanded ? "Hide" : "Configure"}
                  </Button>
                  <IconButton
                    onClick={() => removeSong(entry.songId)}
                    title="Remove from show defaults"
                    aria-label={`Remove ${title} from show defaults`}
                    tone="danger"
                  >
                    <X size={14} aria-hidden />
                  </IconButton>
                </div>
              </div>
              {warn && (
                <div
                  style={{
                    padding: "4px 10px 8px",
                    color: colors.errorText,
                    fontSize: 11,
                  }}
                >
                  {warn}
                </div>
              )}
              {isExpanded && song && (
                <SongOverrideEditor
                  entry={entry}
                  song={song}
                  templates={templates}
                  templateCache={templateCache}
                  channels={channels}
                  onChange={(patch) => patchEntry(entry.songId, patch)}
                />
              )}
              {isExpanded && !song && (
                <div
                  style={{
                    padding: "8px 12px",
                    fontSize: 11,
                    color: colors.textDim,
                    fontStyle: "italic",
                  }}
                >
                  Loading song payload…
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          marginTop: 12,
          paddingTop: 12,
          borderTop: `1px solid ${colors.border}`,
        }}
      >
        <Select
          value={pickerValue}
          onChange={(e) => setPickerValue(e.target.value)}
          style={{ flex: 1, maxWidth: 360 }}
          aria-label="Set show-wide defaults for a song"
          disabled={availableSongs.length === 0}
        >
          <option value="">
            {availableSongs.length === 0
              ? "Every song already has show-wide defaults"
              : "Set show-wide defaults for a song…"}
          </option>
          {availableSongs.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </Select>
        <Button
          onClick={() => addSong(pickerValue)}
          size="sm"
          disabled={!pickerValue}
        >
          Add
        </Button>
      </div>
    </div>
  );
}

function OverrideChip({
  label,
  overridden,
}: {
  label: string;
  overridden: boolean;
}) {
  return (
    <StatusDot
      tone={overridden ? "good" : "dim"}
      label={`${label}: ${overridden ? "override" : "default"}`}
    />
  );
}
