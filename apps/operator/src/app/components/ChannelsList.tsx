"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { colors } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";
import { useResolvedChannelConfigs } from "@/lib/useResolvedChannels";
import { ChannelStatus } from "./ChannelStatus";

const PREVIEW_ENABLED_KEY = "overlaysys:channelPreviewEnabled";

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
  const { send } = useWs();
  const channels = useResolvedChannelConfigs();
  const channelStates = useStore((s) => s.channelStates);
  const [enabledMap, setEnabledMap] = useState<EnabledMap>(() => loadEnabled());

  function clearChannel(id: string): void {
    send({ type: "clear", channel: id });
  }

  useEffect(() => {
    saveEnabled(enabledMap);
  }, [enabledMap]);

  function isEnabled(id: string): boolean {
    return enabledMap[id] ?? true;
  }
  function toggle(id: string) {
    setEnabledMap((cur) => ({ ...cur, [id]: !isEnabled(id) }));
  }

  if (channels.length === 0) {
    return (
      <div style={{ color: colors.textDim, fontSize: 12 }}>
        No channels configured.{" "}
        <Link href="/channels" style={{ color: colors.accent2 }}>
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
                href={`http://localhost:3001/?channel=${encodeURIComponent(c.id)}`}
                config={c}
                previewEnabled={isEnabled(c.id)}
                onTogglePreview={() => toggle(c.id)}
                // Mirrors reflect their source — clearing the mirror is a
                // no-op since the renderer subscribes to the source's state.
                // Hide the Clear control on mirrors to avoid the confusion.
                onClear={c.mirrorOf ? undefined : () => clearChannel(c.id)}
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
            href={`http://localhost:3001/?channel=${encodeURIComponent(c.id)}`}
            config={c}
            previewEnabled={isEnabled(c.id)}
            onTogglePreview={() => toggle(c.id)}
            onClear={c.mirrorOf ? undefined : () => clearChannel(c.id)}
          />
        );
      })}
      <div style={{ marginTop: 8 }}>
        <Link
          href="/channels"
          style={{
            display: "inline-block",
            fontSize: 11,
            color: colors.textDim,
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
  // Hot-path accent picks — must stay in sync with the dot color in
  // ChannelStatus's left badge. Program red, preview amber, matte dim,
  // everything else green.
  if (c.id === "program") return colors.accent;
  if (c.id === "preview") return colors.accent2;
  if (c.renderMode === "matte") return colors.textDim;
  return colors.green;
}
