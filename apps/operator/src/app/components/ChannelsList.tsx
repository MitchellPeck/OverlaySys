"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useStore } from "@/lib/store";
import { ChannelStatus } from "./ChannelStatus";

const PREVIEW_ENABLED_KEY = "overlaysys:channelPreviewEnabled";

/** Per-channel toggle state, loaded from / persisted to localStorage. */
type EnabledMap = Record<string, boolean>;

function loadEnabled(): EnabledMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(PREVIEW_ENABLED_KEY);
    return raw ? (JSON.parse(raw) as EnabledMap) : {};
  } catch {
    return {};
  }
}
function saveEnabled(m: EnabledMap): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PREVIEW_ENABLED_KEY, JSON.stringify(m));
  } catch {
    // localStorage may throw in private mode / quota; just drop.
  }
}

/**
 * Right-rail channel status panel on the show page. Renders every configured
 * channel with a live mini-preview (toggleable per channel). Mirror channels
 * show the source's runtime state, since that's what the renderer displays.
 *
 * `orientation` controls the layout. Vertical (default) is the standard
 * sidebar stack. Horizontal lays out channels in a fixed-width row, used by
 * the bottom strip during song mode.
 */
export function ChannelsList({ orientation = "vertical" }: { orientation?: "vertical" | "horizontal" } = {}) {
  const channels = useStore((s) => s.channelConfigs);
  const channelStates = useStore((s) => s.channelStates);
  const [enabledMap, setEnabledMap] = useState<EnabledMap>(() => loadEnabled());

  // Persist whenever the toggle map changes.
  useEffect(() => {
    saveEnabled(enabledMap);
  }, [enabledMap]);

  function isEnabled(id: string): boolean {
    // Default: previews ON for newly-discovered channels.
    return enabledMap[id] ?? true;
  }
  function toggle(id: string) {
    setEnabledMap((cur) => ({ ...cur, [id]: !isEnabled(id) }));
  }

  if (channels.length === 0) {
    return (
      <div style={{ color: "var(--text-dim)", fontSize: 12 }}>
        No channels configured.{" "}
        <Link href="/channels" style={{ color: "var(--accent-2)" }}>
          Add channels
        </Link>
      </div>
    );
  }

  if (orientation === "horizontal") {
    return (
      <>
        {channels.map((c) => {
          const sourceId = c.mirrorOf ?? c.id;
          const state = channelStates[sourceId];
          return (
            <div
              key={c.id}
              style={{
                width: 360,
                flexShrink: 0,
              }}
            >
              <ChannelStatus
                label={c.name.toUpperCase()}
                state={state}
                accent={accentFor(c)}
                mirrorOf={c.mirrorOf ?? null}
                renderMode={c.renderMode}
                href={`http://localhost:3001/?channel=${encodeURIComponent(c.id)}&debug=1`}
                config={c}
                previewEnabled={isEnabled(c.id)}
                onTogglePreview={() => toggle(c.id)}
              />
            </div>
          );
        })}
      </>
    );
  }

  return (
    <>
      {channels.map((c) => {
        // Mirror channels reflect the source's runtime state — show that,
        // not the (always-empty) state on the mirror's own id.
        const sourceId = c.mirrorOf ?? c.id;
        const state = channelStates[sourceId];
        return (
          <ChannelStatus
            key={c.id}
            label={c.name.toUpperCase()}
            state={state}
            accent={accentFor(c)}
            mirrorOf={c.mirrorOf ?? null}
            renderMode={c.renderMode}
            href={`http://localhost:3001/?channel=${encodeURIComponent(c.id)}&debug=1`}
            config={c}
            previewEnabled={isEnabled(c.id)}
            onTogglePreview={() => toggle(c.id)}
          />
        );
      })}
      <div style={{ marginTop: 8 }}>
        <Link
          href="/channels"
          style={{
            display: "inline-block",
            fontSize: 11,
            color: "var(--text-dim)",
            textDecoration: "none",
          }}
        >
          ⚙ Manage channels
        </Link>
      </div>
    </>
  );
}

function accentFor(c: { id: string; renderMode: string }): string {
  if (c.id === "program") return "var(--accent)";
  if (c.id === "preview") return "var(--accent-2)";
  if (c.renderMode === "matte") return "var(--text-dim)";
  return "#4ade80";
}
