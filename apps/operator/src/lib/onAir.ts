import type { ChannelState, Show, SongMeta, TemplateMeta } from "@overlaysys/core";
import type { ClientMessage } from "@overlaysys/ws-protocol";

type Ctx = {
  show: Show | null;
  songs: Pick<SongMeta, "id" | "title">[];
  templates: Pick<TemplateMeta, "id" | "name">[];
};

/** True when the channel is showing something the audience can see. */
export function channelIsLive(st: ChannelState | undefined): boolean {
  if (!st) return false;
  if (st.songSession && !st.songSession.blanked) return true;
  if (st.scriptureSession) return true;
  if (st.media && st.media.playback.status !== "ended" && st.media.playback.status !== "error") return true;
  return !!st.active && st.active.phase !== "out";
}

/** True when any channel is live; used to guard show switches mid-service. */
export function anythingOnAir(channelStates: Record<string, ChannelState>): boolean {
  return Object.values(channelStates).some(channelIsLive);
}

/** A channel can be cleared when it holds a graphic, media, or a song/scripture session. */
export function channelHasContent(st: ChannelState | undefined): boolean {
  if (!st) return false;
  return !!(st.songSession || st.scriptureSession || st.queuedSong || st.queuedScripture || st.media || (st.active && st.active.phase !== "out"));
}

/**
 * Messages that empty a channel: graphics, song and scripture via `clear`,
 * plus `media_clear` when a video is on it. The PGM/PVW Clear buttons and
 * the global Esc key all use this, so "clear" always means the whole channel.
 */
export function clearChannelMessages(st: ChannelState | undefined, channel: string): ClientMessage[] {
  const msgs: ClientMessage[] = [{ type: "clear", channel }];
  if (st?.media) msgs.push({ type: "media_clear", channel });
  return msgs;
}

function songTitle(songId: string, ctx: Ctx): string {
  return ctx.songs.find((s) => s.id === songId)?.title ?? "Song";
}

function rowTitle(rowId: string, ctx: Ctx): string | null {
  const row = ctx.show?.rows.find((r) => r.id === rowId);
  if (!row) return null;
  switch (row.kind) {
    case "song":
      return songTitle(row.songId, ctx);
    case "scripture":
      return row.reference || "Scripture";
    case "video":
      return row.label || "Video";
    case "graphic":
      return null;
  }
}

/**
 * One-line caption for what a channel is showing, from state the operator
 * already receives. Null when the channel is empty.
 */
export function onAirCaption(st: ChannelState | undefined, ctx: Ctx): string | null {
  if (!st) return null;
  const parts: string[] = [];
  if (st.songSession) {
    parts.push(`${songTitle(st.songSession.songId, ctx)}${st.songSession.blanked ? " (blanked)" : ""}`);
  } else if (st.scriptureSession) {
    parts.push(st.scriptureSession.slideReference || st.scriptureSession.reference);
  } else if (st.active && st.active.phase !== "out") {
    const a = st.active;
    if (a.subTakeContext) {
      const title = rowTitle(a.subTakeContext.songRowId, ctx) ?? "Song";
      parts.push(`${title} · ${a.subTakeContext.sub}`);
    } else if (a.scriptureContext) {
      parts.push(rowTitle(a.scriptureContext.rowId, ctx) ?? "Scripture");
    } else {
      const name = ctx.templates.find((t) => t.id === a.templateId)?.name ?? a.templateId;
      const detail = a.data["title"] ?? a.data["name"] ?? Object.values(a.data).find((v) => v && !v.startsWith("data:"));
      parts.push(detail ? `${name} · ${detail}` : name);
    }
  } else if (st.queuedSong) {
    parts.push(`${st.queuedSong.title} (queued)`);
  }
  if (st.media && st.media.playback.status !== "ended") {
    parts.push(st.media.label || "Video");
  }
  return parts.length > 0 ? parts.join(" + ") : null;
}
