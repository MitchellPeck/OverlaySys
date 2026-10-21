"use client";

import {
  MAX_STT_CHANNELS,
  MAX_STT_GAIN_DB,
  type SttInputDevice,
  type SttSpawnerConfig,
} from "@overlaysys/core";
import { Button, Field, Select, colors, radius } from "@overlaysys/ui";
import { useEffect } from "react";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";
import { channelSelectProblem, toggleChannel } from "@/lib/sttChannels";

type Props = {
  draft: SttSpawnerConfig;
  setDraft: (next: SttSpawnerConfig) => void;
  inputDevices: SttInputDevice[] | null;
  disabled: boolean;
  serverBinaryMissing: boolean;
};

/**
 * Capture-mode switch plus, in channel-select mode, the device / channel
 * pickers and a live level meter. macOS only — the page hides this when the
 * server sends no input-device list.
 */
export function CaptureModeField({ draft, setDraft, disabled }: Pick<Props, "draft" | "setDraft" | "disabled">) {
  const channelMode = draft.captureMode === "channels";
  return (
    <Field
      label="Capture"
      hint={
        channelMode
          ? "Records only the channels you pick and mixes them to mono — for multichannel interfaces."
          : "whisper-stream on one input. Use Channel select if your vocals aren't on channel 1."
      }
    >
      <div style={{ display: "flex", gap: 6 }}>
        <Button
          size="sm"
          variant={channelMode ? "secondary" : "primary"}
          disabled={disabled}
          onClick={() => setDraft({ ...draft, captureMode: "default" })}
        >
          Default
        </Button>
        <Button
          size="sm"
          variant={channelMode ? "primary" : "secondary"}
          disabled={disabled}
          onClick={() => setDraft({ ...draft, captureMode: "channels" })}
        >
          Channel select
        </Button>
      </div>
    </Field>
  );
}

export function ChannelSelectFields({
  draft,
  setDraft,
  inputDevices,
  disabled,
  serverBinaryMissing,
}: Props) {
  const devices = inputDevices ?? [];
  const device = devices.find((d) => d.name === draft.channelDevice);
  const problem = channelSelectProblem(draft, inputDevices);
  const channelCount = device?.channels ?? 0;

  return (
    <>
      {serverBinaryMissing && (
        <div
          style={{
            padding: 8,
            marginBottom: 8,
            fontSize: 12,
            border: `1px solid ${colors.border}`,
            borderLeft: `3px solid ${colors.warn}`,
            borderRadius: radius.md,
          }}
        >
          Channel select needs whisper-server, which comes with the same Homebrew
          package as whisper-stream (<code>brew install whisper-cpp</code>).
        </div>
      )}

      <Field label="Input device" hint="Listed by name, with each device's input channel count.">
        <Select
          value={draft.channelDevice}
          disabled={disabled}
          onChange={(e) => {
            const name = e.target.value;
            const next = devices.find((d) => d.name === name);
            // Drop channels the new device doesn't have.
            const channels = next
              ? draft.channels.filter((c) => c <= next.channels)
              : draft.channels;
            setDraft({ ...draft, channelDevice: name, channels });
          }}
        >
          <option value="">Choose a device…</option>
          {devices.map((d) => (
            <option key={d.name} value={d.name}>
              {d.name} — {d.channels} ch
            </option>
          ))}
          {draft.channelDevice && !device && (
            <option value={draft.channelDevice}>{draft.channelDevice} (not connected)</option>
          )}
        </Select>
      </Field>

      {channelCount > 0 && (
        <Field
          label={`Channels (${draft.channels.length} of up to ${MAX_STT_CHANNELS})`}
          hint="Picked channels are averaged into one mono feed for transcription."
          error={problem ?? undefined}
        >
          <div
            role="group"
            aria-label="Input channels"
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(36px, 1fr))",
              gap: 4,
            }}
          >
            {Array.from({ length: channelCount }, (_, i) => i + 1).map((ch) => {
              const on = draft.channels.includes(ch);
              const full = !on && draft.channels.length >= MAX_STT_CHANNELS;
              return (
                <button
                  key={ch}
                  type="button"
                  aria-pressed={on}
                  disabled={disabled || full}
                  onClick={() => setDraft({ ...draft, channels: toggleChannel(draft.channels, ch) })}
                  style={{
                    height: 30,
                    borderRadius: radius.sm,
                    border: `1px solid ${on ? colors.brand : colors.border}`,
                    background: on ? colors.brandSubtle : colors.surface2,
                    color: on ? colors.text : full ? colors.textMuted : colors.textDim,
                    fontWeight: on ? 600 : 400,
                    fontSize: 12,
                    cursor: disabled || full ? "default" : "pointer",
                  }}
                >
                  {ch}
                </button>
              );
            })}
          </div>
        </Field>
      )}
      {channelCount === 0 && problem && (
        <div style={{ fontSize: 12, color: colors.textDim, marginTop: -4, marginBottom: 8 }}>{problem}</div>
      )}

      <Field
        label={`Boost (+${draft.channelGainDb} dB)`}
        hint="Raise until normal talking from where people stand fills the meter past the gate mark. Save, then restart STT."
      >
        <input
          type="range"
          min={0}
          max={MAX_STT_GAIN_DB}
          step={1}
          value={draft.channelGainDb}
          disabled={disabled}
          aria-label="Boost in dB"
          onChange={(e) => setDraft({ ...draft, channelGainDb: Number(e.target.value) })}
          style={{ width: "100%" }}
        />
      </Field>

      <LevelMeter picked={draft.channels} />
    </>
  );
}

