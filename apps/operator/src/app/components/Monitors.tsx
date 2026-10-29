"use client";

import type { ChannelConfig } from "@overlaysys/core";
import { colors } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { useResolvedChannelConfigs } from "@/lib/useResolvedChannels";
import { channelHasContent, onAirCaption } from "@/lib/onAir";
import { ChannelPreview } from "./ChannelPreview";
import { AirControls } from "./OnAirStrip";

/** PVW / PGM / air-controls columns. Fixed: monitors never resize between modes. */
export function monitorColumns(): string {
  return "minmax(0,1fr) minmax(0,1fr) 112px";
}

/** Keeps the air zone at or under 42vh tall (16:9 monitor). */
const MONITOR_MAX_W = "calc(42vh * 16 / 9)";

const EMPTY_LABEL = { preview: "Nothing cued", program: "Nothing on air" } as const;

/** Large PVW / PGM monitors with captions, and the air controls beside them. */
export function Monitors() {
  const configs = useResolvedChannelConfigs();
  const channelStates = useStore((s) => s.channelStates);
  const pick = (id: string) => configs.find((c) => c.id === id) ?? null;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: monitorColumns(),
        gap: 12,
        padding: 12,
        flexShrink: 0,
        alignItems: "start",
      }}
    >
      <div style={{ minWidth: 0, maxWidth: MONITOR_MAX_W }}>
        <Monitor channel="preview" config={pick("preview")} channelStates={channelStates} />
        <MonitorCaption channel="preview" />
      </div>
      <div style={{ minWidth: 0, maxWidth: MONITOR_MAX_W }}>
        <Monitor channel="program" config={pick("program")} channelStates={channelStates} />
        <MonitorCaption channel="program" />
      </div>
      <AirControls />
    </div>
  );
}

/** One-line caption under a monitor; the full text is its title. */
export function MonitorCaption({ channel }: { channel: "preview" | "program" }) {
  const st = useStore((s) => s.channelStates[channel]);
  const show = useStore((s) => s.show);
  const songs = useStore((s) => s.songs);
  const templates = useStore((s) => s.templates);
  const caption = onAirCaption(st, { show, songs, templates });
  const text = caption ?? EMPTY_LABEL[channel];
  return (
    <div
      title={text}
      style={{
        marginTop: 6,
        fontSize: 12,
        color: caption ? colors.text : colors.textMuted,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </div>
  );
}

function Monitor({
  channel,
  config,
  channelStates,
}: {
  channel: "preview" | "program";
  config: ChannelConfig | null;
  channelStates: ReturnType<typeof useStore.getState>["channelStates"];
}) {
  const isPgm = channel === "program";
  const tag = isPgm ? "PGM" : "PVW";
  const tone = isPgm ? colors.onair : colors.ok;
  const st = channelStates[config?.mirrorOf ?? config?.id ?? channel];
  const hasContent = channelHasContent(st);
  const chip = isPgm ? "ON AIR" : "CUED";
  return (
    <div
      style={{
        position: "relative",
        borderRadius: 6,
        overflow: "visible",
        boxShadow: hasContent ? `0 0 0 3px ${tone}` : `0 0 0 1px ${colors.border}`,
        background: "#05070c",
      }}
    >
      <div style={{ borderRadius: 6, overflow: "hidden" }}>
        {config ? (
          <ChannelPreview config={config} state={st} emptyLabel={EMPTY_LABEL[channel]} />
        ) : (
          <div style={{ aspectRatio: "16 / 9", display: "grid", placeItems: "center", color: colors.textMuted, fontSize: 12 }}>
            No {isPgm ? "program" : "preview"} channel
          </div>
        )}
      </div>
      <span style={tagStyle(tone, isPgm ? "#fff" : "#04130d", { left: 8 })}>{tag}</span>
      {hasContent && <span style={tagStyle(tone, isPgm ? "#fff" : "#04130d", { right: 8 })}>{chip}</span>}
    </div>
  );
}

function tagStyle(bg: string, fg: string, side: { left: number } | { right: number }): React.CSSProperties {
  return {
    position: "absolute",
    top: 8,
    ...side,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: 0.8,
    padding: "2px 6px",
    borderRadius: 3,
    background: bg,
    color: fg,
    pointerEvents: "none",
  };
}
