"use client";

import { useMemo, useState } from "react";
import { RotateCcw, TriangleAlert } from "lucide-react";
import type { GraphicRow } from "@overlaysys/core";
import type { ClientMessage } from "@overlaysys/ws-protocol";
import { Button, IconButton, KindBar, colors, radius, space, useConfirm, type ItemKind } from "@overlaysys/ui";
import { FieldInput } from "@/lib/FieldInput";
import { useStore } from "@/lib/store";
import { getClient, useWs } from "@/lib/useWs";
import { fetchHotcardForFire } from "@/lib/hotcardFetchFire";
import type { RowLike } from "@/lib/rowLike";
import { rowView } from "@/lib/rowView";
import { formatDuration } from "@/lib/listFormat";
import { mediaRowTakeMessage, onAirMediaFor } from "@/lib/mediaTake";
import { editedFieldKeys, effectiveRowData, graphicRowMessage } from "@/lib/rowData";
import { songCueChannel, songTakeChannel } from "@/lib/songChannel";
import { hotcardFireMessage } from "@/lib/shortcutGuards";
import { slidesControlState, slidesRowTakeMessages } from "@/lib/slidesRowView";
import { useTakeFeedback } from "../../hooks/useTakeFeedback";
import { SongTakeStrip } from "../SongTakeStrip";
import { ScriptureTakeStrip } from "../ScriptureTakeStrip";
import { MediaTransportStrip } from "../MediaTransportStrip";
import { useThumbCtx } from "./useThumbCtx";
import { useRowWarnings } from "./overflowStore";
import { SlidesAutoNote } from "./SlidesAutoNote";

/** Mouse clicks must not leave focus on a control: Space is the global advance key. */
const keepFocus = (e: React.MouseEvent) => e.preventDefault();

type Props = {
  row: RowLike | null;
  /** A selected hotcard (no row). */
  hotcardId?: string | null;
  quickTake?: boolean;
  onQuickTakeChange?(on: boolean): void;
};

/**
 * One 36 px row for the selected item: kind bar, title, detail and length,
 * then the kind's own controls and the Quick take toggle at the far right.
 * A graphic's "Edit fields" opens the session-edit panel under the bar.
 */
