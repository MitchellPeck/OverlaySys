"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  CachedDisplay,
  ChannelWindowPrefs,
  WindowPrefsFile,
} from "@overlaysys/core";
import { Button, Checkbox, Select, colors, radius } from "@overlaysys/ui";
import { getDesktopApi } from "@/lib/desktop";
import { POPOVER_W, popoverPosition } from "@/lib/popoverPosition";
import { applyOutputChoice, outputChoiceValue } from "@/lib/decklinkOutputChoice";
import { SIGNAL_FORMATS } from "@overlaysys/core";

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
  const [savedOutput, setSavedOutput] = useState<string>("");
  const [savedFormat, setSavedFormat] = useState<string | undefined>(undefined);
  // Blackmagic devices the configured ffmpeg sees; null while loading.
  const [deckLinks, setDeckLinks] = useState<string[] | null>(null);
  const [deckLinkError, setDeckLinkError] = useState<string | null>(null);

  useEffect(() => {
    if (!api?.decklinkListDevices) return;
    void api.decklinkListDevices().then((r) => {
      setDeckLinks(r.ok ? r.devices : []);
      setDeckLinkError(r.ok ? null : r.message);
    });
  }, [api]);

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
      setSavedOutput(existing ? outputChoiceValue(existing) : "display:");
      setSavedFormat(existing?.decklink?.format);
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
    // Switching between a display and a Blackmagic device (or its format)
    // also needs the output reopened.
    const outputChanged =
      savedOutput !== outputChoiceValue(prefs) || savedFormat !== prefs.decklink?.format;
    if (audioChanged || outputChanged) {
      const open = await api.listChannelWindows();
      if (open.includes(channelId)) await api.reopenChannelOnConfiguredDisplay(channelId);
    }
    setSavedAudio(prefs.audioOutput);
    setSavedOutput(outputChoiceValue(prefs));
    setSavedFormat(prefs.decklink?.format);
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

      <div style={{ marginBottom: 8 }}>
        <Checkbox checked={prefs.autoOpen} onChange={(v) => update("autoOpen", v)} label="Auto-open at launch" />
      </div>

      <div style={{ marginBottom: 8 }}>
        <div style={{ color: colors.textDim, marginBottom: 4 }}>Output</div>
        <Select
          value={outputChoiceValue(prefs)}
          onChange={(e) => {
            setPrefs((p) => applyOutputChoice(p, e.target.value));
            setDirty(true);
          }}
        >
          <optgroup label="Displays">
            <option value="display:">(none — open on primary)</option>
            {displays.map((d, i) => (
              <option key={d.id} value={`display:${d.id}`}>
                {i + 1}. {d.label || `Display ${i + 1}`} ({d.bounds.width}×{d.bounds.height}
                {d.internal ? ", internal" : ""})
              </option>
            ))}
            {cachedConfigured && (
              <option value={`display:${cachedConfigured.id}`}>
                {cachedConfigured.label} (not attached)
              </option>
            )}
          </optgroup>
          {(!!deckLinks?.length || !!prefs.decklink) && (
            <optgroup label="Blackmagic">
              {(deckLinks ?? []).map((name) => (
                <option key={name} value={`decklink:${name}`}>
                  {name}
                </option>
              ))}
              {prefs.decklink && !(deckLinks ?? []).includes(prefs.decklink.device.name) && (
                <option value={`decklink:${prefs.decklink.device.name}`}>
                  {prefs.decklink.device.name} {deckLinks === null ? "" : "(not connected)"}
                </option>
              )}
            </optgroup>
          )}
        </Select>
        {deckLinkError && prefs.decklink && (
          <div style={{ color: colors.textDim, marginTop: 4 }}>{deckLinkError}</div>
        )}
        {prefs.decklink && (
          <div style={{ marginTop: 8 }}>
            <div style={{ color: colors.textDim, marginBottom: 4 }}>Signal format</div>
            <Select
              value={prefs.decklink.format}
              onChange={(e) => {
                const format = e.target.value;
                setPrefs((p) => (p.decklink ? { ...p, decklink: { ...p.decklink, format } } : p));
                setDirty(true);
              }}
            >
              {SIGNAL_FORMATS.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </Select>
          </div>
        )}
        {!prefs.decklink && (
          <Button size="sm" variant="ghost" onClick={() => api.identifyDisplays()} style={{ marginTop: 4 }}>
            Identify displays
          </Button>
        )}
      </div>

      <div style={{ marginBottom: 8 }}>
        <div style={{ color: colors.textDim, marginBottom: 4 }}>Audio output (video rows)</div>
        <Select
          value={prefs.audioOutput?.deviceId ?? ""}
          onChange={(e) => {
            const id = e.target.value;
            if (id === "") return update("audioOutput", undefined);
            const d = audioDevices.find((x) => x.deviceId === id) ?? prefs.audioOutput;
            update("audioOutput", d ? { deviceId: d.deviceId, label: d.label } : undefined);
          }}
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
        </Select>
      </div>

      {!prefs.decklink &&
        (
        [
          ["fullscreen", "Fullscreen"],
          ["frameless", "Frameless"],
          ["alwaysOnTop", "Always on top"],
          ["transparent", "Transparent"],
        ] as const
      ).map(([key, label]) => (
        <div key={key} style={{ marginBottom: 4 }}>
          <Checkbox checked={prefs[key]} onChange={(v) => update(key, v)} label={label} />
        </div>
      ))}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 10 }}>
        <Button size="sm" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" onClick={onSave} disabled={!dirty}>
          Save
        </Button>
      </div>
    </div>,
    document.body,
  );
}
