"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import type { ChannelConfig } from "@overlaysys/core";
import { Button, StatusDot, colors } from "@overlaysys/ui";
import { ExternalLink, RotateCw, Settings2, X } from "lucide-react";
import { useStore } from "@/lib/store";
import { useOutputs, useWs } from "@/lib/useWs";
import { useResolvedChannelConfigs } from "@/lib/useResolvedChannels";
import { channelDotModel, rendererBaseFor, rendererHref, type OutputPresenceTone } from "@/lib/channelDotModel";
import { useChannelWindowPrefs } from "@/lib/useChannelWindowPrefs";
import { getDesktopApi, isElectron } from "@/lib/desktop";
import { AnchoredPopover } from "./AnchoredPopover";
import { ChannelWindowSettingsPopover } from "./ChannelWindowSettingsPopover";

export function ChannelDots() {
  const channels = useResolvedChannelConfigs();
  if (channels.length === 0) {
    return (
      <span style={{ color: colors.textMuted, fontSize: 12 }}>
        No channels configured ·{" "}
        <Link href="/settings/channels" style={{ color: colors.textDim }}>
          Set up channels
        </Link>
      </span>
    );
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
  const outputs = useOutputs();
  const model = channelDotModel(config, channelStates, outputs);
  const presenceTitle = presenceText(model.presence, model.outputCount, outputs?.[config.id]?.labels ?? []);
  const { hasPrefs, fallbackWarning, refresh } = useChannelWindowPrefs(config);
  const anchorRef = useRef<HTMLSpanElement | null>(null);
  const [menu, setMenu] = useState<"closed" | "menu" | "settings">("closed");
  // Built at click time from where this page was loaded, not localhost:3001 —
  // packaged builds serve the renderer from the server's own port.
  const href = () => rendererHref(rendererBaseFor(window.location), config.id);
  const titles = [
    fallbackWarning ? `Configured for ${fallbackWarning.configuredLabel}; using ${fallbackWarning.actualLabel}` : null,
    presenceTitle,
  ].filter(Boolean);

  return (
    <span ref={anchorRef} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <StatusDot
        tone={model.tone === "blanked" ? "warn" : model.tone}
        label={config.name}
        title={titles.length ? titles.join(" · ") : undefined}
        onClick={() => setMenu((m) => (m === "closed" ? "menu" : "closed"))}
        style={fallbackWarning ? { color: colors.warn } : undefined}
      />
      <PresenceMark presence={model.presence} title={presenceTitle} />
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
                else window.open(href(), "_blank", "noreferrer");
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

function presenceText(presence: OutputPresenceTone, count: number | null, labels: string[]): string | null {
  switch (presence) {
    case "unknown":
      return null;
    case "connected":
      return `${count} output${count === 1 ? "" : "s"} connected${labels.length ? ` (${labels.join(", ")})` : ""}`;
    case "idle":
      return "No output connected";
    case "missing":
      return "On air, but no output is connected";
  }
}

/** Hollow ring = no renderer window; red = content on air with no renderer. */
function PresenceMark({ presence, title }: { presence: OutputPresenceTone; title: string | null }) {
  if (presence === "unknown" || presence === "connected") return null;
  const missing = presence === "missing";
  return (
    <span
      role="img"
      aria-label={title ?? undefined}
      title={title ?? undefined}
      style={{
        display: "inline-block",
        width: 8,
        height: 8,
        borderRadius: "50%",
        boxSizing: "border-box",
        border: `1.5px solid ${missing ? colors.danger : colors.textMuted}`,
        background: missing ? colors.danger : "transparent",
        flexShrink: 0,
      }}
    />
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
