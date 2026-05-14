"use client";

import { useEffect, useMemo, useState } from "react";
import { Button, colors, radius } from "@overlaysys/ui";
import type { ChannelState, Field, Template } from "@overlaysys/core";
import {
  computeTimeDisplay,
  decodeTimerValue,
  encodeTimerValue,
  isTimeField,
} from "@overlaysys/core";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";

/**
 * Manage timers that are currently on air. Reads from the existing
 * channelStates store (no new server-side state) and sends `update`
 * messages to mutate the time-field anchor:
 *
 *   - Pause:  set `pausedAt = now` on each time field
 *   - Resume: shift anchor by (now - pausedAt), drop pausedAt
 *   - ±N s:   shift anchor by ±N*1000 ms (countdown adds to remaining,
 *             count-up subtracts from start so elapsed grows)
 *   - Reset:  countdown re-stamps anchor to now+durationMs (captured at
 *             take time); count-up re-stamps anchor to now
 *
 * One row per channel that has an active template containing ≥1 time
 * field. Clock-mode fields don't surface — there's nothing to manage on
 * a wall clock.
 */
export function ActiveTimersPanel() {
  const channelConfigs = useStore((s) => s.channelConfigs);
  const channelStates = useStore((s) => s.channelStates);
  const templateCache = useStore((s) => s.templateCache);

  // Build the list of channels with an active template that has manageable
  // (non-clock) time fields. Only consider non-mirror channels — mirrors
  // reflect their source, and mutating one is a no-op.
  const entries = useMemo(() => {
    const out: Array<{
      channelId: string;
      channelName: string;
      template: Template;
      timeFields: Field[];
      data: Record<string, string>;
    }> = [];
    for (const cfg of channelConfigs) {
      if (cfg.mirrorOf) continue;
      const state = channelStates[cfg.id];
      const active = state?.active;
      if (!active) continue;
      const template = templateCache[active.templateId];
      if (!template) continue;
      const timeFields = template.fields.filter(
        (f) => isTimeField(f) && (f.timeMode ?? "countdown") !== "clock",
      );
      if (timeFields.length === 0) continue;
      out.push({
        channelId: cfg.id,
        channelName: cfg.name,
        template,
        timeFields,
        data: active.data,
      });
    }
    return out;
  }, [channelConfigs, channelStates, templateCache]);

  if (entries.length === 0) {
    return (
      <div
        style={{
          padding: "16px 12px",
          background: "var(--panel-2)",
          border: `1px solid ${colors.border}`,
          borderRadius: radius.md,
          color: colors.textDim,
          fontSize: 12,
          textAlign: "center",
        }}
      >
        No active timers. Start one above to see manage controls here.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {entries.map((e) => (
        <ActiveTimerRow key={e.channelId} {...e} />
      ))}
    </div>
  );
}

function ActiveTimerRow({
  channelId,
  channelName,
  template,
  timeFields,
  data,
}: {
  channelId: string;
  channelName: string;
  template: Template;
  timeFields: Field[];
  data: Record<string, string>;
}) {
  const { send } = useWs();
  // Tick a local clock so the displayed remaining/elapsed values stay
  // current. Half-second is enough for human-paced operation without
  // burning CPU on a manage view that isn't critical-path.
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);

  // A channel's set of time fields is treated as one logical timer for
  // controls — pause one, pause all; +30s on all. Mixing countdown +
  // countup in the same template is rare but the per-field encoding
  // handles it correctly because each field reads its own data value.
  const allPaused = timeFields.every(
    (f) => decodeTimerValue(data[f.key]).pausedAt != null,
  );

  function patchEachField(
    mutate: (
      field: Field,
      current: ReturnType<typeof decodeTimerValue>,
      nowMs: number,
    ) => ReturnType<typeof decodeTimerValue> | null,
  ): void {
    const t = Date.now();
    const patch: Record<string, string> = {};
    for (const f of timeFields) {
      const current = decodeTimerValue(data[f.key]);
      const next = mutate(f, current, t);
      if (next) patch[f.key] = encodeTimerValue(next);
    }
    if (Object.keys(patch).length > 0) {
      send({ type: "update", channel: channelId, data: patch });
    }
  }

  function togglePause(): void {
    if (allPaused) {
      // Resume: shift anchor by the time spent paused, drop pausedAt.
      patchEachField((_f, cur, t) => {
        if (cur.pausedAt == null) return null;
        const shift = t - cur.pausedAt;
        const next: typeof cur = { anchor: cur.anchor + shift };
        if (cur.durationMs != null) next.durationMs = cur.durationMs;
        return next;
      });
    } else {
      patchEachField((_f, cur, t) => {
        if (!Number.isFinite(cur.anchor)) return null;
        const next: typeof cur = { anchor: cur.anchor, pausedAt: t };
        if (cur.durationMs != null) next.durationMs = cur.durationMs;
        return next;
      });
    }
  }

  function nudge(deltaSec: number): void {
    // "+N" means more on display: more remaining (countdown) or more
    // elapsed (count-up). Direction flips by mode.
    patchEachField((f, cur) => {
      if (!Number.isFinite(cur.anchor)) return null;
      const mode = f.timeMode ?? "countdown";
      const deltaMs = deltaSec * 1000;
      const next: typeof cur = {
        anchor: mode === "countdown" ? cur.anchor + deltaMs : cur.anchor - deltaMs,
      };
      if (cur.pausedAt != null) next.pausedAt = cur.pausedAt;
      if (cur.durationMs != null) next.durationMs = cur.durationMs;
      return next;
    });
  }

  function reset(): void {
    patchEachField((f, cur, t) => {
      const mode = f.timeMode ?? "countdown";
      if (mode === "countdown") {
        // Reset from the duration captured at take time. If absent (legacy
        // values), fall back to the time remaining at the moment Reset
        // was clicked — i.e. "restart from where we were."
        const ms =
          cur.durationMs ??
          (Number.isFinite(cur.anchor) ? Math.max(0, cur.anchor - t) : null);
        if (ms == null) return null;
        return { anchor: t + ms, durationMs: ms };
      }
      // count-up: restart elapsed at zero.
      return { anchor: t };
    });
  }

  return (
    <div
      style={{
        padding: 10,
        background: colors.panel2,
        border: `1px solid ${colors.border}`,
        borderRadius: radius.md,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 13 }}>{channelName}</span>
        <span style={{ color: colors.textDim, fontSize: 11 }}>· {template.name}</span>
        {allPaused && (
          <span
            style={{
              marginLeft: "auto",
              fontSize: 10,
              color: colors.accent2,
              letterSpacing: 1.2,
              textTransform: "uppercase",
            }}
          >
            paused
          </span>
        )}
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          marginBottom: 10,
        }}
      >
        {timeFields.map((f) => (
          <div
            key={f.key}
            style={{ display: "flex", alignItems: "baseline", gap: 8 }}
          >
            <span
              style={{
                fontSize: 11,
                color: colors.textDim,
                minWidth: 70,
              }}
            >
              {f.label}
            </span>
            <span
              style={{
                fontSize: 18,
                fontFamily: "ui-monospace, monospace",
                color: colors.text,
              }}
            >
              {computeTimeDisplay(f, data[f.key], now)}
            </span>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        <Button
          onClick={togglePause}
          variant={allPaused ? "primary" : "ghost"}
          size="sm"
        >
          {allPaused ? "▶ Resume" : "⏸ Pause"}
        </Button>
        <Button onClick={() => nudge(-60)} variant="ghost" size="sm">
          −1m
        </Button>
        <Button onClick={() => nudge(-30)} variant="ghost" size="sm">
          −30s
        </Button>
        <Button onClick={() => nudge(30)} variant="ghost" size="sm">
          +30s
        </Button>
        <Button onClick={() => nudge(60)} variant="ghost" size="sm">
          +1m
        </Button>
        <Button onClick={reset} variant="ghost" size="sm" title="Restart from the original duration">
          ↻ Reset
        </Button>
      </div>
    </div>
  );
}

// Re-export so existing single-import callers can keep using { ActiveTimersPanel }
// without changing import paths. (No-op in this file's scope.)
export type { ChannelState };
