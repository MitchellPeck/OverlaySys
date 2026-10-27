// Which channels the stage monitors follow. Shared by the item-timer and
// sermon-notes "row taken" hooks so only takes a stage can see have effects.

import { DEFAULT_STAGE_FOLLOWS } from "@overlaysys/core";
import * as channelConfigs from "./channelConfigs";

/**
 * The channels stage monitors follow: each stage channel's `follows` (default
 * program), a mirror resolved one hop to its source the way
 * stageFeedHub.computeFeed does. With no stage channels, just the default.
 */
export async function stageFollowedChannels(): Promise<Set<string>> {
  const stages = (await channelConfigs.listChannelConfigs()).filter((c) => c.kind === "stage");
  if (stages.length === 0) return new Set([DEFAULT_STAGE_FOLLOWS]);
  const out = new Set<string>();
  for (const cfg of stages) {
    let id = cfg.follows ?? DEFAULT_STAGE_FOLLOWS;
    let followed = await channelConfigs.getChannelConfig(id);
    if (followed?.kind !== "stage" && followed?.mirrorOf) {
      id = followed.mirrorOf;
      followed = await channelConfigs.getChannelConfig(id);
    }
    if (followed?.kind !== "stage") out.add(id);
  }
  return out;
}
