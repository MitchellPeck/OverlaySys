"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  CachedDisplay,
  ChannelWindowPrefs,
  WindowPrefsFile,
} from "@overlaysys/core";
import { colors, radius } from "@overlaysys/ui";
import { getDesktopApi } from "@/lib/desktop";
import { POPOVER_W, popoverPosition } from "@/lib/popoverPosition";

const DEFAULT_PREFS: ChannelWindowPrefs = {
  autoOpen: false,
  displayId: undefined,
  fullscreen: false,
  frameless: false,
  alwaysOnTop: false,
  transparent: false,
  audioOutput: undefined,
};

export function ChannelWindowSettingsPopover({
  channelId,
  anchorEl,
  onClose,
  onSaved,
}: {
  channelId: string;
  /** Element the popover hangs from. The popover renders in a portal so
   *  narrow, overflow-clipped panels can't cut it off. */
  anchorEl: HTMLElement | null;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const api = getDesktopApi();
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    if (!anchorEl) return;
    const place = () => {
      const r = anchorEl.getBoundingClientRect();
      const h = popoverRef.current?.offsetHeight ?? 0;
      setPos(popoverPosition(r, h, { width: window.innerWidth, height: window.innerHeight }));
    };
    place();
    // Re-place when the content height changes (device list loads) or the
    // layout moves under us.
    const ro = new ResizeObserver(place);
    if (popoverRef.current) ro.observe(popoverRef.current);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [anchorEl]);
  // Esc closes the popover and must not reach the window-level "clear
  // program" shortcut, so intercept it in the capture phase. Other keys
  // pressed inside the popover are stopped in the document bubble phase so
  // Enter/Space on a focused control don't cue/take the rundown selection
  // (no preventDefault, so the control itself still activates).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      e.preventDefault();
      onClose();
    }
    function onKeyInside(e: KeyboardEvent) {
      if (popoverRef.current?.contains(e.target as Node)) e.stopPropagation();
    }
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("keydown", onKeyInside);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("keydown", onKeyInside);
    };
  }, [onClose]);
  const [displays, setDisplays] = useState<CachedDisplay[]>([]);
  const [prefs, setPrefs] = useState<ChannelWindowPrefs>(DEFAULT_PREFS);
  const [file, setFile] = useState<WindowPrefsFile | null>(null);
  const [dirty, setDirty] = useState(false);
  const [audioDevices, setAudioDevices] = useState<{ deviceId: string; label: string }[]>([]);
  const [savedAudio, setSavedAudio] = useState<ChannelWindowPrefs["audioOutput"]>(undefined);

  useEffect(() => {
    if (!api) return;
    void (async () => {
      const list = async () =>
        (await navigator.mediaDevices.enumerateDevices())
          .filter((d) => d.kind === "audiooutput" && d.deviceId !== "default" && d.deviceId !== "communications");
      let outs = await list();
      // Chromium hides labels until a media permission has been granted once.
      if (outs.length > 0 && outs.every((d) => !d.label)) {
        try {
          const s = await navigator.mediaDevices.getUserMedia({ audio: true });
          for (const t of s.getTracks()) t.stop();
          outs = await list();
        } catch {
          // Leave unlabeled; ids still work.
        }
      }
      setAudioDevices(outs.map((d) => ({ deviceId: d.deviceId, label: d.label || d.deviceId })));
    })();
  }, [api]);

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
      setSavedAudio(existing?.audioOutput);
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
    // The renderer reads its audio device from the URL, so an open window
    // must be reopened for a change to take effect. It rejoins mid-video
    // from the server's last reported position.
    const audioChanged =
      (savedAudio?.deviceId ?? "") !== (prefs.audioOutput?.deviceId ?? "");
    if (audioChanged) {
      const open = await api.listChannelWindows();
      if (open.includes(channelId)) await api.reopenChannelOnConfiguredDisplay(channelId);
    }
    setSavedAudio(prefs.audioOutput);
    setDirty(false);
    onSaved?.();
    onClose();
  };

  return createPortal(
    <div
      ref={popoverRef}
      role="dialog"
      style={{
        position: "fixed",
        left: pos?.left ?? 0,
        top: pos?.top ?? 0,
        // Hidden until measured so it never flashes at the wrong spot.
        visibility: pos ? "visible" : "hidden",
        zIndex: 1000,
        boxSizing: "border-box",
        background: colors.panel2,
        border: `1px solid ${colors.border}`,
        borderRadius: radius.md,
        padding: 12,
        width: POPOVER_W,
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
              {cachedConfigured.label} (not attached)
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

      <div style={{ marginBottom: 8 }}>
        <div style={{ color: colors.textDim, marginBottom: 4 }}>Audio output (video rows)</div>
        <select
          value={prefs.audioOutput?.deviceId ?? ""}
          onChange={(e) => {
            const id = e.target.value;
            if (id === "") return update("audioOutput", undefined);
            const d = audioDevices.find((x) => x.deviceId === id) ?? prefs.audioOutput;
            update("audioOutput", d ? { deviceId: d.deviceId, label: d.label } : undefined);
          }}
          style={{ width: "100%", padding: 4 }}
        >
          <option value="">System default</option>
          {audioDevices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>{d.label}</option>
          ))}
          {prefs.audioOutput &&
            !audioDevices.some(
              (d) => d.deviceId === prefs.audioOutput!.deviceId || d.label === prefs.audioOutput!.label,
            ) && (
              <option value={prefs.audioOutput.deviceId}>
                {prefs.audioOutput.label} (not connected)
              </option>
            )}
        </select>
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
    </div>,
    document.body,
  );
}
