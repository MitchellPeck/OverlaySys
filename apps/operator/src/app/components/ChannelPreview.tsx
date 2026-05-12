"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ChannelConfig, ChannelState } from "@overlaysys/core";
import { mountTemplate, type MountedTemplate } from "@overlaysys/template-engine";
import { colors, radius } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";

const STAGE_W = 1920;
const STAGE_H = 1080;

type Props = {
  config: ChannelConfig;
  state: ChannelState | undefined;
};

/**
 * Live mini-renderer used in the channel sidebar. Mirrors the OBS renderer's
 * mount/playin/playout/update lifecycle, but scaled into a small card and
 * driven from the operator's already-cached templates instead of fetching
 * each one independently.
 */
export function ChannelPreview({ config, state }: Props) {
  const { send } = useWs();
  const templateCache = useStore((s) => s.templateCache);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef<MountedTemplate | null>(null);
  const lastTakenAtRef = useRef<number>(0);
  // Tracks which mounts have already started their out animation, so a
  // phase=out delivery followed by a fresh take doesn't restart the same
  // out timeline back to t=0 mid-fade.
  const outStartedRef = useRef<WeakSet<MountedTemplate>>(new WeakSet());
  const [scale, setScale] = useState(0);

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

  useEffect(() => {
    if (!stageRef.current) return;
    const active = state?.active;

    function triggerOut(m: MountedTemplate): Promise<void> {
      if (outStartedRef.current.has(m)) return Promise.resolve();
      outStartedRef.current.add(m);
      return m.playOut();
    }

    if (!active) {
      if (mountedRef.current) {
        const m = mountedRef.current;
        mountedRef.current = null;
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
      mountedRef.current = null;

      (async () => {
        if (previous) {
          await triggerOut(previous).catch(() => {});
          previous.destroy();
        }
        if (myTakenAt !== lastTakenAtRef.current) return;
        if (!stageRef.current) return;
        const m = mountTemplate(stageRef.current, tpl, active.data);
        mountedRef.current = m;
        if ((globalThis as { __overlaysys_log?: boolean }).__overlaysys_log) {
          console.log("[overlaysys:preview] mount + playIn", {
            channel: config.id,
            tpl: tpl.id,
            inDuration: m.timelines.in.duration(),
          });
        }
        m.playIn().catch(() => {});
      })();
      return;
    }

    if (active.phase === "out" && mountedRef.current) {
      const m = mountedRef.current;
      mountedRef.current = null;
      triggerOut(m).catch(() => {}).finally(() => m.destroy());
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
          ? "linear-gradient(45deg, #1a1c20 25%, #0c0d10 25%, #0c0d10 50%, #1a1c20 50%, #1a1c20 75%, #0c0d10 75%, #0c0d10) 0 0 / 12px 12px"
          : bg,
      }}
    >
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
      {!state?.active && (
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
          (idle)
        </div>
      )}
    </div>
  );
}
