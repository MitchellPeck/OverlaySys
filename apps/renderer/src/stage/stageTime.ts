import {
  computeTimeDisplay,
  CURRENT_ITEM_TIMER_ID,
  decodeTimerValue,
  formatSignedTime,
  timerMs,
  timerPhase,
  type StageTimer,
  type StageTimerSource,
  type StageVideo,
} from "@overlaysys/core";

/** Add to Date.now() to approximate server time. */
export function serverOffset(serverNow: number, localNow: number): number {
  return serverNow - localNow;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

export function formatClockDisplay(ms: number, format: "12h" | "24h", seconds: boolean): string {
  const d = new Date(ms);
  const h = d.getHours();
  const tail = `${pad2(d.getMinutes())}${seconds ? `:${pad2(d.getSeconds())}` : ""}`;
  if (format === "24h") return `${pad2(h)}:${tail}`;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${tail} ${h < 12 ? "AM" : "PM"}`;
}

export function timerDisplay(t: StageTimer, serverNowMs: number): string {
  return computeTimeDisplay(
    { key: "t", label: t.label, type: "time", timeMode: t.mode, ...(t.format ? { timeFormat: t.format } : {}) },
    t.value,
    serverNowMs,
  );
}

export function stageTimerView(
  t: StageTimer,
  serverNowMs: number,
  warnBelowSec: number,
): { text: string; phase: "normal" | "warn" | "over" } {
  const text = timerDisplay(t, serverNowMs);
  if (t.mode !== "countdown") return { text, phase: "normal" };
  const v = decodeTimerValue(t.value);
  if (!Number.isFinite(v.anchor)) return { text, phase: "normal" };
  const ms = timerMs({ mode: t.mode, anchor: v.anchor, ...(v.pausedAt != null ? { pausedAt: v.pausedAt } : {}) }, serverNowMs);
  const phase = timerPhase(t.mode, ms, t.overtime, warnBelowSec * 1000);
  return { text: t.overtime ? formatSignedTime(ms, t.format ?? "MM:SS") : text, phase };
}

export function pickStageTimer(timers: StageTimer[], source: StageTimerSource): StageTimer | undefined {
  if (source === "firstActive") return timers[0];
  if (source === "currentItem") return timers.find((x) => x.id === CURRENT_ITEM_TIMER_ID);
  if ("channel" in source) return timers.find((x) => x.channel === source.channel);
  return timers.find((x) => x.id === source.timerId);
}

export function videoRemainingSec(v: StageVideo, serverNowMs: number): number {
  const elapsed = v.status === "playing" ? Math.max(0, (serverNowMs - v.at) / 1000) : 0;
  return Math.max(0, v.duration - (v.currentTime + elapsed));
}

export function formatRemaining(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0 ? `${h}:${pad2(m)}:${pad2(r)}` : `${m}:${pad2(r)}`;
}
