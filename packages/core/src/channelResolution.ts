// Pure resolution helpers for the org-default + per-project-override channel
// model. Resolution cascades ProjectChannelOverride → ChannelConfig.
// No I/O, no app dependencies — mirrors the shape of `songResolution.ts`
// so the codebase has one consistent override-resolution pattern.

import type { ChannelConfig, ProjectChannelOverride } from "./channelConfig";

/**
 * Apply a project's override (if any) over an org-default channel and
 * return the effective configuration. Override fields win when set;
 * absent fields fall through to the underlying channel. The `id` field
 * always comes from the org channel — overrides cannot rename the
 * channel's stable identifier.
 *
 * Returns `null` when the channel itself is soft-deleted at the org level
 * (override cannot resurrect it) OR when the override itself is
 * soft-deleted (override removed; falls through to base). Tombstones are
 * surfaced this way so callers can distinguish "channel doesn't apply
 * here" from "channel never existed."
 */
export function resolveChannelConfig(
  base: ChannelConfig,
  override: ProjectChannelOverride | undefined,
): ChannelConfig | null {
  if (base.deletedAt) return null;
  if (!override || override.deletedAt) {
    // No override (or override tombstoned) — base wins.
    return base;
  }
  return {
    id: base.id,
    name: override.name ?? base.name,
    renderMode: override.renderMode ?? base.renderMode,
    mirrorOf: override.mirrorOf ?? base.mirrorOf,
    background: override.background ?? base.background,
    // updatedAt of the effective config is the latest of the two writes,
    // so a downstream sync engine can short-circuit when both sides are
    // already fresh. Tombstone fields are intentionally not propagated.
    updatedAt: latestTimestamp(base.updatedAt, override.updatedAt),
  };
}

/**
 * Resolve every channel visible in the context of a given project — org
 * defaults filtered to non-tombstoned, with overrides applied. Convenience
 * wrapper over {@link resolveChannelConfig}.
 *
 * The override lookup is keyed by `(projectId, channelId)`; this function
 * filters the supplied overrides to the target project so callers can pass
 * the full override list without pre-filtering.
 */
export function resolveProjectChannels(
  channels: ChannelConfig[],
  overrides: ProjectChannelOverride[],
  projectId: string,
): ChannelConfig[] {
  const byChannelId = new Map<string, ProjectChannelOverride>();
  for (const o of overrides) {
    if (o.projectId !== projectId) continue;
    byChannelId.set(o.channelId, o);
  }
  const resolved: ChannelConfig[] = [];
  for (const base of channels) {
    const effective = resolveChannelConfig(base, byChannelId.get(base.id));
    if (effective) resolved.push(effective);
  }
  return resolved;
}

function latestTimestamp(
  a: string | undefined,
  b: string | undefined,
): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}
