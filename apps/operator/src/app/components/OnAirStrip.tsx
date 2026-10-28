"use client";

import type { ChannelState } from "@overlaysys/core";
import type { ClientMessage } from "@overlaysys/ws-protocol";
import { Button, colors, space } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";
import { useDialog } from "@/lib/dialog";
import { channelHasContent, onAirCaption } from "@/lib/onAir";
import { useTakeFeedback } from "../hooks/useTakeFeedback";
import { monitorColumns } from "./Monitors";

/** Messages that empty a channel: graphics/song/scripture via clear, plus any media. */
function clearMessages(st: ChannelState | undefined, channel: string): ClientMessage[] {
  const msgs: ClientMessage[] = [{ type: "clear", channel }];
  if (st?.media) msgs.push({ type: "media_clear", channel });
  return msgs;
}

/**
 * "What's on air" under the monitors: program and preview captions with the
 * actions each needs (PVW: Take, Clear; PGM: Clear), plus Clear all.
 */
export function OnAirStrip({ compact = false }: { compact?: boolean }) {
  const { send } = useWs();
  const channelStates = useStore((s) => s.channelStates);
  const show = useStore((s) => s.show);
  const songs = useStore((s) => s.songs);
  const templates = useStore((s) => s.templates);
  const disconnected = useStore((s) => s.conn) !== "open";
  const take = useTakeFeedback();
  const { confirm, dialog } = useDialog();

  const ctx = { show, songs, templates };
  const pgm = channelStates["program"];
  const pvw = channelStates["preview"];
  const pgmCaption = onAirCaption(pgm, ctx);
  const pvwCaption = onAirCaption(pvw, ctx);
  const anyContent = Object.values(channelStates).some(channelHasContent);
  const offline = disconnected ? "Disconnected from server" : undefined;

  function takePreview() {
    // A song cued on PVW moves with its session; anything else swaps.
    const lr = pvw?.liveRow;
    if (pvw?.songSession && lr && show && lr.showId === show.id) {
      take.send({ type: "song_take_pvw_to_pgm", showId: lr.showId, songRowId: lr.rowId, fromChannel: "preview", toChannel: "program" });
    } else {
      take.send({ type: "take_pvw_to_pgm", fromChannel: "preview", toChannel: "program" });
    }
  }

  async function clearAll() {
    const live = Object.entries(channelStates).filter(([, st]) => channelHasContent(st));
    if (live.length === 0) return;
    const ok = await confirm({
      title: "Clear all channels?",
      message: `Everything on ${live.map(([ch]) => ch).join(", ")} will be cleared.`,
      confirmLabel: "Clear all",
      destructive: true,
    });
    if (!ok) return;
    for (const [ch, st] of live) for (const m of clearMessages(st, ch)) send(m);
  }

  const blurAfter = (fn: () => void) => (e: React.MouseEvent<HTMLButtonElement>) => {
    fn();
    e.currentTarget.blur();
  };

  return (
    <div
      role="region"
      aria-label="On air"
      style={{
        // Same columns as <Monitors> (PVW left, PGM right) so each slot's
        // controls sit under its own monitor.
        display: "grid",
        gridTemplateColumns: monitorColumns(compact),
        columnGap: 12,
        alignItems: "center",
        padding: "0 12px 12px",
        fontSize: 12,
        flexShrink: 0,
      }}
    >
      <Slot label="PVW" tone={colors.ok} caption={pvwCaption}>
        <Button
          size="sm"
          variant="onair"
          disabled={disconnected || !pvwCaption || take.status === "pending"}
          title={offline}
          aria-busy={take.status === "pending"}
          onClick={blurAfter(takePreview)}
        >
          {take.status === "pending" ? "Taking…" : "Take ▶"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={disconnected || !channelHasContent(pvw)}
          title={offline}
          onClick={blurAfter(() => clearMessages(pvw, "preview").forEach(send))}
        >
          Clear
        </Button>
        {take.status === "failed" && (
          <span role="status" style={{ color: colors.warn }}>
            No response; check program
          </span>
        )}
      </Slot>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: `${space[2]}px ${space[4]}px`, minWidth: 0 }}>
        <Slot label="PGM" tone={colors.onair} caption={pgmCaption}>
          <Button
            size="sm"
            variant="ghost"
            disabled={disconnected || !channelHasContent(pgm)}
            title={offline}
            onClick={blurAfter(() => clearMessages(pgm, "program").forEach(send))}
          >
            Clear
          </Button>
        </Slot>
        <Button
          size="sm"
          variant="danger"
          disabled={disconnected || !anyContent}
          title={offline ?? "Clear every channel"}
          onClick={blurAfter(() => void clearAll())}
          style={{ marginLeft: "auto" }}
        >
          Clear all
        </Button>
      </div>
      {dialog}
    </div>
  );
}

function Slot({ label, tone, caption, children }: { label: string; tone: string; caption: string | null; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: space[2], minWidth: 0, flex: "1 1 220px" }}>
      <span style={{ fontWeight: 700, fontSize: 10, letterSpacing: 0.8, color: tone }}>{label}</span>
      <span
        title={caption ?? undefined}
        style={{
          color: caption ? colors.text : colors.textMuted,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          minWidth: 0,
          flex: "0 1 auto",
        }}
      >
        {caption ?? "Nothing"}
      </span>
      {children}
    </div>
  );
}
