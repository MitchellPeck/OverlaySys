"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { ChannelMedia } from "@overlaysys/core";
import { Film, Pause, Play, RotateCcw, Scissors, Square } from "lucide-react";
import { Button, StatusDot, colors, radius, type PillTone } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";
import { formatClock, seekTargetForKey } from "@/lib/mediaTake";
import { displayStatus, displayTime, remainingTone, type MediaDisplayStatus, type RemainingTone } from "@/lib/mediaTime";

const STATUS_LABEL: Record<MediaDisplayStatus, string> = {
  loading: "Loading",
  playing: "Playing",
  paused: "Paused",
  ended: "Ended",
  error: "Error",
  "no-renderer": "No renderer reporting",
};

const STATUS_TONE: Record<MediaDisplayStatus, PillTone> = {
  loading: "dim",
  playing: "good",
  paused: "warn",
  ended: "dim",
  error: "bad",
  "no-renderer": "bad",
};

const ICON_STYLE: CSSProperties = { verticalAlign: "-2px" };

/**
 * Transport for every channel currently holding media. Shown regardless of
 * the selected rundown row so Stop is always one click away. Lists every
 * channel present in `channelStates`, so media on a non-default channel shows
 * up as soon as the operator is subscribed to it.
 *
 * `inline` renders each channel as a compact single row (≤ 32px tall) so the
 * console's bottom bar stays one stable 40px row while a video plays.
 */
export function MediaTransportStrip({ inline = false }: { inline?: boolean } = {}) {
  const channelStates = useStore((s) => s.channelStates);
  const entries = Object.values(channelStates).filter(
    (s): s is typeof s & { media: ChannelMedia } => !!s.media,
  );
  if (entries.length === 0) return null;
  if (inline) {
    return (
      <div style={{ display: "flex", gap: 12, alignItems: "center", minWidth: 0, overflowX: "auto" }}>
        {entries.map((s) => (
          <CompactTransport key={s.channel} channel={s.channel} media={s.media} />
        ))}
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
      {entries.map((s) => (
        <div key={s.channel}>
          <ChannelTransport channel={s.channel} media={s.media} />
        </div>
      ))}
    </div>
  );
}

/** Clock, status and media_control/media_clear sends shared by both renderings. */
function useChannelTransport(channel: string, media: ChannelMedia) {
  const { send } = useWs();
  const heardAt = useStore((s) => s.mediaHeardAt[channel] ?? 0);
  const [now, setNow] = useState(() => Date.now());
  const [scrub, setScrub] = useState<number | null>(null);

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
  // Stop plays the row's Out transition; Cut clears instantly. A row whose
  // Out is already a cut has no separate Cut button.
  const stop = () => send({ type: "media_clear", channel });
  const cut = () => send({ type: "media_clear", channel, cut: true });
  const hasOutTransition = media.transitionOut.style !== "cut";
  const stopTitle = hasOutTransition ? `Stop (${media.transitionOut.style} out)` : "Stop";

  return { status, t, duration, fraction, scrub, setScrub, control, stop, cut, hasOutTransition, stopTitle };
}

type Transport = ReturnType<typeof useChannelTransport>;

/** Amber in the last 15 s, red in the last 5 s, so the next cue isn't a surprise. */
const REMAINING_COLOR: Record<RemainingTone, string | undefined> = {
  normal: undefined,
  warn: colors.warn,
  urgent: colors.danger,
};

function remainingColor(tr: Transport): string | undefined {
  // A paused or held video isn't counting down.
  if (tr.status !== "playing") return undefined;
  return REMAINING_COLOR[remainingTone(tr.t.remaining, tr.duration)];
}

function SeekBar({ tr, height, style }: { tr: Transport; height: number; style?: CSSProperties }) {
  const barRef = useRef<HTMLDivElement | null>(null);
  const { duration, scrub, setScrub, control, t, fraction } = tr;
  const fractionAt = (clientX: number) => {
    const r = barRef.current?.getBoundingClientRect();
    if (!r || r.width === 0) return 0;
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width));
  };
  return (
    <div
      ref={barRef}
      role="slider"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(t.elapsed)}
      aria-valuetext={`${formatClock(t.elapsed)} of ${duration > 0 ? formatClock(duration) : "unknown"}`}
      tabIndex={duration > 0 ? 0 : -1}
      onKeyDown={(e) => {
        const target = seekTargetForKey(e.key, e.shiftKey, t.elapsed, duration);
        if (target === null) return;
        // Handled here: keep ↑/↓ from also moving the rundown selection.
        e.preventDefault();
        control("seek", target);
      }}
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
        height,
        borderRadius: height / 2,
        background: colors.border,
        cursor: duration > 0 ? "pointer" : "default",
        position: "relative",
        touchAction: "none",
        ...style,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          width: `${fraction * 100}%`,
          borderRadius: height / 2,
          background: colors.accent,
        }}
      />
    </div>
  );
}

