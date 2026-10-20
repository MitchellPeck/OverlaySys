"use client";

import { useCallback, useEffect, useState } from "react";
import type { ChannelConfig } from "@overlaysys/core";
import { getDesktopApi, isElectron } from "@/lib/desktop";

export function useChannelWindowPrefs(config: ChannelConfig | undefined) {
  const [hasPrefs, setHasPrefs] = useState(false);
  const [fallbackWarning, setFallbackWarning] = useState<{
    configuredLabel: string | null;
    actualLabel: string;
  } | null>(null);

  const refresh = useCallback(async () => {
    if (!isElectron() || !config) return;
    const api = getDesktopApi();
    if (!api) return;
    const [prefsFile, resolutions] = await Promise.all([
      api.getChannelWindowPrefs(),
      api.getChannelWindowResolutions(),
    ]);
    setHasPrefs(!!prefsFile.channels[config.id]);
    const r = resolutions[config.id];
    setFallbackWarning(
      r && r.matchedBy === "fallback" && r.configuredLabel
        ? { configuredLabel: r.configuredLabel, actualLabel: r.actualLabel }
        : null,
    );
  }, [config]);

  useEffect(() => {
    if (!isElectron() || !config) return;
    const api = getDesktopApi();
    if (!api) return;
    void refresh();
    const offOpened = api.onChannelWindowOpened(() => void refresh());
    const offClosed = api.onChannelWindowClosed(() => void refresh());
    return () => {
      offOpened();
      offClosed();
    };
  }, [config, refresh]);

  return { hasPrefs, fallbackWarning, refresh };
}