const METER_RANGE_DB = 60;
// Mirrors SILENCE_GATE_DB in apps/lyric-listener/src/channelLib.mjs: audio
// that never gets past this isn't transcribed.
const GATE_DB = -55;
const GATE_FILL = `${((GATE_DB + METER_RANGE_DB) / METER_RANGE_DB) * 100}%`;

/**
 * One bar per channel, live while channel-select STT is running. While
 * running, bars follow the RUNNING capture's channels (an unsaved edit to the
 * picker doesn't relabel them); otherwise they preview the picked channels.
 */
function LevelMeter({ picked }: { picked: number[] }) {
  const { send } = useWs();
  const conn = useStore((s) => s.conn);
  const { levels, channels: running } = useStore((s) => s.sttLevels);

  // Ask for meter updates only while this is on screen.
  useEffect(() => {
    if (conn !== "open") return;
    send({ type: "stt_levels_subscribe", on: true });
    return () => send({ type: "stt_levels_subscribe", on: false });
  }, [conn, send]);

  const live = levels.length > 0;
  const channels = live ? running : picked;
  if (channels.length === 0) return null;
  return (
    <Field
      label="Level"
      hint={live ? "Peak level per channel of the running capture." : "Shows live levels while STT is running."}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {channels.map((ch, i) => {
          const peak = live ? Math.min(1, levels[i] ?? 0) : 0;
          // dB scale over the bottom 60 dB, like a mixer meter, so a quiet
          // mic (-35 dB) reads as signal rather than an empty bar.
          const db = peak > 0 ? 20 * Math.log10(peak) : -Infinity;
          const fill = Math.max(0, Math.min(1, (db + METER_RANGE_DB) / METER_RANGE_DB));
          const width = `${Math.round(fill * 100)}%`;
          const color = db > -3 ? colors.danger : db > -12 ? colors.warn : colors.ok;
          return (
            <div key={ch} style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 44, fontSize: 11, color: colors.textDim }}>Ch {ch}</span>
              <span style={{ width: 52, fontSize: 11, color: colors.textDim, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {live ? (db > -METER_RANGE_DB ? `${db.toFixed(0)} dB` : "—") : ""}
              </span>
              <div
                style={{
                  flex: 1,
                  height: 8,
                  borderRadius: 4,
                  background: colors.surface2,
                  border: `1px solid ${colors.border}`,
                  overflow: "hidden",
                  position: "relative",
                }}
              >
                <div style={{ width, height: "100%", background: color, transition: "width 80ms linear" }} />
                <div
                  title={`Gate: quieter than ${GATE_DB} dB is ignored`}
                  style={{ position: "absolute", top: 0, bottom: 0, left: GATE_FILL, width: 1, background: colors.textDim }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </Field>
  );
}
