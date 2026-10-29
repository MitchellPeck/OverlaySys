"use client";

import { Pause, Play } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ChannelConfig, ChannelMedia, ChannelState } from "@overlaysys/core";
import { mountTemplate, type MountedTemplate } from "@overlaysys/template-engine";
import { colors, radius } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";
import { formatClock } from "@/lib/mediaTake";
import { inChipRemainingMs } from "@/lib/previewIn";
import { displayTime, previewNeedsSeek, previewVideoSync, PREVIEW_SYNC_INTERVAL_MS } from "@/lib/mediaTime";
import { resolveAssetUrl, videoPosterUrl } from "@/lib/uploadAsset";

const STAGE_W = 1920;
const STAGE_H = 1080;

type Props = {
  config: ChannelConfig;
  state: ChannelState | undefined;
  /** Shown centred while the channel is empty. Default "(idle)". */
  emptyLabel?: string;
};

/**
 * Live mini-renderer used in the channel sidebar. Mirrors the OBS renderer's
 * mount/playin/playout/update lifecycle, but scaled into a small card and
 * driven from the operator's already-cached templates instead of fetching
 * each one independently.
 */
export function ChannelPreview({ config, state, emptyLabel = "(idle)" }: Props) {
  const { send } = useWs();
  const templateCache = useStore((s) => s.templateCache);
  const heardAt = useStore((s) => s.mediaHeardAt[config.id] ?? 0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef<MountedTemplate | null>(null);
  // Tracks the templateId of the current mount so same-template swaps (lyric
  // slide advance, same-template outro) reuse the mount and run only the
  // template's outTl/inTl — keeps layers outside those timelines (e.g. the
  // gradient shape behind a lyric template) visible across the swap. Mirrors
  // the OBS renderer in apps/renderer/src/Renderer.tsx.
  const lastTemplateIdRef = useRef<string | null>(null);
  const lastTakenAtRef = useRef<number>(0);
  // Tracks which mounts have already started their out animation, so a
  // phase=out delivery followed by a fresh take doesn't restart the same
  // out timeline back to t=0 mid-fade.
  const outStartedRef = useRef<WeakSet<MountedTemplate>>(new WeakSet());
  const [scale, setScale] = useState(0);
  const [inLeftMs, setInLeftMs] = useState(0);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (!r || r.width === 0) return;
      setScale(Math.min(r.width / STAGE_W, r.height / STAGE_H));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const id = state?.active?.templateId;
    if (!id) return;
    if (!templateCache[id]) send({ type: "get_template", templateId: id });
  }, [state?.active?.templateId, templateCache, send]);

  // "IN…" chip: from the take until the template's IN timeline has played.
  const takenAt = state?.active?.phase === "out" ? 0 : (state?.active?.takenAt ?? 0);
  const inDurationSec = state?.active ? (templateCache[state.active.templateId]?.timelines.in.duration ?? 0) : 0;
  useEffect(() => {
    const left = inChipRemainingMs(takenAt, inDurationSec, Date.now());
    setInLeftMs(left);
    if (left <= 0) return;
    const t = setTimeout(() => setInLeftMs(0), left);
    return () => clearTimeout(t);
  }, [takenAt, inDurationSec]);

  useEffect(() => {
    if (!stageRef.current) return;
    const active = state?.active;

    function triggerOut(m: MountedTemplate, auto = false): Promise<void> {
      if (outStartedRef.current.has(m)) return Promise.resolve();
      outStartedRef.current.add(m);
      // Auto-out plays the template's own OUT (see mount.playAutoOut).
      return auto ? m.playAutoOut() : m.playOut();
    }

    if (!active) {
      if (mountedRef.current) {
        const m = mountedRef.current;
        mountedRef.current = null;
        lastTemplateIdRef.current = null;
        triggerOut(m).catch(() => {}).finally(() => m.destroy());
      }
      lastTakenAtRef.current = 0;
      return;
    }

    const tpl = templateCache[active.templateId];
    if (!tpl) return;

    if (active.takenAt !== lastTakenAtRef.current) {
      lastTakenAtRef.current = active.takenAt;
      if (active.phase === "out") return;

      const myTakenAt = active.takenAt;
      const previous = mountedRef.current;

      // Same-template smooth swap: lyric slide advance, or an outro reusing
      // the lyric template. Reuse the mount and run ONLY the template's
      // outTl → data swap → inTl. Layers outside the template's in/out
      // timelines (e.g. a gradient shape behind lyric text) stay visible.
      // Mirrors the OBS renderer's same-template branch.
      if (previous && lastTemplateIdRef.current === active.templateId) {
        (async () => {
          await previous.playOutTimeline().catch(() => {});
          if (myTakenAt !== lastTakenAtRef.current) return;
          previous.update(active.data);
          await previous.playIn().catch(() => {});
        })();
        return;
      }

      mountedRef.current = null;
      lastTemplateIdRef.current = null;

      (async () => {
        if (previous) {
          await triggerOut(previous).catch(() => {});
          previous.destroy();
        }
        if (myTakenAt !== lastTakenAtRef.current) return;
        if (!stageRef.current) return;
        const m = mountTemplate(stageRef.current, tpl, active.data);
        mountedRef.current = m;
        lastTemplateIdRef.current = active.templateId;
        if ((globalThis as { __overlaysys_log?: boolean }).__overlaysys_log) {
          console.log("[overlaysys:preview] mount + playIn", {
            channel: config.id,
            tpl: tpl.id,
            inDuration: m.timelines.in.duration(),
          });
        }
        m.playIn().catch(() => {});
        // Mirror the OBS renderer: fire the blink overlay on every fresh
        // take so the sidebar preview matches what's actually on air.
        if (tpl.blinkOnTake?.enabled) {
          m.playBlink(tpl.blinkOnTake).catch(() => {});
        }
      })();
      return;
    }

    if (active.phase === "out" && mountedRef.current) {
      const m = mountedRef.current;
      mountedRef.current = null;
      lastTemplateIdRef.current = null;
      triggerOut(m, active.outReason === "auto").catch(() => {}).finally(() => m.destroy());
      return;
    }

    if (mountedRef.current) {
      mountedRef.current.update(active.data);
    }
  }, [
    state?.active?.takenAt,
    state?.active?.phase,
    state?.active?.templateId,
    state?.active?.data,
    templateCache,
  ]);

  useEffect(() => {
    return () => {
      if (mountedRef.current) {
        mountedRef.current.destroy();
        mountedRef.current = null;
      }
    };
  }, []);

  const matte = config.renderMode === "matte";
  const bg = matte ? "#000" : (config.background ?? "transparent");
  const isTransparent = bg === "transparent";

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: `${STAGE_W} / ${STAGE_H}`,
        borderRadius: radius.md,
        overflow: "hidden",
        border: `1px solid ${colors.border}`,
        background: isTransparent
          ? "linear-gradient(45deg, var(--surface-2) 25%, var(--bg) 25%, var(--bg) 50%, var(--surface-2) 50%, var(--surface-2) 75%, var(--bg) 75%, var(--bg)) 0 0 / 12px 12px"
          : bg,
      }}
    >
      {state?.media && (
        <MonitorVideo key={state.media.takenAt} media={state.media} heardAt={heardAt} matte={matte} />
      )}
      <div
        ref={stageRef}
        style={{
          position: "absolute",
          left: "50%",
          top: "50%",
          width: STAGE_W,
          height: STAGE_H,
          transform: `translate(-50%, -50%) scale(${scale})`,
          transformOrigin: "50% 50%",
          filter: matte ? "brightness(0) invert(1)" : undefined,
        }}
      />
      {!state?.active && !state?.media && !state?.songSession?.blanked && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: matte ? "rgba(255,255,255,0.4)" : colors.textDim,
            fontSize: 11,
            letterSpacing: 1,
            pointerEvents: "none",
          }}
        >
          {emptyLabel}
        </div>
      )}
      {state?.songSession?.blanked && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.55)",
            color: colors.warn,
            fontSize: 14,
            fontWeight: 700,
            letterSpacing: 2,
            pointerEvents: "none",
          }}
        >
          BLANKED
        </div>
      )}
      {inLeftMs > 0 && (
        <span
          style={{
            position: "absolute",
            right: 6,
            bottom: state?.media ? 28 : 6,
            padding: "1px 6px",
            borderRadius: 3,
            background: "rgba(0,0,0,0.7)",
            color: "#fff",
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 0.6,
            pointerEvents: "none",
          }}
        >
          IN…
        </span>
      )}
      {state?.media && (
        <div
          style={{
            position: "absolute",
            left: 6,
            bottom: 6,
            padding: "2px 6px",
            borderRadius: 4,
            background: "rgba(0,0,0,0.7)",
            color: "#fff",
            fontSize: 10,
            pointerEvents: "none",
          }}
        >
          {state.media.paused ? (
            <Pause size={14} aria-label="Paused" style={{ verticalAlign: "-2px" }} />
          ) : (
            <Play size={14} aria-label="Playing" style={{ verticalAlign: "-2px" }} />
          )}{" "}
          {state.media.label || "Video"} · {formatClock(displayTime(state.media, heardAt, Date.now()).remaining)} left
        </div>
      )}
    </div>
  );
}

