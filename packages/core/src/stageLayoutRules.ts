import { z } from "zod";
import type { ChannelConfig } from "./channelConfig";

export const STAGE_RULE_KINDS = ["song", "scripture", "slides", "graphic", "video"] as const;
export const StageRuleKindSchema = z.enum(STAGE_RULE_KINDS);
export type StageRuleKind = z.infer<typeof StageRuleKindSchema>;

/** Stage channel rule map: row kind -> layoutId. Absent kinds use the screen default. */
export const StageLayoutRulesSchema = z.record(StageRuleKindSchema, z.string());

export type StageLayoutReason = "manual" | "item" | `rule:${StageRuleKind}` | "default";

export type StageLayoutStatus = {
  channel: string;
  layoutId: string | undefined;
  reason: StageLayoutReason;
  manual: string | null;
};

/** Per-row stage layout overrides, keyed by stage channel id. */
export const StageLayoutsSchema = z.record(z.string(), z.string());

/** Precedence: manual > item (row override) > type rule > default. Empty strings count as unset. */
export function resolveStageLayout(i: {
  manual?: string | null;
  rowOverride?: string;
  rules?: ChannelConfig["layoutRules"];
  default?: string;
  liveRowKind?: string | null;
}): { layoutId: string | undefined; reason: StageLayoutReason } {
  if (i.manual) return { layoutId: i.manual, reason: "manual" };
  if (i.rowOverride) return { layoutId: i.rowOverride, reason: "item" };
  const kind = i.liveRowKind;
  if (kind && (STAGE_RULE_KINDS as readonly string[]).includes(kind)) {
    const k = kind as StageRuleKind;
    const rule = i.rules?.[k];
    if (rule) return { layoutId: rule, reason: `rule:${k}` };
  }
  return { layoutId: i.default || undefined, reason: "default" };
}