function elapsedLabel(tr: Transport): string {
  const { scrub, duration, t } = tr;
  return `${formatClock(scrub !== null ? scrub * duration : t.elapsed)} / ${duration > 0 ? formatClock(duration) : "–:––"}`;
}

/** Bottom-bar row: icon + label, status, time, slim scrub bar, icon buttons. */
function CompactTransport({ channel, media }: { channel: string; media: ChannelMedia }) {
  const tr = useChannelTransport(channel, media);
  const iconBtn: CSSProperties = { padding: "4px 6px", lineHeight: 0 };
  return (
    <div
      title={media.playback.error ?? undefined}
      style={{ display: "flex", alignItems: "center", gap: 8, height: 28, maxHeight: 32, flexShrink: 0, whiteSpace: "nowrap" }}
    >
      <Film size={14} aria-hidden />
      <span
        title={`${media.label || "Video"} · ${channel}`}
        style={{ fontWeight: 600, fontSize: 12, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}
      >
        {media.label || "Video"}
      </span>
      <StatusDot tone={STATUS_TONE[tr.status]} label={STATUS_LABEL[tr.status]} />
      <span style={{ fontSize: 12, color: colors.textDim, fontVariantNumeric: "tabular-nums" }}>{elapsedLabel(tr)}</span>
      <SeekBar tr={tr} height={6} style={{ width: 140, flexShrink: 0 }} />
      {/* The number the operator watches before the next cue: big, and amber/red near the end. */}
      <span
        title="Time remaining"
        aria-label={`${formatClock(tr.t.remaining)} remaining`}
        style={{
          fontSize: 20,
          fontWeight: 700,
          lineHeight: 1,
          fontVariantNumeric: "tabular-nums",
          color: remainingColor(tr) ?? colors.text,
          minWidth: 64,
          textAlign: "right",
        }}
      >
        -{tr.duration > 0 ? formatClock(tr.t.remaining) : "–:––"}
      </span>
      {media.paused ? (
        <Button size="sm" onClick={() => tr.control("play")} title="Play" aria-label="Play" style={iconBtn}>
          <Play size={14} aria-hidden />
        </Button>
      ) : (
        <Button size="sm" onClick={() => tr.control("pause")} title="Pause" aria-label="Pause" style={iconBtn}>
          <Pause size={14} aria-hidden />
        </Button>
      )}
      <Button size="sm" onClick={() => tr.control("restart")} title="Restart" aria-label="Restart" style={iconBtn}>
        <RotateCcw size={14} aria-hidden />
      </Button>
      <Button size="sm" variant="danger" onClick={tr.stop} title={tr.stopTitle} aria-label="Stop" style={iconBtn}>
        <Square size={14} aria-hidden />
      </Button>
      {tr.hasOutTransition && (
        <Button size="sm" variant="danger" onClick={tr.cut} title="Cut (clear instantly)" aria-label="Cut" style={iconBtn}>
          <Scissors size={14} aria-hidden />
        </Button>
      )}
    </div>
  );
}

function ChannelTransport({ channel, media }: { channel: string; media: ChannelMedia }) {
  const tr = useChannelTransport(channel, media);
  const { status, t, control } = tr;

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
        <StatusDot tone={STATUS_TONE[status]} label={STATUS_LABEL[status]} style={{ marginLeft: "auto", fontSize: 11 }} />
      </div>

      <SeekBar tr={tr} height={10} />

      <div style={{ display: "flex", alignItems: "baseline", marginTop: 6, gap: 8 }}>
        <span style={{ fontSize: 12, color: colors.textDim, fontVariantNumeric: "tabular-nums" }}>{elapsedLabel(tr)}</span>
        <span
          style={{ marginLeft: "auto", fontSize: 22, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: remainingColor(tr) }}
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
          <Button size="sm" onClick={() => control("play")} style={{ flex: 1 }}><Play size={14} aria-hidden style={ICON_STYLE} /> Play</Button>
        ) : (
          <Button size="sm" onClick={() => control("pause")} style={{ flex: 1 }}><Pause size={14} aria-hidden style={ICON_STYLE} /> Pause</Button>
        )}
        <Button size="sm" onClick={() => control("restart")} style={{ flex: 1 }}><RotateCcw size={14} aria-hidden style={ICON_STYLE} /> Restart</Button>
        <Button size="sm" variant="danger" onClick={tr.stop} title={tr.stopTitle} style={{ flex: 1 }}>
          <Square size={14} aria-hidden style={ICON_STYLE} /> Stop
        </Button>
        {tr.hasOutTransition && (
          <Button size="sm" variant="danger" onClick={tr.cut} title="Clear instantly" style={{ flex: 1 }}>
            <Scissors size={14} aria-hidden style={ICON_STYLE} /> Cut
          </Button>
        )}
      </div>
    </div>
  );
}
