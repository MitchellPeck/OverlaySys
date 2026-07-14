import { z } from "zod";

/**
 * A channel's *configuration* — separate from its runtime state. The runtime
 * state (active graphic, in/on/out phase) lives in `channel.ts`; this type
 * describes how a channel should behave when configured (display name,
 * rendering mode, optional mirroring of another channel's state).
 *
 * The renderer uses these to:
 *   - Drive its CSS — matte mode renders content as white-on-black for
 *     hardware fill+key workflows.
 *   - Choose which channel's runtime state to subscribe to — a mirror
 *     channel subscribes to its source instead of itself, so taking on
 *     `program` automatically updates the linked alpha channel.
 */
export const ChannelRenderModeSchema = z.enum(["normal", "matte"]);
export type ChannelRenderMode = z.infer<typeof ChannelRenderModeSchema>;

export const ChannelConfigSchema = z.object({
  id: z.string(),
  name: z.string(),
  renderMode: ChannelRenderModeSchema.default("normal"),
  /**
   * If set, the renderer subscribes to this channel's runtime state instead
   * of its own. Combined with renderMode, this lets a single take fire both
   * a fill (e.g. `program`) and a key (e.g. `alpha-program` mirroring
   * `program` with renderMode `matte`).
   */
  mirrorOf: z.string().optional(),
  /**
   * CSS color for the renderer page background — `transparent` (default)
   * for OBS alpha-keying, or any solid color for chroma key (`#00ff00`)
   * or hardware keyer hosts that need a fixed bg. Matte mode forces black
   * regardless of this value.
   */
  background: z.string().default("transparent"),
  /**
   * ISO timestamp of the last write. Set by the cloud (or by callers in
   * local mode) on every save. Used by the sync engine for last-writer-wins
   * conflict resolution. Optional for backwards compatibility with pre-sync
   * local JSON files; new writes always set it.
   */
  updatedAt: z.string().optional(),
  /**
   * Soft-delete tombstone. When set, the channel is hidden from operator
   * UIs but the record persists so the deletion can propagate via sync
   * before the row is hard-deleted. Optional for backwards compatibility.
   */
  deletedAt: z.string().optional(),
});
export type ChannelConfig = z.infer<typeof ChannelConfigSchema>;

/**
 * Per-project patch over an org-default {@link ChannelConfig}. Lets one
 * project tweak channel attributes (render mode, mirror target, background)
 * without forking the canonical org channel. Resolution cascades
 * `ProjectChannelOverride → ChannelConfig → defaults` — see
 * `channelResolution.ts`. Mirrors the song sub-take override pattern in
 * `show.ts` (`ShowSong`) and `songResolution.ts`.
 *
 * The `channelId` field references the org channel being overridden. All
 * other fields are optional patches; absent fields fall through to the
 * underlying channel.
 */
export const ProjectChannelOverrideSchema = z.object({
  projectId: z.string(),
  channelId: z.string(),
  name: z.string().optional(),
  renderMode: ChannelRenderModeSchema.optional(),
  mirrorOf: z.string().optional(),
  background: z.string().optional(),
  updatedAt: z.string().optional(),
  deletedAt: z.string().optional(),
});
export type ProjectChannelOverride = z.infer<typeof ProjectChannelOverrideSchema>;
