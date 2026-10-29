"use client";

import { useEffect } from "react";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";
import { uncachedHotcardIds, uncachedTemplateIds } from "@/lib/liveDrawerModel";

/**
 * Keeps this project's hotcard bodies (and their templates, for thumbnails)
 * cached while the Live page is open, whether or not the drawer's Hotcards
 * section is showing, so an F-key always finds its card on the first press.
 * `enabled` gates it for other callers (the ⌘K palette, only while open).
 */
export function useHotcardHydration(enabled = true): void {
  const { send } = useWs();
  const conn = useStore((s) => s.conn);
  const hotcards = useStore((s) => s.hotcards);
  const hotcardCache = useStore((s) => s.hotcardCache);
  const templateCache = useStore((s) => s.templateCache);
  const projectId = useStore((s) => s.currentProjectId);

  useEffect(() => {
    if (!enabled || conn !== "open") return;
    for (const id of uncachedHotcardIds(hotcards, projectId, hotcardCache)) send({ type: "get_hotcard", hotcardId: id });
    for (const id of uncachedTemplateIds(hotcards, projectId, hotcardCache, templateCache)) {
      send({ type: "get_template", templateId: id });
    }
  }, [enabled, conn, hotcards, hotcardCache, templateCache, projectId, send]);
}
