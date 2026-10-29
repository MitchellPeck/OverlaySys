"use client";

import { Pill, colors } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { keyMode } from "@/lib/shortcutGuards";
import { keysLabel, keysOtherShow } from "@/lib/liveKeys";
import { MediaTransportStrip } from "./MediaTransportStrip";
import { ChannelDots } from "./ChannelDots";

export function ConsoleBottomBar() {
  const songSessions = useStore((s) => s.songSessions);
  const channelStates = useStore((s) => s.channelStates);
  const showId = useStore((s) => s.show?.id ?? null);
  const mode = keyMode({ songSessions, channelStates });
  // The keys still drive a session taken from another show; say so.
  const label = keysLabel(mode, keysOtherShow(mode, channelStates, showId));
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        minHeight: 40,
        padding: "6px 12px",
        background: colors.surface,
        borderTop: `1px solid ${colors.border}`,
      }}
    >
      <span title="What Space, Shift+Space and B drive right now" style={{ flexShrink: 0 }}>
        <Pill tone="dim">{label}</Pill>
      </span>
      <MediaTransportStrip inline size="sm" />
      <div style={{ marginLeft: "auto" }}>
        <ChannelDots />
      </div>
    </div>
  );
}
