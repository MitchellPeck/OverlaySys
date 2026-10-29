"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { ChannelConfig, Show, Song, SongMeta, Template, TemplateMeta } from "@overlaysys/core";
import { Panel, colors, fontSize } from "@overlaysys/ui";
import { SermonNotesEditor } from "./SermonNotesEditor";
import { SongsInShowPanel } from "./SongsInShowPanel";

type Props = {
  draft: Show;
  onUpdate(recipe: (s: Show) => void): void;
  songs: SongMeta[];
  songCache: Record<string, Song>;
  templates: TemplateMeta[];
  templateCache: Record<string, Template>;
  channels: ChannelConfig[];
  /** Cloud shows can't store sermon notes yet. */
  cloud: boolean;
};

/** The right pane when no item is selected: sermon notes sets and show-wide song defaults. */
export function ShowDetailsPane({ draft, onUpdate, songs, songCache, templates, templateCache, channels, cloud }: Props) {
  const [songsOpen, setSongsOpen] = useState(false);
  const n = draft.songs.length;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <h2 style={{ margin: 0, fontSize: fontSize.base, fontWeight: 600 }}>Show details</h2>
      {cloud ? (
        <Panel title="Sermon notes">
          <p style={{ color: colors.textMuted, fontSize: 12, margin: 0 }}>
            Sermon notes are available in the desktop app.
          </p>
        </Panel>
      ) : (
        <SermonNotesEditor notes={draft.sermonNotes ?? []} onUpdate={onUpdate} />
      )}
      <Panel
        title={
          <button
            type="button"
            aria-expanded={songsOpen}
            onClick={() => setSongsOpen((v) => !v)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              background: "transparent",
              border: "none",
              padding: 0,
              minHeight: 24,
              color: colors.text,
              font: "inherit",
              cursor: "pointer",
            }}
          >
            {songsOpen ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
            Song defaults for this show
            {n > 0 && <span style={{ color: colors.textMuted, fontWeight: 400 }}>({n})</span>}
          </button>
        }
      >
        {songsOpen ? (
          <SongsInShowPanel
            draft={draft}
            songs={songs}
            songCache={songCache}
            templates={templates}
            templateCache={templateCache}
            channels={channels}
            onUpdate={onUpdate}
          />
        ) : (
          <p style={{ color: colors.textMuted, fontSize: 12, margin: 0 }}>
            Templates and output used by every item of a song in this show.
          </p>
        )}
      </Panel>
    </div>
  );
}
