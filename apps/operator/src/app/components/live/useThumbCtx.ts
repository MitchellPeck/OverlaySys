"use client";

import { useMemo } from "react";
import { useStore } from "@/lib/store";
import type { ThumbCtx } from "@/lib/thumbClick";

/** Everything rowView / thumbsFor / thumbActivate read, from the store. Null with no show loaded. */
export function useThumbCtx(): ThumbCtx | null {
  const show = useStore((s) => s.show);
  const songs = useStore((s) => s.songs);
  const songCache = useStore((s) => s.songCache);
  const templates = useStore((s) => s.templates);
  const templateCache = useStore((s) => s.templateCache);
  const overrides = useStore((s) => s.rowDataOverrides);
  const deckCache = useStore((s) => s.deckCache);
  const channelStates = useStore((s) => s.channelStates);
  const songSessions = useStore((s) => s.songSessions);
  return useMemo(
    () =>
      show
        ? { show, songs, songCache, templates, templateCache, overrides, deckCache, channelStates, songSessions }
        : null,
    [show, songs, songCache, templates, templateCache, overrides, deckCache, channelStates, songSessions],
  );
}
