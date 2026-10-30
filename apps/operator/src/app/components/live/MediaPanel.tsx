"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { MEDIA_POSITION_LABELS, MediaPositionSchema, type LiveFolderFile, type MediaItemMeta, type PartialMediaPlacement } from "@overlaysys/core";
import { Button, Input, OfflineState, PositionGrid, Select, colors, fontSize, radius, useToast } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { getClient, useWs } from "@/lib/useWs";
import { useConnection } from "@/lib/useConnection";
import { MediaThumb } from "../../media/MediaCard";
import { NO_FOLDER, folderNames, liveFolderCountText } from "../../media/libraryConfig";
import { MEDIA_FIT_OPTIONS } from "@/lib/mediaPlacement";
import { useLivePrefs } from "../../hooks/useLivePrefs";
import {
  dblClickFromControl,
  filterPanelItems,
  mediaFolderTakeMessage,
  mediaItemTakeMessage,
  panelAirState,
  panelPlacement,
  panelPlacementShown,
  panelPlacementState,
  searchKeyReleasesFocus,
  shouldReleaseFocus,
  type PanelChannel,
} from "./mediaPanelModel";

const POSITION_OPTIONS = MediaPositionSchema.options.map((value) => ({ value, label: MEDIA_POSITION_LABELS[value] }));

/** Keeps clicks from leaving focus on the control, so Space/Enter still reach the console shortcuts. */
const noFocus = (e: React.MouseEvent) => e.preventDefault();

const EMPTY_FOLDER = "This folder has no photos or videos yet.";

/**
 * Live drawer's Media section: the library with Cue (preview) and Take
 * (program) per item, like hotcards. Photos and videos go straight to the
 * media slot; a live folder loops on the server. Nothing here changes the show.
 */
