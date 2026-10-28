"use client";

import { useEffect } from "react";
import { useStore } from "@/lib/store";
import { getClient } from "@/lib/useWs";
import { videoRowTakeMessage, onAirMediaFor } from "@/lib/mediaTake";
import { graphicRowMessage } from "@/lib/rowData";
import { songCueChannel, songTakeChannel } from "@/lib/songChannel";
import {
  escapeMessages,
  hasCommandModifier,
  hotcardIndexForKey,
  hotcardRoute,
  isIgnoredRepeat,
  shouldIgnoreGlobalKey,
  songKeyChannel,
  type TargetLike,
} from "@/lib/shortcutGuards";

/**
 * Global keyboard shortcuts for the show page.
 *
 * Always:
 *   F1..F12         take hotcard 1..12 (Shift: cue it on preview)
 *
 * When NO song session is live on program (graphic mode):
 *   ↑/↓             navigate rundown
 *   Enter           cue selected → preview
 *   Space           take selected → program
 *   Esc             clear program (graphics and video)
 *   ⌘/Ctrl+Enter   PVW → PGM swap
 *
 * When a song session IS live on program (song mode):
 *   Space           advance + 1 slide
 *   Shift+Space     advance − 1 slide
 *   C               jump to the next chorus
 *   B               jump to the next bridge
 *   T               jump to the next tag
 *   1..9            jump to verse 1..9
 *   0               jump to verse 10
 *   .               toggle blank
 *   Esc             end song
 *
 * Ignored: keys while typing in a text field, keys while a dialog is open or
 * already handled (a modal's Esc), ⌘/Ctrl/Alt chords other than ⌘Enter, and
 * auto-repeat (except ↑/↓).
 */
export function useGlobalShortcuts(): void {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const dialogOpen = !!document.querySelector('[role="dialog"], [aria-modal="true"], dialog[open]');
      if (shouldIgnoreGlobalKey(e, e.target as TargetLike, dialogOpen)) return;
      if (isIgnoredRepeat(e)) return;

      const store = useStore.getState();
      const client = getClient();
      const send = client.send.bind(client);

      const hotkeyIdx = hotcardIndexForKey(e);
      if (hotkeyIdx !== null) {
        const meta = store.hotcards[hotkeyIdx];
        if (!meta) return;
        e.preventDefault();
        const full = store.hotcardCache[meta.id];
        if (!full) {
          send({ type: "get_hotcard", hotcardId: meta.id });
          return;
        }
        const action = e.shiftKey ? "cue" : "take";
        send({ type: action, channel: hotcardRoute(full.channelHint, action), templateId: full.templateId, data: full.data });
        return;
      }

      const songChannel = songKeyChannel(store.songSessions);
      if (songChannel && handleSongHotkey(e, send, songChannel)) return;

      // ⌘/Ctrl+Enter is the only chord the show binds.
      if (e.code === "Enter" && (e.metaKey || e.ctrlKey) && !e.altKey) {
        e.preventDefault();
        send({ type: "take_pvw_to_pgm", fromChannel: "preview", toChannel: "program" });
        return;
      }
      if (hasCommandModifier(e)) return;

      const show = store.show;
      const selId = store.selectedRowId;
      const row = show?.rows.find((r) => r.id === selId);
      const hotcardId = store.selectedHotcardId;
      const hotcard = hotcardId ? store.hotcardCache[hotcardId] : null;
      const caches = { songCache: store.songCache, templateCache: store.templateCache };

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
      } else if (e.code === "Enter") {
        e.preventDefault();
        if (row && row.kind === "graphic") {
          send(graphicRowMessage(row, "cue", store.rowDataOverrides, show?.id));
        } else if (row && row.kind === "song" && show) {
          send({ type: "song_take", channel: songCueChannel(row, show, caches), showId: show.id, songRowId: row.id });
        } else if (hotcard) {
          send({ type: "cue", channel: hotcardRoute(hotcard.channelHint, "cue"), templateId: hotcard.templateId, data: hotcard.data });
        }
      } else if (e.code === "Space") {
        e.preventDefault();
        if (row && row.kind === "graphic") {
          send(graphicRowMessage(row, "take", store.rowDataOverrides, show?.id));
        } else if (row && row.kind === "song" && show) {
          send({ type: "song_take", channel: songTakeChannel(row, show, caches), showId: show.id, songRowId: row.id });
        } else if (row && row.kind === "video") {
          const onAir = onAirMediaFor(row, store.channelStates);
          if (onAir) {
            send({
              type: "media_control",
              channel: row.channelHint ?? "program",
              takenAt: onAir.takenAt,
              action: onAir.paused ? "play" : "pause",
            });
          } else {
            send(videoRowTakeMessage(row, show?.id));
          }
        } else if (hotcard) {
          send({ type: "take", channel: hotcardRoute(hotcard.channelHint, "take"), templateId: hotcard.templateId, data: hotcard.data });
        }
      } else if (e.code === "Escape") {
        e.preventDefault();
        for (const m of escapeMessages(store)) send(m);
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

type Sender = ReturnType<typeof getClient>["send"];

/**
 * Handle song-mode hotkeys. Returns true if the key was consumed (caller
 * should stop further graphic-mode handling). ⌘/Ctrl/Alt chords are never
 * song keys, so ⌘C copies instead of jumping to the chorus.
 */
function handleSongHotkey(e: KeyboardEvent, send: Sender, channel: "program"): boolean {
  if (hasCommandModifier(e)) return false;
  if (e.code === "Space") {
    e.preventDefault();
    send({ type: "song_advance", channel, delta: e.shiftKey ? -1 : 1 });
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
  const kind = k === "c" ? "chorus" : k === "b" ? "bridge" : k === "t" ? "tag" : null;
  if (kind) {
    e.preventDefault();
    send({ type: "song_jump_kind", channel, kind, ordinal: 1 });
    return true;
  }
  // Verse jumps: 1..9 → Verse 1..9, 0 → Verse 10. Ten verses covers any
  // realistic worship song (Amazing Grace's longest published version is 7).
  if (/^[0-9]$/.test(k)) {
    e.preventDefault();
    const ordinal = k === "0" ? 10 : Number(k);
    send({ type: "song_jump_kind", channel, kind: "verse", ordinal });
    return true;
  }

  return false;
}