export function ItemBar({ row, hotcardId = null, quickTake = false, onQuickTakeChange }: Props) {
  const ctx = useThumbCtx();
  const hotcards = useStore((s) => s.hotcards);
  const templateCache = useStore((s) => s.templateCache);
  // The caller keys this bar by row id, so the panel closes when the selection moves on.
  const [editOpen, setEditOpen] = useState(false);

  let kind: ItemKind | null = null;
  let title = "";
  let detail: string | null = null;
  let length: number | null = null;
  let warning: string | null = null;
  let noText = false;
  if (quickTake) {
    title = "Quick take";
  } else if (row && ctx) {
    const v = rowView(row, ctx);
    kind = v.kind;
    title = v.title;
    detail = v.detail;
    length = v.lengthSec;
    if (row.kind === "video") {
      const end = (row as { endAction?: string }).endAction === "clear" ? "clears" : "holds";
      detail = [detail, `At end: ${end}`].filter(Boolean).join(" · ");
    }
    // Graphics and scripture: a design with no layers shows nothing on air.
    if (row.kind === "graphic" || row.kind === "scripture") {
      const t = templateCache[(row as { templateId: string }).templateId];
      // Only a template with no layers at all: image/video-only templates (logos) are fine.
      if (t && (t.layers ?? []).length === 0) {
        noText = true;
        warning = "This design has no layers";
      }
    }
    warning ??= v.warning ?? null;
  } else if (hotcardId) {
    kind = "graphic";
    title = hotcards.find((h) => h.id === hotcardId)?.name ?? "Hotcard";
    detail = "Hotcard";
  }

  return (
    <>
      <div
        role="group"
        aria-label="Selected item"
        style={{
          display: "flex",
          alignItems: "center",
          gap: space[2],
          height: 36,
          flexShrink: 0,
          padding: "0 8px",
          borderBottom: `1px solid ${colors.border}`,
          minWidth: 0,
        }}
      >
        {kind && <KindBar kind={kind} />}
        <div style={{ display: "flex", alignItems: "baseline", gap: space[2], minWidth: 0, flex: "1 1 auto", overflow: "hidden" }}>
          {title ? (
            <span title={title} style={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 40 }}>
              {title}
            </span>
          ) : (
            <span style={{ fontSize: 12, color: colors.textDim, whiteSpace: "nowrap" }}>Select a rundown item, or use Quick take.</span>
          )}
          {detail && (
            <span title={detail} style={{ fontSize: 12, color: colors.textMuted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0, flexShrink: 10 }}>
              {detail}
            </span>
          )}
          {length != null && <span style={{ fontSize: 12, color: colors.textMuted, flexShrink: 0 }}>{formatDuration(length)}</span>}
          {warning && (
            <span role="status" title={warning} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12, color: colors.warn, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              <TriangleAlert size={12} aria-hidden style={{ flexShrink: 0 }} />
              {warning}
            </span>
          )}
        </div>
        {!quickTake && (
          // A video's transport may shrink (its seek bar narrows); buttons never do.
          <div style={{ display: "flex", alignItems: "center", gap: space[2], flexShrink: row?.kind === "video" ? 1 : 0, minWidth: 0 }}>
            {row && ctx ? (
              <RowControls row={row} editOpen={editOpen} onEditToggle={() => setEditOpen((v) => !v)} noText={noText} />
            ) : hotcardId ? (
              <HotcardControls hotcardId={hotcardId} />
            ) : null}
          </div>
        )}
        {onQuickTakeChange && (
          <Button
            size="sm"
            variant="ghost"
            aria-pressed={quickTake}
            onMouseDown={keepFocus}
            onClick={() => onQuickTakeChange(!quickTake)}
            style={quickTake ? { color: colors.accent, borderColor: colors.accent } : undefined}
          >
            Quick take
          </Button>
        )}
      </div>
      {!quickTake && editOpen && row?.kind === "graphic" && <GraphicFieldsPanel row={row as GraphicRow} />}
    </>
  );
}

function RowControls({ row, editOpen, onEditToggle, noText }: { row: RowLike; editOpen: boolean; onEditToggle(): void; noText: boolean }) {
  const show = useStore((s) => s.show);
  const songCache = useStore((s) => s.songCache);
  const templateCache = useStore((s) => s.templateCache);
  const channelStates = useStore((s) => s.channelStates);
  const songSessions = useStore((s) => s.songSessions);
  const deckCache = useStore((s) => s.deckCache);
  const deckNotFound = useStore((s) => s.deckNotFound);
  const liveFolderFiles = useStore((s) => s.liveFolderFiles);
  const confirm = useConfirm();
  const caches = useMemo(() => ({ songCache, templateCache }), [songCache, templateCache]);
  if (!show) return null;

  switch (row.kind) {
    case "graphic": {
      const g = row as GraphicRow;
      const msg = (action: "cue" | "take") => graphicRowMessage(g, action, useStore.getState().rowDataOverrides, useStore.getState().show?.id);
      return (
        <>
          <CueTake
            cue={() => msg("cue")}
            take={async () => {
              if (noText) {
                const name = templateCache[g.templateId]?.name ?? "Untitled";
                const ok = await confirm({
                  title: "Take a graphic with no layers?",
                  message: `The design "${name}" has no layers, so nothing will show.`,
                  confirmLabel: "Take",
                });
                if (!ok) return null;
              }
              return msg("take");
            }}
          />
          <Button size="md" variant="ghost" aria-pressed={editOpen} aria-expanded={editOpen} onMouseDown={keepFocus} onClick={onEditToggle}>
            Edit fields
          </Button>
        </>
      );
    }
    case "song": {
      const r = row as Extract<RowLike, { kind: "song" }>;
      const channel = songTakeChannel(r, show, caches);
      return (
        <>
          <CueTake cue={() => ({ type: "song_take", channel: songCueChannel(r, show, caches), showId: show.id, songRowId: r.id })} />
          <SongTakeStrip show={show} row={r} channel={channel} liveSession={songSessions[channel] ?? null} />
        </>
      );
    }
    case "scripture": {
      const r = row as Extract<RowLike, { kind: "scripture" }>;
      return (
        <ScriptureTakeStrip
          show={show}
          row={r}
          channel={r.channelHint ?? "program"}
          confirmStart={
            noText
              ? () =>
                  confirm({
                    title: "Take scripture with no layers?",
                    message: `The design "${templateCache[r.templateId]?.name ?? "Untitled"}" has no layers, so nothing will show.`,
                    confirmLabel: "Take",
                    danger: true,
                  })
              : undefined
          }
        />
      );
    }
    case "video": {
      const v = row as Extract<RowLike, { kind: "video" }>;
      if (onAirMediaFor(v, channelStates)) return <MediaTransportStrip inline size="lg" />;
      return <CueTake take={() => mediaRowTakeMessage(v, useStore.getState().show?.id)} />;
    }
    case "media": {
      // A photo has no transport, timeline or duration: just Take, or "On air" while it is up.
      const p = row as Extract<RowLike, { kind: "media" }>;
      if (onAirMediaFor(p, channelStates)) return <span style={{ fontSize: 12, color: colors.textMuted }}>On air</span>;
      return <CueTake take={() => mediaRowTakeMessage(p, useStore.getState().show?.id)} />;
    }
    case "slides": {
      const cue = slidesRowTakeMessages(show.id, row, "cue");
      const take = slidesRowTakeMessages(show.id, row, "take");
      if (!cue || !take) return <span style={{ fontSize: 12, color: colors.textMuted }}>Slides decks arrive with plan 3</span>;
      const can = slidesControlState(row, { deckCache, deckNotFound, liveFolderFiles });
      return (
        <>
          <SlidesAutoNote row={row} />
          <CueTake
            cueMany={() => slidesRowTakeMessages(show.id, row, "cue")}
            takeMany={() => slidesRowTakeMessages(show.id, row, "take")}
            blocked={can.enabled ? undefined : { title: can.title }}
          />
        </>
      );
    }
    default:
      return null;
  }
}

