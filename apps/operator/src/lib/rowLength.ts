import { formatTime, parseDuration } from "@overlaysys/core";

/** Row length as shown in the editor: "M:SS", "H:MM:SS" from an hour up, "" when unset. */
export function formatRowLength(sec: number | undefined): string {
  if (sec === undefined) return "";
  return formatTime(sec * 1000, sec >= 3600 ? "H:MM:SS" : "M:SS");
}

export function parseRowLength(text: string): { ok: true; sec: number | undefined } | { ok: false } {
  if (!text.trim()) return { ok: true, sec: undefined };
  const ms = parseDuration(text);
  if (ms === null) return { ok: false };
  return { ok: true, sec: Math.round(ms / 1000) };
}
