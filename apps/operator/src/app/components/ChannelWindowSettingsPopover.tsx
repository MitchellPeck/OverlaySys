"use client";

import { useEffect, useState } from "react";
import type {
  CachedDisplay,
  ChannelWindowPrefs,
  WindowPrefsFile,
} from "@overlaysys/core";
import { colors, radius } from "@overlaysys/ui";
import { getDesktopApi } from "@/lib/desktop";

const DEFAULT_PREFS: ChannelWindowPrefs = {
  autoOpen: false,
  displayId: undefined,
  fullscreen: false,
  frameless: false,
  alwaysOnTop: false,
  transparent: false,
};

export function ChannelWindowSettingsPopover({
  channelId,
  onClose,
}: {
  channelId: string;
  onClose: () => void;
}) {
  const api = getDesktopApi();
  const [displays, setDisplays] = useState<CachedDisplay[]>([]);
  const [prefs, setPrefs] = useState<ChannelWindowPrefs>(DEFAULT_PREFS);
  const [file, setFile] = useState<WindowPrefsFile | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!api) return;
    void (async () => {
      const [d, f] = await Promise.all([
        api.getDisplays(),
        api.getChannelWindowPrefs(),
      ]);
      setDisplays(d);
      setFile(f);
      const existing = f.channels[channelId];
      if (existing) setPrefs(existing);
    })();
  }, [api, channelId]);

  if (!api) return null;

  const configuredButMissing =
    prefs.displayId !== undefined &&
    !displays.some((d) => d.id === prefs.displayId);
  const cachedConfigured =
    configuredButMissing && file
      ? file.displays.find((d) => d.id === prefs.displayId) ?? null
      : null;

  const update = <K extends keyof ChannelWindowPrefs>(
    key: K,
    value: ChannelWindowPrefs[K],
  ) => {
    setPrefs((p) => ({ ...p, [key]: value }));
    setDirty(true);
  };

  const onSave = async () => {
    await api.setChannelWindowPrefs(channelId, prefs);
    setDirty(false);
    onClose();
  };

  return (
    <div
      role="dialog"
      style={{
        position: "absolute",
        right: 0,
        top: 28,
        zIndex: 50,
        background: colors.panel2,
        border: `1px solid ${colors.border}`,
        borderRadius: radius.md,
        padding: 12,
        width: 280,
        boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
        fontSize: 12,
        color: colors.text,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Window settings</div>

      <label style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <input
          type="checkbox"
          checked={prefs.autoOpen}
          onChange={(e) => update("autoOpen", e.target.checked)}
        />
        Auto-open at launch
      </label>

      <div style={{ marginBottom: 8 }}>
        <div style={{ color: colors.textDim, marginBottom: 4 }}>Display</div>
        <select
          value={prefs.displayId ?? ""}
          onChange={(e) =>
            update("displayId", e.target.value === "" ? undefined : Number(e.target.value))
          }
          style={{ width: "100%", padding: 4 }}
        >
          <option value="">(none — open on primary)</option>
          {displays.map((d, i) => (
            <option key={d.id} value={d.id}>
              {i + 1}. {d.label || `Display ${i + 1}`} ({d.bounds.width}×{d.bounds.height}
              {d.internal ? ", internal" : ""})
            </option>
          ))}
          {cachedConfigured && (
            <option value={cachedConfigured.id}>
              {cachedConfigured.label} ⚠ not attached
            </option>
          )}
        </select>
        <button
          onClick={() => api.identifyDisplays()}
          style={{
            marginTop: 4,
            background: "transparent",
            color: colors.textDim,
            border: `1px solid ${colors.border}`,
            borderRadius: radius.sm,
            padding: "2px 6px",
            cursor: "pointer",
            fontSize: 11,
          }}
        >
          Identify displays
        </button>
      </div>

      {(
        [
          ["fullscreen", "Fullscreen"],
          ["frameless", "Frameless"],
          ["alwaysOnTop", "Always on top"],
          ["transparent", "Transparent"],
        ] as const
      ).map(([key, label]) => (
        <label
          key={key}
          style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}
        >
          <input
            type="checkbox"
            checked={prefs[key]}
            onChange={(e) => update(key, e.target.checked)}
          />
          {label}
        </label>
      ))}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 10 }}>
        <button
          onClick={onClose}
          style={{
            background: "transparent",
            color: colors.textDim,
            border: `1px solid ${colors.border}`,
            borderRadius: radius.sm,
            padding: "4px 10px",
            cursor: "pointer",
          }}
        >
          Cancel
        </button>
        <button
          onClick={onSave}
          disabled={!dirty}
          style={{
            background: dirty ? colors.accent : "transparent",
            color: dirty ? "#000" : colors.textDim,
            border: `1px solid ${colors.border}`,
            borderRadius: radius.sm,
            padding: "4px 10px",
            cursor: dirty ? "pointer" : "default",
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
}