export function MediaPanel() {
  const { send } = useWs();
  const toast = useToast();
  const { connected, conn, retry } = useConnection();
  const { doubleClickTakes } = useLivePrefs();
  const items = useStore((s) => s.mediaItems);
  const liveFolderFiles = useStore((s) => s.liveFolderFiles);
  const channelStates = useStore((s) => s.channelStates);
  const [query, setQuery] = useState("");
  const [folder, setFolder] = useState("");
  const panelRef = useRef<HTMLElement>(null);
  const disconnected = conn !== "open";

  useEffect(() => {
    if (connected) send({ type: "list_media" });
  }, [connected, send]);

  // File counts (and the empty-folder guard) for every live folder.
  const liveIds = items.filter((m) => m.kind === "live-folder" && !m.deletedAt).map((m) => m.id).join(",");
  useEffect(() => {
    if (!connected) return;
    for (const id of liveIds.split(",").filter(Boolean)) send({ type: "list_live_folder", id });
  }, [connected, liveIds, send]);

  // A refused folder take (emptied since the list loaded) says why.
  useEffect(
    () =>
      getClient().on((m) => {
        if (m.type === "error" && m.op === "media_folder_take") toast({ tone: "error", message: m.message });
      }),
    [toast],
  );

  const folders = useMemo(() => folderNames(items), [items]);
  const shown = filterPanelItems(items, query, folder);
  const hasAny = filterPanelItems(items, "", "").length > 0;

  function fire(m: MediaItemMeta, channel: PanelChannel, placement: PartialMediaPlacement) {
    // Cue/Take keep focus off the button, but it may still sit in the search or
    // folder box: hand the keyboard back so Space/Enter drive the show.
    const active = typeof document === "undefined" ? null : document.activeElement;
    if (shouldReleaseFocus(active, panelRef.current) && active instanceof HTMLElement) active.blur();
    send(m.kind === "live-folder" ? mediaFolderTakeMessage(m, channel, placement) : mediaItemTakeMessage(m, channel, placement));
  }

  if (!hasAny) {
    return (
      <div style={{ padding: 8 }}>
        {disconnected ? (
          <OfflineState noun="media" onRetry={retry} compact />
        ) : (
          <p style={{ color: colors.textDim, fontSize: 12, margin: 0 }}>
            No photos or videos yet.{" "}
            <Link href="/media" style={{ color: colors.accent2 }}>
              Add some in Media
            </Link>
            .
          </p>
        )}
      </div>
    );
  }

  return (
    <section ref={panelRef} style={{ display: "flex", flexDirection: "column", gap: 6, padding: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Input
          aria-label="Search Media"
          placeholder="Search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (searchKeyReleasesFocus(e.key)) e.currentTarget.blur();
          }}
          style={{ flex: 1 }}
        />
        <Link href="/media" style={{ color: colors.textDim, fontSize: 11, textDecoration: "none" }}>
          Manage
        </Link>
      </div>
      {folders.length > 0 && (
        <Select
          aria-label="Folder"
          value={folder}
          onChange={(e) => {
            // Hand the keyboard back to the show shortcuts once a folder is picked.
            e.currentTarget.blur();
            setFolder(e.target.value);
          }}
        >
          <option value="">All folders</option>
          {folders.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
          <option value={NO_FOLDER}>No folder</option>
        </Select>
      )}
      {disconnected && <OfflineState noun="media" variant="stale" onRetry={retry} />}
      {shown.length === 0 ? (
        <p style={{ color: colors.textDim, fontSize: 12, margin: 0 }}>Nothing matches that search.</p>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
          {shown.map((m) => (
            <PanelCard
              key={m.id}
              item={m}
              live={m.kind === "live-folder" ? liveFolderFiles[m.id] : undefined}
              air={panelAirState(m, channelStates)}
              disconnected={disconnected}
              onFire={(ch, p) => fire(m, ch, p)}
              onDouble={(p) => fire(m, doubleClickTakes ? "program" : "preview", p)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function PanelCard({
  item,
  live,
  air,
  disconnected,
  onFire,
  onDouble,
}: {
  item: MediaItemMeta;
  live: { files: LiveFolderFile[]; configured: boolean } | undefined;
  air: PanelChannel | null;
  disconnected: boolean;
  onFire: (channel: PanelChannel, placement: PartialMediaPlacement) => void;
  onDouble: (placement: PartialMediaPlacement) => void;
}) {
  // Size/position for the next Cue/Take only; the library item is never changed.
  const [placementSt, setPlacementSt] = useState(() => panelPlacementState(item, {}));
  const chosen = panelPlacement(placementSt, item);
  const shown = panelPlacementShown(item, chosen);
  const choose = (patch: PartialMediaPlacement) => setPlacementSt(panelPlacementState(item, { ...chosen, ...patch }));
  // Known empty: nothing to take. Still loading: let the server decide.
  const empty = item.kind === "live-folder" && !!live && live.files.length === 0;
  const blocked = disconnected || empty;
  const sub = item.kind === "live-folder" ? (live ? liveFolderCountText(live.files.length) : "Live folder") : (item.folder ?? "");
  return (
    <div
      onMouseDown={noFocus}
      onDoubleClick={(e) => {
        // A double-click on Cue must never take to program.
        if (blocked || dblClickFromControl(e.target as Element)) return;
        onDouble(chosen);
      }}
      aria-label={`${item.name}${air === "program" ? " (on air)" : air === "preview" ? " (on preview)" : ""}`}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        padding: air === "program" ? 5 : 6,
        background: colors.panel2,
        border:
          air === "program" ? `2px solid ${colors.onair}` : air === "preview" ? `1px solid ${colors.ok}` : `1px solid ${colors.border}`,
        borderRadius: radius.md,
        minWidth: 0,
      }}
    >
      <MediaThumb item={item} liveFiles={live?.files} />
      <div title={item.name} style={{ fontSize: fontSize.sm, color: colors.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {item.name}
      </div>
      <div style={{ fontSize: fontSize.xs, color: colors.textMuted, minHeight: 15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {sub}
      </div>
      <div style={{ display: "flex", gap: 4 }} title={empty ? EMPTY_FOLDER : undefined}>
        <Button onMouseDown={noFocus} onClick={() => onFire("preview", chosen)} size="sm" disabled={blocked} style={{ flex: 1, fontSize: 11 }}>
          Cue
        </Button>
        <Button onMouseDown={noFocus} onClick={() => onFire("program", chosen)} variant="onair" size="sm" disabled={blocked} style={{ flex: 1, fontSize: 11 }}>
          Take
        </Button>
      </div>
      <div
        data-no-card-dblclick
        // The card keeps clicks from focusing; the picker needs them to open.
        onMouseDown={(e) => e.stopPropagation()}
        style={{ display: "flex", alignItems: "center", gap: 4 }}
      >
        <Select
          aria-label={`Size for ${item.name}`}
          value={shown.fit ?? ""}
          onChange={(e) => {
            // Hand the keyboard back to the show shortcuts once a size is picked.
            e.currentTarget.blur();
            choose({ fit: (e.target.value || undefined) as PartialMediaPlacement["fit"] });
          }}
          style={{ flex: 1, minWidth: 0, fontSize: 11 }}
        >
          {item.kind === "live-folder" && <option value="">Folder default</option>}
          {MEDIA_FIT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value} title={o.title}>
              {o.label}
            </option>
          ))}
        </Select>
        <div
          onClick={(e) => {
            // The grid's cell keeps focus after a click: give the keyboard back.
            const active = e.currentTarget.ownerDocument.activeElement;
            if (active instanceof HTMLElement && e.currentTarget.contains(active)) active.blur();
          }}
        >
          <PositionGrid aria-label={`Position for ${item.name}`} value={shown.position} options={POSITION_OPTIONS} onChange={(position) => choose({ position })} />
        </div>
      </div>
    </div>
  );
}
