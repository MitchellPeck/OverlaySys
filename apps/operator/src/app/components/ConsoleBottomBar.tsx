"use client";

import { colors } from "@overlaysys/ui";
import { MediaTransportStrip } from "./MediaTransportStrip";
import { ChannelDots } from "./ChannelDots";

export function ConsoleBottomBar() {
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
      <MediaTransportStrip inline />
      <div style={{ marginLeft: "auto" }}>
        <ChannelDots />
      </div>
    </div>
  );
}
