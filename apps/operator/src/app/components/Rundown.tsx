"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import type { ClientMessage } from "@overlaysys/ws-protocol";
import { Button, OfflineState, colors } from "@overlaysys/ui";
import { songCueChannel, songTakeChannel } from "@/lib/songChannel";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";
import { useConnection } from "@/lib/useConnection";
import { videoRowTakeMessage, onAirMediaFor } from "@/lib/mediaTake";
import { rowAirState, type AirState } from "@/lib/rowAirState";
import { editedFieldKeys, graphicRowMessage, withEffectiveData } from "@/lib/rowData";
import { rowView, type RowView } from "@/lib/rowView";
import { liveGroups } from "@/lib/liveNext";
import { slidesRowTakeMessages } from "@/lib/slidesRowView";
import { requestedDecks } from "@/lib/deckRequests";
import { RundownList } from "./rundown/RundownList";
import { takeableNextRowId } from "./rundown/rundownModel";
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
    const ctx = { show, songs, songCache, templates, templateCache, overrides, deckCache };
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
    const canTake = (id: string): boolean => {
      const row = byId.get(id);
      if (!row || !views[id]?.supported) return false;
      switch (row.kind) {
        case "graphic":
        case "song":
        case "video":
          return true;
        case "scripture":
          return row.slides.length > 0;
        case "slides":
          return slidesRowTakeMessages(show.id, row, "take") !== null;
        default:
          return false;
      }
    };
    const canCue = (id: string): boolean => {
      const row = byId.get(id);
      return !!row && row.kind !== "video" && canTake(id);
    };
    const next = takeableNextRowId(rows, air, selectedRowId, canTake);
    return { byId, air, edited, canCue, next };
  }, [show, songs, songCache, templates, templateCache, overrides, deckCache, channelStates, songSessions, caches, selectedRowId]);

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

  const sendAll = (msgs: ClientMessage[] | null) => {
    for (const m of msgs ?? []) send(m);
  };

  /** Take or cue one row with its kind's message. */
  const fire = (rowId: string, action: "take" | "cue") => {
    const row = model.byId.get(rowId);
    if (!row) return;
    setSelectedRow(row.id);
    const st = useStore.getState();
    switch (row.kind) {
      case "graphic":
        send(graphicRowMessage(row, action, st.rowDataOverrides, show.id));
        return;
      case "song": {
        const channel = action === "take" ? songTakeChannel(row, show, caches) : songCueChannel(row, show, caches);
        send({ type: "song_take", channel, showId: show.id, songRowId: row.id });
        return;
      }
      case "scripture": {
        if (row.slides.length === 0) return;
        if (action === "cue") {
          send({ type: "scripture_take_slide", showId: show.id, rowId: row.id, slideIdx: 0, channel: "preview" });
          return;
        }
        // The first slide, or the next one when this scripture is already live on its channel.
        const channel = row.channelHint ?? "program";
        const live = st.channelStates[channel]?.scriptureSession;
        const slideIdx = live?.rowId === row.id ? Math.min(live.slideIdx + 1, row.slides.length - 1) : 0;
        send({ type: "scripture_take_slide", showId: show.id, rowId: row.id, slideIdx, channel });
        return;
      }
      case "video":
        if (action === "cue") return; // video has no Cue
        if (onAirMediaFor(row, st.channelStates)) return;
        send(videoRowTakeMessage(row, show.id));
        return;
      case "slides":
        sendAll(slidesRowTakeMessages(show.id, row, action));
        return;
    }
  };

  // Double-click keeps today's behaviour (take); Task 16 makes it a setting (D4).
  const onDoubleClick = (rowId: string) => {
    const row = model.byId.get(rowId);
    if (!row) return;
    if (!connected) {
      setSelectedRow(rowId);
      return;
    }
    if (row.kind === "song") {
      setSelectedRow(row.id);
      send({
        type: "song_take_pvw_to_pgm",
        showId: show.id,
        songRowId: row.id,
        fromChannel: "preview",
        toChannel: songTakeChannel(row, show, caches),
      });
      return;
    }
    fire(rowId, "take");
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
