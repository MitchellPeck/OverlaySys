"use client";

import { Pill, colors } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { keyMode, type KeyMode } from "@/lib/shortcutGuards";
import { MediaTransportStrip } from "./MediaTransportStrip";
import { ChannelDots } from "./ChannelDots";

const KEYS_LABEL: Record<KeyMode, string> = {
  song: "Keys: Song",
  scripture: "Keys: Scripture",
  slides: "Keys: Slides",
  rundown: "Keys: Rundown",
};

export function ConsoleBottomBar() {
  const songSessions = useStore((s) => s.songSessions);
  const channelStates = useStore((s) => s.channelStates);
  const mode = keyMode({ songSessions, channelStates });
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
        <Pill tone="dim">{KEYS_LABEL[mode]}</Pill>
      </span>
      <MediaTransportStrip inline size="sm" />
      <div style={{ marginLeft: "auto" }}>
        <ChannelDots />
      </div>
    </div>
  );
}
