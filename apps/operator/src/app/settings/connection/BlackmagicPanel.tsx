"use client";

import { useEffect, useState } from "react";
import { Button, Input, Panel, colors, fontFamily, fontSize } from "@overlaysys/ui";
import { getDesktopApi, type DeckLinkCheckResult } from "@/lib/desktop";

const DEFAULT_PATH = "~/.local/bin/ffmpeg-decklink";

/**
 * Desktop only: where the Blackmagic-enabled ffmpeg lives, and a Check that
 * shows what it sees. Channels are sent to a device from their window
 * settings; this is the one machine-wide setting.
 */
export function BlackmagicPanel() {
  const api = getDesktopApi();
  const [path, setPath] = useState("");
  const [saved, setSaved] = useState("");
  const [result, setResult] = useState<DeckLinkCheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [pathError, setPathError] = useState<string | null>(null);

  useEffect(() => {
    if (!api) return;
    void api.getChannelWindowPrefs().then((f) => {
      setPath(f.decklinkFfmpegPath ?? "");
      setSaved(f.decklinkFfmpegPath ?? "");
    });
  }, [api]);

  if (!api?.decklinkCheck || !api.setDecklinkFfmpegPath) return null;

  const check = async () => {
    setChecking(true);
    setPathError(null);
    try {
      if (path.trim() !== saved.trim()) {
        const file = await api.setDecklinkFfmpegPath!(path);
        // Saved as the full path (a leading ~ expanded).
        setPath(file.decklinkFfmpegPath ?? "");
        setSaved(file.decklinkFfmpegPath ?? "");
      }
      setResult(await api.decklinkCheck!());
    } catch (err) {
      // Electron wraps a refused path as "Error invoking remote method '…': Error: <reason>".
      const message = err instanceof Error ? err.message : String(err);
      setPathError(message.replace(/^Error invoking remote method '[^']*': (Error: )?/, ""));
      setResult(null);
    } finally {
      setChecking(false);
    }
  };

  return (
    <Panel title="Blackmagic output" padding="md">
      <p style={{ color: colors.textDim, fontSize: fontSize.sm, margin: "0 0 8px" }}>
        Send a channel to a Blackmagic device (UltraStudio, DeckLink) from its window settings. This needs an
        ffmpeg built with Blackmagic support — the one Narthex TV&apos;s build script installs.
      </p>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <Input
          aria-label="Blackmagic ffmpeg path"
          value={path}
          placeholder={DEFAULT_PATH}
          onChange={(e) => setPath(e.target.value)}
          style={{ flex: 1, fontFamily: fontFamily.mono }}
        />
        <Button size="sm" onClick={() => void check()} disabled={checking}>
          {checking ? "Checking…" : path.trim() !== saved.trim() ? "Save and check" : "Check"}
        </Button>
      </div>
      {pathError && <div style={{ marginTop: 8, fontSize: fontSize.sm, color: colors.danger }}>{pathError}</div>}
      {result && (
        <div style={{ marginTop: 8, fontSize: fontSize.sm }}>
          {result.version && <div style={{ color: colors.textDim, fontFamily: fontFamily.mono }}>{result.version}</div>}
          {result.ok ? (
            result.devices.length ? (
              <div>Devices: {result.devices.join(", ")}</div>
            ) : (
              <div style={{ color: colors.textDim }}>No Blackmagic devices found. Check Desktop Video Setup sees the card.</div>
            )
          ) : (
            <div style={{ color: colors.danger }}>{result.message}</div>
          )}
        </div>
      )}
    </Panel>
  );
}
