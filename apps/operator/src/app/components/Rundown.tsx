"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Button, OfflineState, colors } from "@overlaysys/ui";
import { songTakeChannel } from "@/lib/songChannel";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";
import { useConnection } from "@/lib/useConnection";
import { rowAirState, type AirState } from "@/lib/rowAirState";
import { editedFieldKeys, withEffectiveData } from "@/lib/rowData";
import { rowView, type RowView } from "@/lib/rowView";
import { liveGroups } from "@/lib/liveNext";
import { slidesRowViewFor } from "@/lib/slidesRowView";
import { rowFireMessages } from "@/lib/liveKeys";
import { requestedDecks } from "@/lib/deckRequests";
import { RundownList } from "./rundown/RundownList";
import { doubleClickAction, rowCanFire, takeableNextRowId } from "./rundown/rundownModel";
import { useLivePrefs } from "../hooks/useLivePrefs";
import { useWarnRowIds } from "./live/overflowStore";

type Row = NonNullable<ReturnType<typeof useStore.getState>["show"]>["rows"][number];

/** Live's rundown: computes air state and the next row, and wires Take / Cue to the per-kind messages. */
export function Rundown() {
  const { send } = useWs();
  const router = useRouter();
  const { connected, retry } = useConnection();
  const show = useStore((s) => s.show);
  const templates = useStore((s) => s.templates);
  const templateCache = useStore((s) => s.templateCache);
  const conn = useStore((s) => s.conn);
  const selectedRowId = useStore((s) => s.selectedRowId);
  const setSelectedRow = useStore((s) => s.setSelectedRow);
  const songs = useStore((s) => s.songs);
  const songCache = useStore((s) => s.songCache);
  const channelStates = useStore((s) => s.channelStates);
  const songSessions = useStore((s) => s.songSessions);
  const overrides = useStore((s) => s.rowDataOverrides);
  const deckCache = useStore((s) => s.deckCache);
  const deckNotFound = useStore((s) => s.deckNotFound);
  const warnRowIds = useWarnRowIds();
  const { doubleClickTakes } = useLivePrefs();

  useEffect(() => {
    if (!show || conn !== "open") return;
    const seen = new Set<string>();
    for (const r of show.rows) {
      if (r.kind === "slides") {
        // Slides rows need their deck for the row view (title, missing slides).
        const id = r.deckId;
        if (id && !deckCache[id] && !deckNotFound[id] && !requestedDecks.has(id)) {
          requestedDecks.add(id);
          send({ type: "get_deck", deckId: id });
        }
        continue;
      }
      // Scripture rows dispatch per slide via ScriptureTakeStrip; video has no template.
      if (r.kind === "scripture" || r.kind === "video") continue;
      const id = r.kind === "graphic" ? r.templateId : r.lyricTemplateId;
      if (seen.has(id)) continue;
      seen.add(id);
      if (!templateCache[id]) send({ type: "get_template", templateId: id });
    }
  }, [show, templateCache, deckCache, deckNotFound, conn, send]);

  const caches = useMemo(() => ({ songCache, templateCache }), [songCache, templateCache]);

  const model = useMemo(() => {
    if (!show) return null;
    const rows = liveGroups(show).flatMap((g) => g.rows) as Row[];
    const ctx = { show, songs, songCache, templates, templateCache, overrides, deckCache, deckNotFound };
    const air: Record<string, AirState> = {};
    const views: Record<string, RowView> = {};
    const edited = new Set<string>();
    for (const row of rows) {
      const songChannel = row.kind === "song" ? songTakeChannel(row, show, caches) : undefined;
      air[row.id] = rowAirState(withEffectiveData(row, overrides), channelStates, songSessions, {
        showId: show.id,
        rows: show.rows,
        ...(songChannel ? { songChannel } : {}),
      });
      views[row.id] = rowView(row, ctx);
      if (row.kind === "graphic" && editedFieldKeys(row, overrides).length > 0) edited.add(row.id);
    }
    const byId = new Map(rows.map((r) => [r.id, r]));
    // One rule for the buttons, nextRowId and the Enter / Space keys (rowCanFire).
    const canFire = (id: string, action: "cue" | "take"): boolean => {
      const row = byId.get(id);
      if (!row) return false;
      // Never a missing deck, nor one still loading (nextRowId must not pick it).
      const deckId = row.kind === "slides" ? row.deckId : undefined;
      const slidesView =
        row.kind === "slides" ? slidesRowViewFor(row, deckId ? (deckNotFound[deckId] ? null : deckCache[deckId]) : null) : null;
      return rowCanFire(row, action, { supported: !!views[id]?.supported, slidesView });
    };
    const canTake = (id: string) => canFire(id, "take");
    const canCue = (id: string) => canFire(id, "cue");
    const next = takeableNextRowId(rows, air, selectedRowId, canTake);
    return { byId, air, edited, canTake, canCue, next };
  }, [show, songs, songCache, templates, templateCache, overrides, deckCache, deckNotFound, channelStates, songSessions, caches, selectedRowId]);

  if (!show || !model) {
    if (!connected) return <OfflineState noun="shows" onRetry={retry} compact />;
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: 24 }}>
        <p style={{ color: colors.textDim, fontSize: 13, margin: 0 }}>Pick a show to start</p>
        <Button size="sm" variant="secondary" onClick={() => router.push("/shows")}>
          Shows
        </Button>
      </div>
    );
  }

  /** Take or cue one row with its kind's message (shared with Enter / Space). */
  const fire = (rowId: string, action: "take" | "cue") => {
    const row = model.byId.get(rowId);
    if (!row) return;
    setSelectedRow(row.id);
    const st = useStore.getState();
    const msgs = rowFireMessages(row, action, {
      show,
      overrides: st.rowDataOverrides,
      caches,
      channelStates: st.channelStates,
    });
    for (const m of msgs) send(m);
  };

  // D4: double-click cues (to preview); with "Double-click takes to program"
  // on, it takes that exact row (never a re-take of the row on program).
  const onDoubleClick = (rowId: string) => {
    setSelectedRow(rowId);
    if (!connected) return;
    const action = doubleClickAction({
      takes: doubleClickTakes,
      air: model.air[rowId] ?? null,
      canTake: model.canTake(rowId),
      canCue: model.canCue(rowId),
    });
    if (action) fire(rowId, action);
  };

  const list = (
    <RundownList
      show={show}
      mode="live"
      selectedRowId={selectedRowId}
      onSelect={(id) => setSelectedRow(id)}
      air={model.air}
      nextRowId={model.next}
      onTake={(id) => fire(id, "take")}
      onCue={(id) => fire(id, "cue")}
      onDoubleClick={onDoubleClick}
      canCue={model.canCue}
      actionBlocked={connected ? null : "Not connected"}
      editedRowIds={model.edited}
      warnRowIds={warnRowIds}
    />
  );

  if (!connected) {
    return (
      <OfflineState variant="stale" onRetry={retry}>
        <div style={{ opacity: 0.55 }}>{list}</div>
      </OfflineState>
    );
  }
  return list;
}
