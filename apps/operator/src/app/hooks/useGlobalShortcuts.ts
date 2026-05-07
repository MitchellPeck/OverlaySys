"use client";

import { useEffect } from "react";
import type { SongSessionSummary } from "@overlaysys/core";
import { useStore } from "@/lib/store";
import { getClient } from "@/lib/useWs";

/**
 * Global keyboard shortcuts for the show page.
 *
 * When NO song session is active on program (graphic mode):
 *   ↑/↓             navigate rundown
 *   Enter           cue selected → preview
 *   Space           take selected → program
 *   Esc             clear program
 *   ⌘/Ctrl+Enter   PVW → PGM swap
 *
 * When a song session IS active on program (song mode):
 *   Space           advance + 1 slide
 *   Shift+Space     advance − 1 slide
 *   C               jump to first chorus section
 *   B               jump to first bridge section
 *   T               jump to first tag section
 *   1 / 2 / 3       jump to verse 1 / 2 / 3
 *   .               toggle blank
 *   Esc             end song
 *
 * Inputs and textareas always swallow keys regardless of mode.
 */
export function useGlobalShortcuts(): void {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (target?.isContentEditable) return;

      const store = useStore.getState();
      const client = getClient();
      const session = store.songSessions["program"] as SongSessionSummary | null | undefined;

      // Song mode takes priority over graphic mode for the keys it owns.
      if (session) {
        if (handleSongHotkey(e, client.send.bind(client))) return;
      }

      const show = store.show;
      const selId = store.selectedRowId;
      const row = show?.rows.find((r) => r.id === selId);

      if (e.code === "ArrowDown") {
        e.preventDefault();
        if (!show) return;
        const idx = show.rows.findIndex((r) => r.id === selId);
        const next = show.rows[Math.min(idx + 1, show.rows.length - 1)];
        if (next) store.setSelectedRow(next.id);
      } else if (e.code === "ArrowUp") {
        e.preventDefault();
        if (!show) return;
        const idx = show.rows.findIndex((r) => r.id === selId);
        const prev = show.rows[Math.max(idx - 1, 0)];
        if (prev) store.setSelectedRow(prev.id);
      } else if (e.code === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        client.send({
          type: "take_pvw_to_pgm",
          fromChannel: "preview",
          toChannel: "program",
        });
      } else if (e.code === "Enter") {
        e.preventDefault();
        if (row && row.kind === "graphic") {
          client.send({
            type: "cue",
            channel: "preview",
            templateId: row.templateId,
            data: row.data,
          });
        } else if (row && row.kind === "song" && show) {
          client.send({
            type: "song_take",
            channel: "program",
            showId: show.id,
            songRowId: row.id,
          });
        }
      } else if (e.code === "Space") {
        e.preventDefault();
        if (row && row.kind === "graphic") {
          client.send({
            type: "take",
            channel: "program",
            templateId: row.templateId,
            data: row.data,
          });
        } else if (row && row.kind === "song" && show) {
          client.send({
            type: "song_take",
            channel: "program",
            showId: show.id,
            songRowId: row.id,
          });
        }
      } else if (e.code === "Escape") {
        e.preventDefault();
        client.send({ type: "clear", channel: "program" });
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

type Sender = ReturnType<typeof getClient>["send"];

/**
 * Handle song-mode hotkeys. Returns true if the key was consumed (caller
 * should stop further graphic-mode handling).
 */
function handleSongHotkey(e: KeyboardEvent, send: Sender): boolean {
  const channel = "program";

  if (e.code === "Space" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
    e.preventDefault();
    send({ type: "song_advance", channel, delta: 1 });
    return true;
  }
  if (e.code === "Space" && e.shiftKey) {
    e.preventDefault();
    send({ type: "song_advance", channel, delta: -1 });
    return true;
  }
  if (e.code === "Escape") {
    e.preventDefault();
    send({ type: "song_end", channel });
    return true;
  }
  if (e.key === "." || e.code === "Period") {
    e.preventDefault();
    send({ type: "song_blank", channel });
    return true;
  }
  // Section jumps. Use e.key (case-insensitive lower) so Shift+C still works.
  const k = e.key.toLowerCase();
  if (k === "c") {
    e.preventDefault();
    send({ type: "song_jump_kind", channel, kind: "chorus", ordinal: 1 });
    return true;
  }
  if (k === "b") {
    e.preventDefault();
    send({ type: "song_jump_kind", channel, kind: "bridge", ordinal: 1 });
    return true;
  }
  if (k === "t") {
    e.preventDefault();
    send({ type: "song_jump_kind", channel, kind: "tag", ordinal: 1 });
    return true;
  }
  if (k === "1" || k === "2" || k === "3") {
    e.preventDefault();
    send({
      type: "song_jump_kind",
      channel,
      kind: "verse",
      ordinal: Number(k),
    });
    return true;
  }

  return false;
}