function HotcardControls({ hotcardId }: { hotcardId: string }) {
  const hotcardCache = useStore((s) => s.hotcardCache);
  const message = async (target: "cue" | "take"): Promise<ClientMessage | null> => {
    // Not cached yet: fire once it arrives, unless anything else went to air first.
    const h = hotcardCache[hotcardId] ?? (await fetchHotcardForFire(getClient(), hotcardId));
    if (!h) return null;
    // Cue never goes to air, whatever the card's hint (LM-2, Default D7a).
    return hotcardFireMessage(h, target);
  };
  return <CueTake cue={() => message("cue")} take={() => message("take")} />;
}

type Build = () => ClientMessage | null | Promise<ClientMessage | null>;

/**
 * Cue / Take with send feedback: Take reads "Taking…" until the server echoes
 * the channel, and says so if it never does. A builder returning null sends nothing.
 */
function CueTake({
  cue,
  take,
  cueMany,
  takeMany,
  blocked,
}: {
  cue?: Build;
  take?: Build;
  cueMany?: () => ClientMessage[] | null;
  takeMany?: () => ClientMessage[] | null;
  /** Both buttons disabled (with this tooltip) when set. */
  blocked?: { title?: string };
}) {
  const { send } = useWs();
  const disconnected = useStore((s) => s.conn) !== "open";
  const cueFb = useTakeFeedback();
  const takeFb = useTakeFeedback();
  const title = disconnected ? "Disconnected from server" : blocked?.title;
  const off = disconnected || !!blocked;
  const fire = (fb: ReturnType<typeof useTakeFeedback>, one?: Build, many?: () => ClientMessage[] | null) => async () => {
    if (many) {
      const msgs = many() ?? [];
      msgs.forEach((m, i) => (i === msgs.length - 1 ? fb.send(m) : send(m)));
      return;
    }
    const msg = one ? await one() : null;
    if (msg) fb.send(msg);
  };
  const failed = takeFb.status === "failed" || cueFb.status === "failed";
  return (
    <>
      {failed && (
        <span role="status" title="No response from the server: it may not have gone out. Check the monitors and try again." style={{ fontSize: 12, color: colors.warn, whiteSpace: "nowrap" }}>
          No response
        </span>
      )}
      {(cue || cueMany) && (
        <Button size="md" onMouseDown={keepFocus} onClick={fire(cueFb, cue, cueMany)} disabled={off} title={title} aria-busy={cueFb.status === "pending"}>
          {cueFb.status === "pending" ? "Cueing…" : "Cue"}
        </Button>
      )}
      {(take || takeMany) && (
        <Button
          size="md"
          variant="onair"
          onMouseDown={keepFocus}
          onClick={fire(takeFb, take, takeMany)}
          disabled={off}
          title={title}
          aria-busy={takeFb.status === "pending"}
          style={{ minWidth: 72, opacity: takeFb.status === "pending" ? 0.75 : undefined }}
        >
          {takeFb.status === "pending" ? "Taking…" : "Take"}
        </Button>
      )}
    </>
  );
}

