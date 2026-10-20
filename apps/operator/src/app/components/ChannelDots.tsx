"use client";

import { useRef, useState } from "react";
import type { ChannelConfig } from "@overlaysys/core";
import { Button, StatusDot, colors } from "@overlaysys/ui";
import { ExternalLink, RotateCw, Settings2, X } from "lucide-react";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";
import { useResolvedChannelConfigs } from "@/lib/useResolvedChannels";
import { channelDotModel } from "@/lib/channelDotModel";
import { useChannelWindowPrefs } from "@/lib/useChannelWindowPrefs";
import { getDesktopApi, isElectron } from "@/lib/desktop";
import { AnchoredPopover } from "./AnchoredPopover";
import { ChannelWindowSettingsPopover } from "./ChannelWindowSettingsPopover";

export function ChannelDots() {
  const channels = useResolvedChannelConfigs();
  if (channels.length === 0) {
    return <span style={{ color: colors.textMuted, fontSize: 12 }}>No channels configured</span>;
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      {channels.map((c) => (
        <ChannelDot key={c.id} config={c} />
      ))}
    </div>
  );
}

function ChannelDot({ config }: { config: ChannelConfig }) {
  const { send } = useWs();
  const channelStates = useStore((s) => s.channelStates);
  const model = channelDotModel(config, channelStates);
  const { hasPrefs, fallbackWarning, refresh } = useChannelWindowPrefs(config);
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const [menu, setMenu] = useState<"closed" | "menu" | "settings">("closed");
  const href = `http://localhost:3001/?channel=${encodeURIComponent(config.id)}`;

  return (
    <span ref={anchorRef}>
      <StatusDot
        tone={model.tone}
        label={config.name}
        title={fallbackWarning ? `Configured for ${fallbackWarning.configuredLabel}; using ${fallbackWarning.actualLabel}` : undefined}
        onClick={() => setMenu((m) => (m === "closed" ? "menu" : "closed"))}
        style={fallbackWarning ? { color: colors.warn } : undefined}
      />
      {menu === "menu" && (
        <AnchoredPopover anchorEl={anchorRef.current} onClose={() => setMenu("closed")} width={220}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {config.mirrorOf && (
              <div style={{ fontSize: 11, color: colors.textDim, padding: "2px 4px" }}>Mirrors {config.mirrorOf}</div>
            )}
            <MenuButton
              icon={<ExternalLink size={14} />}
              label="Open renderer"
              onClick={() => {
                if (isElectron()) getDesktopApi()?.openChannelWindow(config.id);
                else window.open(href, "_blank", "noreferrer");
                setMenu("closed");
              }}
            />
            {isElectron() && hasPrefs && (
              <MenuButton
                icon={<RotateCw size={14} />}
                label="Reopen on configured display"
                onClick={() => {
                  void getDesktopApi()?.reopenChannelOnConfiguredDisplay(config.id);
                  setMenu("closed");
                }}
              />
            )}
            {isElectron() && (
              <MenuButton icon={<Settings2 size={14} />} label="Window settings…" onClick={() => setMenu("settings")} />
            )}
            {!config.mirrorOf && (
              <MenuButton
                icon={<X size={14} />}
                label={model.canClear ? "Clear" : "Already empty"}
                disabled={!model.canClear}
                onClick={() => {
                  send({ type: "clear", channel: config.id });
                  setMenu("closed");
                }}
              />
            )}
          </div>
        </AnchoredPopover>
      )}
      {menu === "settings" && (
        <ChannelWindowSettingsPopover
          channelId={config.id}
          anchorEl={anchorRef.current}
          onClose={() => setMenu("closed")}
          onSaved={() => void refresh()}
        />
      )}
    </span>
  );
}

function MenuButton({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={disabled}
      onClick={onClick}
      style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-start", border: "none" }}
    >
      {icon}
      {label}
    </Button>
  );
}
