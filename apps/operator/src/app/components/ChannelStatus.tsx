"use client";

import type { ChannelConfig, ChannelState } from "@overlaysys/core";
import { ChannelPreview } from "./ChannelPreview";
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
}) {
  const active = state?.active ?? null;
  return (
    <div
      style={{
        marginBottom: 10,
        padding: 12,
        background: "var(--panel-2)",
        border: `1px solid ${active ? accent : "var(--border)"}`,
        borderRadius: 4,
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
        {(mirrorOf || renderMode === "matte") && (
          <div style={{ fontSize: 10, color: "var(--text-dim)", fontWeight: 400 }}>
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
                color: previewEnabled ? accent : "var(--text-dim)",
                border: "1px solid var(--border)",
                borderRadius: 3,
                cursor: "pointer",
                fontSize: 10,
                padding: 0,
                lineHeight: 1,
              }}
            >
              {previewEnabled ? "👁" : "—"}
            </button>
          )}
          {isElectron() && config && (
            <button
              onClick={() => {
                getDesktopApi()?.openChannelWindow(config.id);
              }}
              title="Pop out as window"
              style={{
                width: 22,
                height: 18,
                background: "transparent",
                color: accent,
                border: "1px solid var(--border)",
                borderRadius: 3,
                cursor: "pointer",
                fontSize: 10,
                padding: 0,
                lineHeight: 1,
              }}
            >
              ⧉
            </button>
          )}
          {href && (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              title="Open renderer in browser"
              style={{
                fontSize: 10,
                color: "var(--text-dim)",
                textDecoration: "none",
                paddingLeft: 2,
              }}
            >
              ↗
            </a>
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
            <div style={{ color: "var(--text-dim)", fontSize: 11, marginTop: 2 }}>
              phase: {active.phase} · {Object.keys(active.data).length} fields
            </div>
            {Object.entries(active.data)
              .slice(0, 3)
              .map(([k, v]) => (
                <div key={k} style={{ fontSize: 11, marginTop: 4, color: "var(--text-dim)" }}>
                  <span style={{ color: "var(--text)" }}>{k}:</span>{" "}
                  {v.startsWith("data:") ? "(image data)" : v.length > 40 ? v.slice(0, 39) + "…" : v}
                </div>
              ))}
          </>
        ) : (
          <div style={{ color: "var(--text-dim)", fontSize: 12 }}>(empty)</div>
        )}
      </div>
    </div>
  );
}
