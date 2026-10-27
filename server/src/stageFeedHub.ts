// Loads the inputs for buildStageFeed and pushes feeds to subscribers of
// stage channels. Every channel subscription registers here; channels whose
// config isn't `kind: "stage"` simply never get a feed, so flipping a
// channel's kind takes effect on the next invalidation without resubscribing.

import {
  DEFAULT_STAGE_FOLLOWS,
  resolveStageLayout,
  type ChannelState,
  type Song,
  type StageFeed,
  type Template,
} from "@overlaysys/core";
import * as channels from "./channels";
import * as channelConfigs from "./channelConfigs";
import * as shows from "./shows";
import * as songs from "./songs";
import * as stageState from "./stageState";
import * as templates from "./templates";
import * as timers from "./timers";
import { buildStageFeed } from "./stageFeed";

export const STAGE_FEED_DEBOUNCE_MS = 50;

const PREVIEW_CHANNEL = "preview";

type Send = (channel: string, feed: StageFeed) => void;

const subs = new Map<string, Set<Send>>();
const pending = new Map<string, ReturnType<typeof setTimeout>>();

export async function computeFeed(channel: string, now = Date.now()): Promise<StageFeed | null> {
  const cfg = await channelConfigs.getChannelConfig(channel);
  if (!cfg || cfg.kind !== "stage") return null;
  let followsId = cfg.follows ?? DEFAULT_STAGE_FOLLOWS;
  let followedCfg = await channelConfigs.getChannelConfig(followsId);
  // A mirror channel has no state of its own — follow its source (one hop).
  if (followedCfg?.kind !== "stage" && followedCfg?.mirrorOf) {
    followsId = followedCfg.mirrorOf;
    followedCfg = await channelConfigs.getChannelConfig(followsId);
  }
  // A channel with no config can still carry state (ad-hoc ids); a stage
  // channel (including this one) has nothing worth following.
  const followed = followedCfg?.kind === "stage" ? null : channels.getState(followsId);
  // Timers come only from channels that can be on air: preview cues and
  // stage channels' own state don't count.
  const allStates: ChannelState[] = [];
  for (const s of channels.allStates()) {
    if (s.channel === PREVIEW_CHANNEL) continue;
    const c = s.channel === channel ? cfg : await channelConfigs.getChannelConfig(s.channel);
    if (c?.kind === "stage") continue;
    allStates.push(s);
  }

  const show = followed?.liveRow ? await shows.getShow(followed.liveRow.showId) : null;
  const rowIdx = show && followed?.liveRow ? show.rows.findIndex((r) => r.id === followed.liveRow!.rowId) : -1;
  const nearRows = show && rowIdx >= 0 ? show.rows.slice(rowIdx, rowIdx + 2) : [];

  const songIds = new Set<string>();
  if (followed?.songSession) songIds.add(followed.songSession.songId);
  const templateIds = new Set<string>();
  if (followed?.active) templateIds.add(followed.active.templateId);
  for (const s of allStates) if (s.active) templateIds.add(s.active.templateId);
  for (const r of nearRows) {
    if (r.kind === "song") songIds.add(r.songId);
    if (r.kind === "graphic") templateIds.add(r.templateId);
  }

  const songMap = new Map<string, Song>();
  for (const id of songIds) {
    const s = await songs.getSong(id);
    if (s) songMap.set(id, s);
  }
  const templateMap = new Map<string, Template>();
  for (const id of templateIds) {
    const t = await templates.getTemplate(id);
    if (t) templateMap.set(id, t);
  }

  const stage = stageState.getStageState();
  const notes = await stageState.activeNotes(stage);

  return buildStageFeed({
    layout: resolveStageLayout(cfg.layoutId),
    followed,
    allStates,
    show,
    songs: songMap,
    templates: templateMap,
    now,
    stage,
    stageTimers: timers.getTimers(),
    notes,
  });
}

// Runs fire-and-forget, so it must never reject: a storage error is logged and
// one throwing `send` doesn't stop the remaining targets.
async function pushTo(channel: string, targets: Iterable<Send>): Promise<void> {
  try {
    const feed = await computeFeed(channel);
    if (!feed) return;
    for (const send of targets) {
      try {
        send(channel, feed);
      } catch (err) {
        console.warn("[stageFeedHub] send failed", err);
      }
    }
  } catch (err) {
    console.warn("[stageFeedHub] failed to compute feed for", channel, err);
  }
}

export function subscribeStage(channel: string, send: Send): () => void {
  let set = subs.get(channel);
  if (!set) {
    set = new Set();
    subs.set(channel, set);
  }
  set.add(send);
  void pushTo(channel, [send]);
  return () => {
    const cur = subs.get(channel);
    if (!cur) return;
    cur.delete(send);
    if (cur.size === 0) subs.delete(channel);
  };
}

export function invalidateAll(): void {
  for (const channel of subs.keys()) {
    if (pending.has(channel)) continue;
    pending.set(
      channel,
      setTimeout(() => {
        pending.delete(channel);
        const targets = subs.get(channel);
        if (targets) void pushTo(channel, [...targets]);
      }, STAGE_FEED_DEBOUNCE_MS),
    );
  }
}
