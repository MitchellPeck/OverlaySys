"use client";

import type { ChannelConfig } from "@overlaysys/core";
import { colors } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { useResolvedChannelConfigs } from "@/lib/useResolvedChannels";
import { ChannelPreview } from "./ChannelPreview";

/** Large PVW / PGM monitors. `compact` shrinks them while a song is live. */
export function Monitors({ compact }: { compact: boolean }) {
  const configs = useResolvedChannelConfigs();
  const channelStates = useStore((s) => s.channelStates);
  const pick = (id: string) => configs.find((c) => c.id === id) ?? null;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: compact ? "repeat(2, minmax(0, 240px))" : "repeat(2, minmax(0, 1fr))",
        gap: 12,
        padding: 12,
        flexShrink: 0,
      }}
    >
      <Monitor label="PVW" ring={colors.ok} ringWidth={1} config={pick("preview")} channelStates={channelStates} />
      <Monitor label="PGM" ring={colors.onair} ringWidth={2} config={pick("program")} channelStates={channelStates} />
    </div>
  );
}

function Monitor({
  label,
  ring,
  ringWidth,
  config,
  channelStates,
}: {
  label: string;
  ring: string;
  ringWidth: number;
  config: ChannelConfig | null;
  channelStates: ReturnType<typeof useStore.getState>["channelStates"];
}) {
  return (
    <div style={{ position: "relative", borderRadius: 6, overflow: "hidden", boxShadow: `0 0 0 ${ringWidth}px ${ring}`, background: "#05070c" }}>
      {config ? (
        <ChannelPreview config={config} state={channelStates[config.mirrorOf ?? config.id]} />
      ) : (
        <div style={{ aspectRatio: "16 / 9", display: "grid", placeItems: "center", color: colors.textMuted, fontSize: 12 }}>
          No {label === "PGM" ? "program" : "preview"} channel
        </div>
      )}
      <span
        style={{
          position: "absolute",
          top: 8,
          left: 8,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: 0.8,
          padding: "2px 6px",
          borderRadius: 3,
          background: ring,
          color: label === "PGM" ? "#fff" : "#04130d",
        }}
      >
        {label}
      </span>
    </div>
  );
}