/**
 * Session-only field edits for the selected graphic (moved from the old
 * GraphicStage, same behaviour), with a warning under any field whose text
 * doesn't fit the template.
 */
function GraphicFieldsPanel({ row }: { row: GraphicRow }) {
  const templateCache = useStore((s) => s.templateCache);
  const rowOverrides = useStore((s) => s.rowDataOverrides[row.id]);
  const setRowFieldOverride = useStore((s) => s.setRowFieldOverride);
  const clearRowOverrides = useStore((s) => s.clearRowOverrides);
  const warnings = useRowWarnings(row.id);
  // Only this row's edits, so other rows' edits don't re-render the panel.
  const own = useMemo(() => (rowOverrides ? { [row.id]: rowOverrides } : {}), [row.id, rowOverrides]);
  const data = useMemo(() => effectiveRowData(row, own), [row, own]);
  const edited = editedFieldKeys(row, own);
  const fields = templateCache[row.templateId]?.fields;
  const warnFor = new Map(warnings.map((w) => [w.key, w.message]));

  return (
    <div
      role="region"
      aria-label="Edit fields for this session"
      style={{ padding: space[3], borderBottom: `1px solid ${colors.border}`, background: colors.surface, flexShrink: 0, maxHeight: "40%", overflow: "auto" }}
    >
      {!fields ? (
        <p style={{ fontSize: 12, color: colors.textDim, margin: 0 }}>Loading fields…</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: space[2], maxWidth: 720 }}>
          {fields.map((f) => {
            const isEdited = edited.includes(f.key);
            const warn = warnFor.get(f.key);
            return (
              <div key={f.key} style={{ display: "grid", gridTemplateColumns: "96px minmax(0, 1fr) 24px", gap: space[2], alignItems: "center" }}>
                <label style={{ fontSize: 12, color: colors.textDim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={f.label}>
                  {f.label}
                </label>
                <div style={{ borderLeft: `2px solid ${isEdited ? colors.warn : "transparent"}`, paddingLeft: 6, minWidth: 0 }}>
                  <FieldInput field={f} value={data[f.key]} onChange={(v) => setRowFieldOverride(row.id, f.key, v, row.data[f.key])} />
                  {warn && (
                    <div
                      role="status"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        marginTop: 4,
                        padding: "1px 6px",
                        borderRadius: radius.sm,
                        border: `1px solid ${colors.warn}`,
                        color: colors.warn,
                        fontSize: 11,
                      }}
                    >
                      <TriangleAlert size={11} aria-hidden />
                      {warn}
                    </div>
                  )}
                </div>
                {isEdited ? (
                  <IconButton
                    size={24}
                    title="Reset to saved value"
                    aria-label={`Reset ${f.label} to saved value`}
                    onClick={() => setRowFieldOverride(row.id, f.key, row.data[f.key] ?? "", row.data[f.key] ?? "")}
                  >
                    <RotateCcw size={12} />
                  </IconButton>
                ) : (
                  <span />
                )}
              </div>
            );
          })}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: space[2], marginTop: space[3], minHeight: 28 }}>
        <span style={{ fontSize: 12, color: colors.textDim }}>→ {row.channelHint ?? "program"}</span>
        {edited.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => clearRowOverrides(row.id)} style={{ marginLeft: "auto" }}>
            Reset edits
          </Button>
        )}
      </div>
    </div>
  );
}
