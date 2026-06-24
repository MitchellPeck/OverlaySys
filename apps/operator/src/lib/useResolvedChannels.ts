"use client";

import { useMemo } from "react";
import {
  resolveProjectChannels,
  type ChannelConfig,
  type ProjectChannelOverride,
} from "@overlaysys/core";
import { useStore } from "./store";

/**
 * Channel-list reader with the active project's overrides applied.
 *
 * Every operator component that needs to display channels — TakePanel's
 * channel dropdown, ChannelsList in the show page, channel selectors in
 * show/song/template/hotcard editors — should read through this hook so
 * a project override (e.g. "rename channel `program` to `Sunday PGM`
 * for this project") actually surfaces in the picker, not just on
 * `/channels`.
 *
 * The base channel config list is the canonical source — only the
 * `/channels` page itself should read it directly, because that's the
 * surface where you EDIT the base + per-project overrides separately.
 *
 * Resolution semantics live in `channelResolution.ts`; this hook is the
 * thin glue between the engine's pure resolver and React state.
 */
export function useResolvedChannelConfigs(): ChannelConfig[] {
  const channels = useStore((s) => s.channelConfigs);
  const overrides = useStore((s) => s.projectChannelOverrides);
  const currentProjectId = useStore((s) => s.currentProjectId);

  return useMemo(() => {
    const list = Object.values(overrides) as ProjectChannelOverride[];
    return resolveProjectChannels(channels, list, currentProjectId);
  }, [channels, overrides, currentProjectId]);
}
