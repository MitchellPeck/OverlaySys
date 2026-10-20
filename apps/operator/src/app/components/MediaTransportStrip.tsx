"use client";

import { useEffect, useRef, useState } from "react";
import type { ChannelMedia } from "@overlaysys/core";
import { Film, Play } from "lucide-react";
import { Button, colors, radius } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";
import { formatClock } from "@/lib/mediaTake";
import { displayStatus, displayTime, type MediaDisplayStatus } from "@/lib/mediaTime";

const STATUS_LABEL: Record<MediaDisplayStatus, string> = {
  loading: "Loading",
  playing: "Playing",
  paused: "Paused",
  ended: "Ended",
  error: "Error",
  "no-renderer": "No renderer reporting",
};

const STATUS_COLOR: Record<MediaDisplayStatus, string> = {
  loading: colors.textDim,
  playing: "#3ccf6e",
  paused: "#f0b429",
  ended: colors.textDim,
  error: colors.red,
  "no-renderer": colors.red,
};

/**
 * Transport for every channel currently holding media. Shown regardless of
 * the selected rundown row so Stop is always one click away. Lists every
 * channel present in `channelStates`, so media on a non-default channel shows
 * up as soon as the operator is subscribed to it.
 */
export function MediaTransportStrip({ inline = false }: { inline?: boolean } = {}) {
  const channelStates = useStore((s) => s.channelStates);
  const entries = Object.values(channelStates).filter(
    (s): s is typeof s & { media: ChannelMedia } => !!s.media,
  );
  if (entries.length === 0) return null;
  return (
    <div
      style={
        inline
          ? { display: "flex", gap: 8, alignItems: "stretch", minWidth: 0 }
          : { display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }
      }
    >
      {entries.map((s) => (
        <div key={s.channel} style={inline ? { width: 360, flexShrink: 0 } : undefined}>
          <ChannelTransport channel={s.channel} media={s.media} />
        </div>
      ))}
    </div>
  );
}

function ChannelTransport({ channel, media }: { channel: string; media: ChannelMedia }) {
  const { send } = useWs();
  const heardAt = useStore((s) => s.mediaHeardAt[channel] ?? 0);
  const [now, setNow] = useState(() => Date.now());
  const [scrub, setScrub] = useState<number | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, []);

  const status = displayStatus(media, heardAt, now);
  const t = displayTime(media, heardAt, now);
  const duration = media.playback.duration;
  const fraction = scrub ?? t.fraction;
  const control = (action: "play" | "pause" | "restart" | "seek", time?: number) =>
    send({ type: "media_control", channel, takenAt: media.takenAt, action, ...(time !== undefined ? { time } : {}) });

  const fractionAt = (clientX: number) => {
    const r = barRef.current?.getBoundingClientRect();
    if (!r || r.width === 0) return 0;
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width));
  };

  return (
    <div
      style={{
        border: `1px solid ${colors.border}`,
        borderRadius: radius.md,
        padding: 10,
        background: colors.panel2,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <Film size={14} aria-hidden />
        <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {media.label || "Video"}
        </span>
        <span style={{ fontSize: 11, color: colors.textDim }}>{channel}</span>
        <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 600, color: STATUS_COLOR[status] }}>
          ● {STATUS_LABEL[status]}
        </span>
      </div>

      <div
        ref={barRef}
        role="slider"
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration)}
        aria-valuenow={Math.round(t.elapsed)}
        onPointerDown={(e) => {
          if (duration <= 0) return;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          setScrub(fractionAt(e.clientX));
        }}
        onPointerMove={(e) => {
          if (scrub !== null) setScrub(fractionAt(e.clientX));
        }}
        onPointerUp={(e) => {
          if (scrub === null) return;
          control("seek", fractionAt(e.clientX) * duration);
          setScrub(null);
        }}
        style={{
          height: 10,
          borderRadius: 5,
          background: colors.border,
          cursor: duration > 0 ? "pointer" : "default",
          position: "relative",
          touchAction: "none",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            width: `${fraction * 100}%`,
            borderRadius: 5,
            background: colors.accent,
          }}
        />
      </div>

      <div style={{ display: "flex", alignItems: "baseline", marginTop: 6, gap: 8 }}>
        <span style={{ fontSize: 12, color: colors.textDim, fontVariantNumeric: "tabular-nums" }}>
          {formatClock(scrub !== null ? scrub * duration : t.elapsed)} / {duration > 0 ? formatClock(duration) : "–:––"}
        </span>
        <span
          style={{ marginLeft: "auto", fontSize: 22, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}
          title="Time remaining"
        >
          -{formatClock(t.remaining)}
        </span>
      </div>

      {media.playback.error && (
        <div style={{ marginTop: 6, fontSize: 11, color: colors.red }}>{media.playback.error}</div>
      )}

      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        {media.paused ? (
          <Button size="sm" onClick={() => control("play")} style={{ flex: 1 }}><Play size={14} aria-hidden style={{ verticalAlign: "-2px" }} /> Play</Button>
        ) : (
          <Button size="sm" onClick={() => control("pause")} style={{ flex: 1 }}>❚❚ Pause</Button>
        )}
        <Button size="sm" onClick={() => control("restart")} style={{ flex: 1 }}>⟲ Restart</Button>
        <Button
          size="sm"
          variant="danger"
          onClick={() => send({ type: "media_clear", channel })}
          style={{ flex: 1 }}
        >
          ■ Stop
        </Button>
      </div>
    </div>
  );
}
