"use client";

import { useEffect, useMemo, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { Button, Input, Select, colors, radius } from "@overlaysys/ui";
import {
  CURRENT_ITEM_TIMER_ID,
  formatSignedTime,
  formatTime,
  parseDuration,
  timerMs,
  timerPhase,
  type StageTimerInstance,
} from "@overlaysys/core";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";

const WARN_MS = 60_000;

/** Standalone stage timers: the current item timer (pinned) plus manual ones. */
export function StageTimersSection() {
  const timers = useStore((s) => s.stageTimers);
  const { send } = useWs();
  const offset = useStore((s) => s.serverTimeOffsetMs);
  const [localNow, setLocalNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setLocalNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  // Timer anchors are server-clock timestamps, so project on the server clock.
  const now = localNow + offset;

  const ordered = useMemo(
    () => [
      ...timers.filter((t) => t.id === CURRENT_ITEM_TIMER_ID),
      ...timers.filter((t) => t.id !== CURRENT_ITEM_TIMER_ID),
    ],
    [timers],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: colors.textDim, textTransform: "uppercase", letterSpacing: 0.5 }}>
        Stage timers
      </div>
      {ordered.map((t) => (
        <StageTimerRow key={t.id} timer={t} now={now} send={send} />
      ))}
      <NewStageTimerForm send={send} />
    </div>
  );
}

type Send = ReturnType<typeof useWs>["send"];

function StageTimerRow({ timer: t, now, send }: { timer: StageTimerInstance; now: number; send: Send }) {
  const isItem = t.id === CURRENT_ITEM_TIMER_ID;
  const ms = timerMs(t, now);
  const phase = timerPhase(t.mode, ms, t.overtime, WARN_MS);
  const text = t.mode === "countdown" && t.overtime ? formatSignedTime(ms, "M:SS") : formatTime(ms, "M:SS");
  const color = phase === "over" ? colors.danger : phase === "warn" ? colors.warn : colors.text;
  const notStarted = t.anchor == null;
  const paused = !notStarted && t.pausedAt != null;
  const running = !notStarted && !paused;
  // The next PCO poll would revert a manual nudge, so don't offer one.
  const pco = t.source === "pco";
  const pcoTitle = pco ? "Driven by Planning Center Live" : undefined;

  return (
    <div style={{ padding: 10, background: colors.panel2, border: `1px solid ${colors.border}`, borderRadius: radius.md }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>{t.label}</span>
        {isItem && <span style={{ fontSize: 10, fontWeight: 600, color: colors.accent }}>Current item</span>}
        <span style={{ marginLeft: "auto", fontSize: 18, fontFamily: "ui-monospace, monospace", color }}>{text}</span>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {notStarted && (
          <Button size="sm" variant="primary" onClick={() => send({ type: "timer_start", id: t.id })}>
            <Play size={14} aria-hidden style={{ verticalAlign: "-2px" }} /> Start
          </Button>
        )}
        {running && (
          <Button size="sm" variant="ghost" onClick={() => send({ type: "timer_pause", id: t.id })}>
            <Pause size={14} aria-hidden style={{ verticalAlign: "-2px" }} /> Pause
          </Button>
        )}
        {paused && (
          <Button size="sm" variant="primary" onClick={() => send({ type: "timer_resume", id: t.id })}>
            <Play size={14} aria-hidden style={{ verticalAlign: "-2px" }} /> Resume
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={pco}
          title={pcoTitle}
          onClick={() => send({ type: "timer_reset", id: t.id })}
        >
          <RotateCcw size={14} aria-hidden style={{ verticalAlign: "-2px" }} /> Reset
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={pco}
          title={pcoTitle}
          onClick={() => send({ type: "timer_adjust", id: t.id, deltaMs: -60_000 })}
        >
          −1 min
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={pco}
          title={pcoTitle}
          onClick={() => send({ type: "timer_adjust", id: t.id, deltaMs: 60_000 })}
        >
          +1 min
        </Button>
        <Button size="sm" variant="ghost" onClick={() => send({ type: "timer_delete", id: t.id })}>
          {isItem ? "Clear" : "Delete"}
        </Button>
      </div>
    </div>
  );
}

function NewStageTimerForm({ send }: { send: Send }) {
  const [label, setLabel] = useState("");
  const [mode, setMode] = useState<"countdown" | "countup">("countdown");
  const [duration, setDuration] = useState("5:00");
  const [overtime, setOvertime] = useState(true);

  const countdown = mode === "countdown";
  const durationMs = parseDuration(duration);
  // Only a countdown has a duration; a count-up timer ignores the field.
  const invalid = countdown && durationMs == null;

  function create(): void {
    if (invalid) return;
    send({
      type: "timer_create",
      label: label.trim() || "Timer",
      mode,
      ...(countdown && durationMs != null ? { durationMs } : {}),
      overtime,
    });
    setLabel("");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: 10, border: `1px dashed ${colors.border}`, borderRadius: radius.md }}>
      <div style={{ fontSize: 12, fontWeight: 600 }}>New stage timer</div>
      <Input placeholder="Label" aria-label="Timer label" value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} />
      <div style={{ display: "flex", gap: 6 }}>
        <Select aria-label="Timer mode" value={mode} onChange={(e) => setMode(e.target.value as "countdown" | "countup")}>
          <option value="countdown">Countdown</option>
          <option value="countup">Count up</option>
        </Select>
        {countdown && (
          <Input
            aria-label="Duration"
            placeholder="M:SS"
            value={duration}
            invalid={invalid}
            onChange={(e) => setDuration(e.target.value)}
          />
        )}
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
        <input type="checkbox" checked={overtime} onChange={(e) => setOvertime(e.target.checked)} />
        Overtime
      </label>
      <Button size="sm" variant="primary" disabled={invalid} onClick={create}>
        Create
      </Button>
    </div>
  );
}
