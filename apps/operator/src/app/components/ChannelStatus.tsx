"use client";

import { useEffect, useState } from "react";
import type { ChannelConfig, ChannelState } from "@overlaysys/core";
import { colors, radius } from "@overlaysys/ui";
import { ChannelPreview } from "./ChannelPreview";
import { ChannelWindowSettingsPopover } from "./ChannelWindowSettingsPopover";
import { getDesktopApi, isElectron } from "@/lib/desktop";

export function ChannelStatus({
  label,
  state,
  accent,
  mirrorOf = null,
  renderMode = "normal",
  href,
  config,
  previewEnabled,
  onTogglePreview,
  onClear,
}: {
  label: string;
  state: ChannelState | undefined;
  accent: string;
  mirrorOf?: string | null;
  renderMode?: "normal" | "matte";
  href?: string;
  /** When provided, renders a live mini-preview inside the card. */
  config?: ChannelConfig;
  previewEnabled?: boolean;
  onTogglePreview?: () => void;
  /** When provided, renders a Clear (×) button. Disabled when the channel
   * is idle so the operator can see at-a-glance whether there's anything
   * to clear. */
  onClear?: () => void;
}) {
  const active = state?.active ?? null;

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hasPrefs, setHasPrefs] = useState(false);
  const [fallbackWarning, setFallbackWarning] = useState<{
    configuredLabel: string | null;
    actualLabel: string;
  } | null>(null);

  useEffect(() => {
    if (!isElectron() || !config) return;
    const api = getDesktopApi();
    if (!api) return;
    let cancelled = false;
    const refresh = async () => {
      const [prefsFile, resolutions] = await Promise.all([
        api.getChannelWindowPrefs(),
        api.getChannelWindowResolutions(),
      ]);
      if (cancelled) return;
      setHasPrefs(!!prefsFile.channels[config.id]);
      const r = resolutions[config.id];
      setFallbackWarning(
        r && r.matchedBy === "fallback" && r.configuredLabel
          ? { configuredLabel: r.configuredLabel, actualLabel: r.actualLabel }
          : null,
      );
    };
    void refresh();
    const offOpened = api.onChannelWindowOpened(refresh);
    const offClosed = api.onChannelWindowClosed(refresh);
    return () => {
      cancelled = true;
      offOpened();
      offClosed();
    };
  }, [config]);

  return (
    <div
      style={{
        marginBottom: 10,
        padding: 12,
        background: colors.panel2,
        border: `1px solid ${active ? accent : colors.border}`,
        borderRadius: radius.md,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <div
          style={{
            fontSize: 11,
            letterSpacing: 1.2,
            color: accent,
            fontWeight: 600,
          }}
        >
          ● {label}
        </div>
        {fallbackWarning && (
          <div
            title={`Configured for ${fallbackWarning.configuredLabel}; using ${fallbackWarning.actualLabel}`}
            style={{ fontSize: 11, color: colors.warn }}
          >
            ⚠
          </div>
        )}
        {(mirrorOf || renderMode === "matte") && (
          <div style={{ fontSize: 10, color: colors.textDim, fontWeight: 400 }}>
            {mirrorOf && <>↳ {mirrorOf}</>}
            {mirrorOf && renderMode === "matte" && " · "}
            {renderMode === "matte" && <>matte</>}
          </div>
        )}
        <div style={{ marginLeft: "auto", display: "flex", gap: 4, alignItems: "center" }}>
          {onTogglePreview && (
            <button
              onClick={onTogglePreview}
              title={previewEnabled ? "Hide preview" : "Show preview"}
              style={{
                width: 22,
                height: 18,
                background: "transparent",
                color: previewEnabled ? accent : colors.textDim,
                border: `1px solid ${colors.border}`,
                borderRadius: radius.sm,
                cursor: "pointer",
                fontSize: 10,
                padding: 0,
                lineHeight: 1,
              }}
            >
              {previewEnabled ? "👁" : "—"}
            </button>
          )}
          {(href || config) && (
            <>
              {hasPrefs && (
                <button
                  onClick={() => {
                    const api = getDesktopApi();
                    if (api && config) void api.reopenChannelOnConfiguredDisplay(config.id);
                  }}
                  title="Reopen on configured display"
                  style={{
                    width: 22,
                    height: 18,
                    background: "transparent",
                    color: accent,
                    border: `1px solid ${colors.border}`,
                    borderRadius: radius.sm,
                    cursor: "pointer",
                    fontSize: 10,
                    padding: 0,
                    lineHeight: 1,
                  }}
                >
                  ⟳
                </button>
              )}
              <button
                onClick={() => {
                  if (isElectron() && config) {
                    getDesktopApi()?.openChannelWindow(config.id);
                  } else if (href) {
                    window.open(href, "_blank", "noreferrer");
                  }
                }}
                title="Open renderer"
                style={{
                  width: 22,
                  height: 18,
                  background: "transparent",
                  color: accent,
                  border: `1px solid ${colors.border}`,
                  borderRadius: radius.sm,
                  cursor: "pointer",
                  fontSize: 10,
                  padding: 0,
                  lineHeight: 1,
                }}
              >
                ↗
              </button>
              {isElectron() && config && (
                <div style={{ position: "relative" }}>
                  <button
                    onClick={() => setSettingsOpen((v) => !v)}
                    title="Window settings"
                    style={{
                      width: 22,
                      height: 18,
                      background: "transparent",
                      color: settingsOpen ? accent : colors.textDim,
                      border: `1px solid ${colors.border}`,
                      borderRadius: radius.sm,
                      cursor: "pointer",
                      fontSize: 10,
                      padding: 0,
                      lineHeight: 1,
                    }}
                  >
                    ⚙
                  </button>
                  {settingsOpen && (
                    <ChannelWindowSettingsPopover
                      channelId={config.id}
                      onClose={() => setSettingsOpen(false)}
                    />
                  )}
                </div>
              )}
            </>
          )}
          {onClear && (
            <button
              onClick={onClear}
              disabled={!active}
              title={active ? "Clear this channel" : "Channel is already empty"}
              style={{
                width: 22,
                height: 18,
                background: "transparent",
                color: active ? colors.red : colors.textDim,
                border: `1px solid ${colors.border}`,
                borderRadius: radius.sm,
                cursor: active ? "pointer" : "default",
                opacity: active ? 1 : 0.5,
                fontSize: 12,
                padding: 0,
                lineHeight: 1,
              }}
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Live preview — fills card width at 16:9 aspect. */}
      {config && previewEnabled && (
        <div style={{ marginTop: 8 }}>
          <ChannelPreview config={config} state={state} />
        </div>
      )}

      <div style={{ marginTop: 6 }}>
        {active ? (
          <>
            <div style={{ fontSize: 13 }}>{active.templateId}</div>
            <div style={{ color: colors.textDim, fontSize: 11, marginTop: 2 }}>
              phase: {active.phase} · {Object.keys(active.data).length} fields
            </div>
            {Object.entries(active.data)
              .slice(0, 3)
              .map(([k, v]) => (
                <div key={k} style={{ fontSize: 11, marginTop: 4, color: colors.textDim }}>
                  <span style={{ color: colors.text }}>{k}:</span>{" "}
                  {v.startsWith("data:") ? "(image data)" : v.length > 40 ? v.slice(0, 39) + "…" : v}
                </div>
              ))}
          </>
        ) : (
          <div style={{ color: colors.textDim, fontSize: 12 }}>(empty)</div>
        )}
      </div>
    </div>
  );
}
