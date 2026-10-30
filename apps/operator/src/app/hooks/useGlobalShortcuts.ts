"use client";

import { useEffect } from "react";
import { dismissToast, toast } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { getClient } from "@/lib/useWs";
import { onAirMediaFor } from "@/lib/mediaTake";
import { fetchHotcardForFire } from "@/lib/hotcardFetchFire";
import { pvwTakeMessages } from "@/lib/onAir";
import {
  escArmText,
  escDecision,
  escTarget,
  rowFireMessages,
  sectionKeyAction,
  sectionKeyFor,
  spaceAction,
  type EscArm,
} from "@/lib/liveKeys";
import { createKeyboardFocusTracker } from "@/lib/keyboardFocus";
import { rowView } from "@/lib/rowView";
import { slidesRowViewFor } from "@/lib/slidesRowView";
import { rowCanFire } from "../components/rundown/rundownModel";
import {
  advanceMessage,
  blankMessage,
  escapeMessages,
  hasCommandModifier,
  keyMode,
  hotcardForEvent,
  hotcardFireMessage,
  hotkeyForEvent,
  isActivatableTarget,
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
 *   Esc Esc         clear program (graphics and video); the first Esc only
 *                   arms and toasts what the second does (D3)
 *
 * When a song session IS live on program (song mode):
 *   C / B / T       jump to the chorus / bridge / tag
 *   1..9, 0         jump to verse 1..9, 10
 *                   (a section the song doesn't have toasts and sends nothing)
 *   .               toggle blank
 *   Esc Esc         end song (and clear program video)
 *
 * Ignored: keys while typing in a text field, keys while a dialog is open or
 * already handled (a modal's Esc), ⌘/Ctrl/Alt chords other than ⌘Enter, and
 * auto-repeat (except ↑/↓).
 */
export function useGlobalShortcuts(): void {
  useEffect(() => {
    // Esc Esc: the arming press (when, and what it promised), and its toast.
    let escArmed: EscArm = null;
    let armToast: string | null = null;
    // Which element Tab focused: only that one keeps Enter/Space for itself.
    const focusTracker = createKeyboardFocusTracker();
    const onTrackKey = (e: KeyboardEvent) => focusTracker.onKeyDown(e);
    const onTrackKeyUp = (e: KeyboardEvent) => focusTracker.onKeyUp(e);
    const onFocusIn = (e: FocusEvent) => focusTracker.onFocusIn(e.target);
    const onPointerDown = () => focusTracker.onPointerDown();
    function onKey(e: KeyboardEvent) {
      const dialogOpen = !!document.querySelector('[role="dialog"], [aria-modal="true"], dialog[open]');
      if (shouldIgnoreGlobalKey(e, e.target as TargetLike, dialogOpen)) return;
      if (isIgnoredRepeat(e)) return;
      // A focused button/link/checkbox/etc. takes plain Enter and Space itself.
      const keyboardFocused = focusTracker.isKeyboardFocused(e.target) || focusTracker.isKeyboardFocused(document.activeElement);
      if ((e.code === "Enter" || e.code === "Space") && !hasCommandModifier(e) && isActivatableTarget(e.target as TargetLike, keyboardFocused)) return;

      const store = useStore.getState();
      const client = getClient();
      const send = client.send.bind(client);

      if (hotkeyForEvent(e)) {
        // An F-key with no card in this project falls through to the browser.
        const meta = hotcardForEvent(e, store.hotcards, store.currentProjectId);
        if (!meta) return;
        e.preventDefault();
        const action = e.shiftKey ? "cue" : "take";
        const full = store.hotcardCache[meta.id];
        if (!full) {
          // Fire once it arrives, unless anything else went to air first.
          void fetchHotcardForFire(client, meta.id).then((h) => {
            if (h) send(hotcardFireMessage(h, action));
          });
          return;
        }
        send(hotcardFireMessage(full, action));
        return;
      }

      // What Space / Shift+Space and B drive: a program song, scripture or
      // slides session, else the rundown (D2; shown as the Keys badge).
      const mode = keyMode(store);
      const selRow = store.show?.rows.find((r) => r.id === store.selectedRowId);
      const selVideoOnAir = selRow?.kind === "video" && !!onAirMediaFor(selRow, store.channelStates);
      if (e.code === "Space" && !hasCommandModifier(e) && spaceAction(mode, selVideoOnAir) === "advance") {
        e.preventDefault();
        const m = advanceMessage(mode, e.shiftKey ? -1 : 1, store.channelStates);
        if (m) send(m);
        return;
      }
      if (mode === "slides" && e.key.toLowerCase() === "b" && !hasCommandModifier(e)) {
        e.preventDefault();
        const m = blankMessage("slides", store.channelStates);
        if (m) send(m);
        return;
      }

      // Esc is a panic key with a safety catch (D3): the first press only
      // arms and says what the second will do; a second press within 600 ms
      // does exactly that (end the program song, or clear program), and only
      // if it is still what program needs. Empty program: nothing, no toast.
      if (e.code === "Escape" && !hasCommandModifier(e)) {
        e.preventDefault();
        const target = escTarget(store.channelStates, songKeyChannel(store.songSessions) !== null);
        const d = escDecision(Date.now(), escArmed, target);
        if (armToast) dismissToast(armToast);
        armToast = null;
        if ("disarm" in d) {
          escArmed = null;
        } else if ("arm" in d) {
          escArmed = { at: Date.now(), mode: d.arm };
          armToast = toast({ message: escArmText(d.arm === "song" ? "song" : "other"), tone: "warn", durationMs: 1500 });
        } else {
          escArmed = null;
          for (const m of d.act === "song" ? songEscapeMessages() : escapeMessages()) send(m);
        }
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
      // Keys fire only where the rundown shows the button (rowCanFire).
      const canFire = (action: "cue" | "take"): boolean => {
        if (!row || !show) return false;
        const view = rowView(row, {
          show,
          songs: store.songs,
          songCache: store.songCache,
          templates: store.templates,
          templateCache: store.templateCache,
          overrides: store.rowDataOverrides,
          deckCache: store.deckCache,
          deckNotFound: store.deckNotFound,
        });
        const deckId = row.kind === "slides" ? row.deckId : undefined;
        const slidesView =
          row.kind === "slides"
            ? slidesRowViewFor(row, deckId ? (store.deckNotFound[deckId] ? null : store.deckCache[deckId]) : null)
            : null;
        return rowCanFire(row, action, { supported: view.supported, slidesView });
      };

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
          if (canFire("cue")) for (const m of rowFireMessages(row, "cue", fireCtx)) send(m);
        } else if (hotcard) {
          send(hotcardFireMessage(hotcard, "cue"));
        }
      } else if (e.code === "Space") {
        e.preventDefault();
        // Only videos have transport; a photo falls through to Take (a no-op while it is up).
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
          if (canFire("take")) for (const m of rowFireMessages(row, "take", fireCtx)) send(m);
        } else if (hotcard) {
          send(hotcardFireMessage(hotcard, "take"));
        }
      }
    }

    window.addEventListener("keydown", onTrackKey, true);
    window.addEventListener("keyup", onTrackKeyUp, true);
    window.addEventListener("focusin", onFocusIn, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onTrackKey, true);
      window.removeEventListener("keyup", onTrackKeyUp, true);
      window.removeEventListener("focusin", onFocusIn, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKey);
    };
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
  // Space / Shift+Space and Esc are handled before this.
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
