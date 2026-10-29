"use client";

import { useEffect } from "react";
import { toast } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { getClient } from "@/lib/useWs";
import { onAirMediaFor } from "@/lib/mediaTake";
import { pvwTakeMessages } from "@/lib/onAir";
import { rowFireMessages, sectionKeyAction, sectionKeyFor } from "@/lib/liveKeys";
import {
  advanceMessage,
  blankMessage,
  escapeMessages,
  hasCommandModifier,
  keyMode,
  hotcardForEvent,
  hotcardFireMessage,
  hotkeyForEvent,
  isIgnoredRepeat,
  shouldIgnoreGlobalKey,
  songEscapeMessages,
  songKeyChannel,
  type TargetLike,
} from "@/lib/shortcutGuards";

/**
 * Global keyboard shortcuts for the Live page.
 *
 * Always:
 *   F1..F12         take the current project's hotcard assigned that key
 *                   (Shift: cue it on preview)
 *   ↑/↓             select the previous / next rundown row
 *   Enter           cue the selection → preview (scripture: slide 1; video: nothing)
 *   ⌘/Ctrl+Enter   take preview to program (pvwTakeMessages)
 *
 * Keys mode (keyMode, D2): a program song, else scripture, else slides
 * session drives Space; with none, the rundown does (the Keys badge says which).
 *   Space           song / scripture / slides: advance + 1 · rundown: take the
 *                   selection (video: play / pause when on air)
 *   Shift+Space     song / scripture / slides: advance − 1
 *   B               slides: blank (in song mode B is the bridge)
 *   Esc             clear program (graphics and video)
 *
 * When a song session IS live on program (song mode):
 *   C / B / T       jump to the chorus / bridge / tag
 *   1..9, 0         jump to verse 1..9, 10
 *                   (a section the song doesn't have toasts and sends nothing)
 *   .               toggle blank
 *   Esc             end song (and clear program video)
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

      if (hotkeyForEvent(e)) {
        // An F-key with no card in this project falls through to the browser.
        const meta = hotcardForEvent(e, store.hotcards, store.currentProjectId);
        if (!meta) return;
        e.preventDefault();
        const full = store.hotcardCache[meta.id];
        if (!full) {
          send({ type: "get_hotcard", hotcardId: meta.id });
          return;
        }
        const action = e.shiftKey ? "cue" : "take";
        send(hotcardFireMessage(full, action));
        return;
      }

      // What Space / Shift+Space and B drive: a program song, scripture or
      // slides session, else the rundown (D2; shown as the Keys badge).
      const mode = keyMode(store);
      if (mode !== "rundown" && e.code === "Space" && !hasCommandModifier(e)) {
        e.preventDefault();
        const m = advanceMessage(mode, e.shiftKey ? -1 : 1);
        if (m) send(m);
        return;
      }
      if (mode === "slides" && e.key.toLowerCase() === "b" && !hasCommandModifier(e)) {
        e.preventDefault();
        const m = blankMessage("slides");
        if (m) send(m);
        return;
      }

      const songChannel = songKeyChannel(store.songSessions);
      if (songChannel && handleSongHotkey(e, send, songChannel)) return;

      const show = store.show;

      // ⌘/Ctrl+Enter is the only chord the show binds.
      if (e.code === "Enter" && (e.metaKey || e.ctrlKey) && !e.altKey) {
        e.preventDefault();
        for (const m of pvwTakeMessages(store.channelStates.preview, show?.id ?? null)) send(m);
        return;
      }
      if (hasCommandModifier(e)) return;

      const selId = store.selectedRowId;
      const row = show?.rows.find((r) => r.id === selId);
      const hotcardId = store.selectedHotcardId;
      const hotcard = hotcardId ? store.hotcardCache[hotcardId] : null;
      const fireCtx = show
        ? {
            show,
            overrides: store.rowDataOverrides,
            caches: { songCache: store.songCache, templateCache: store.templateCache },
            channelStates: store.channelStates,
          }
        : null;

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
        // Cue the selection: always preview, never program (D7a).
        e.preventDefault();
        if (row && fireCtx) {
          for (const m of rowFireMessages(row, "cue", fireCtx)) send(m);
        } else if (hotcard) {
          send(hotcardFireMessage(hotcard, "cue"));
        }
      } else if (e.code === "Space") {
        e.preventDefault();
        if (row && row.kind === "video") {
          const onAir = onAirMediaFor(row, store.channelStates);
          if (onAir) {
            send({
              type: "media_control",
              channel: row.channelHint ?? "program",
              takenAt: onAir.takenAt,
              action: onAir.paused ? "play" : "pause",
            });
            return;
          }
        }
        if (row && fireCtx) {
          for (const m of rowFireMessages(row, "take", fireCtx)) send(m);
        } else if (hotcard) {
          send(hotcardFireMessage(hotcard, "take"));
        }
      } else if (e.code === "Escape") {
        e.preventDefault();
        for (const m of escapeMessages()) send(m);
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

type Sender = ReturnType<typeof getClient>["send"];

/**
 * Handle song-mode hotkeys. Returns true if the key was consumed (caller
 * should stop further rundown handling). ⌘/Ctrl/Alt chords are never song
 * keys, so ⌘C copies instead of jumping to the chorus.
 */
function handleSongHotkey(e: KeyboardEvent, send: Sender, channel: "program"): boolean {
  if (hasCommandModifier(e)) return false;
  // Space / Shift+Space are handled by keyMode before this.
  if (e.code === "Escape") {
    e.preventDefault();
    // Panic key: end the song and clear any program video with it.
    for (const m of songEscapeMessages()) send(m);
    return true;
  }
  if (e.key === "." || e.code === "Period") {
    e.preventDefault();
    const m = blankMessage("song");
    if (m) send(m);
    return true;
  }
  // Section jumps (e.key, so Shift+C still works). A section the song
  // doesn't have toasts and sends nothing.
  const target = sectionKeyFor(e.key);
  if (target) {
    e.preventDefault();
    const st = useStore.getState();
    const session = st.songSessions[channel];
    const song = session ? st.songCache[session.songId] : undefined;
    const r = sectionKeyAction(target, song, session?.arrangement ?? []);
    if ("toast" in r) toast({ message: r.toast, tone: "warn" });
    else send(r.send);
    return true;
  }
  return false;
}