/**
 * Muted copy of the channel's video under the template stage, so the
 * monitor shows what the output shows. It plays on its own and is pulled
 * back to the renderer's reported position on mount, on any transport
 * change, and whenever it drifts (checked every 2 s).
 */
function MonitorVideo({ media, heardAt, matte }: { media: ChannelMedia; heardAt: number; matte: boolean }) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const latest = useRef({ media, heardAt });
  latest.current = { media, heardAt };

  const sync = useCallback(() => {
    const v = ref.current;
    if (!v) return;
    const { time, paused } = previewVideoSync(latest.current.media, latest.current.heardAt, Date.now());
    if (time !== null && previewNeedsSeek(v.currentTime, time)) v.currentTime = time;
    if (paused && !v.paused) v.pause();
    else if (!paused && v.paused) v.play().catch(() => {});
  }, []);

  useEffect(() => {
    sync();
  }, [sync, media.paused, media.playback.status, media.seek?.seq]);

  useEffect(() => {
    const id = setInterval(sync, PREVIEW_SYNC_INTERVAL_MS);
    return () => clearInterval(id);
  }, [sync]);

  // Release the decoder and stop the download when the video leaves the
  // monitor; React removing the element alone can keep it buffering.
  useEffect(() => {
    const v = ref.current;
    return () => {
      if (!v) return;
      v.pause();
      v.removeAttribute("src");
      v.load();
    };
  }, []);

  return (
    <video
      ref={ref}
      src={resolveAssetUrl(media.assetUrl)}
      poster={videoPosterUrl(media.assetUrl) ?? undefined}
      muted
      playsInline
      preload="auto"
      onLoadedMetadata={sync}
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        objectFit: "contain",
        background: "#000",
        pointerEvents: "none",
        filter: matte ? "brightness(0) invert(1)" : undefined,
      }}
    />
  );
}
