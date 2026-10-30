import { DEFAULT_STAGE_FOLLOWS, STAGE_RULE_KINDS, fitRecordId } from "@overlaysys/core";
import type { ChannelConfig, ChannelKind, StageRuleKind } from "@overlaysys/core";

const DEFAULT_STAGE_LAYOUT = "speaker";

function normalise(c: ChannelConfig) {
  const stage = (c.kind ?? "graphics") === "stage";
  const rules: Record<string, string> = {};
  for (const k of STAGE_RULE_KINDS) {
    const v = c.layoutRules?.[k];
    if (v) rules[k] = v;
  }
  return {
    id: c.id,
    name: (c.name ?? "").trim(),
    kind: c.kind ?? "graphics",
    renderMode: c.renderMode ?? "normal",
    mirrorOf: c.mirrorOf || "",
    background: c.background ?? "transparent",
    follows: stage ? c.follows || DEFAULT_STAGE_FOLLOWS : "",
    layoutId: stage ? c.layoutId || DEFAULT_STAGE_LAYOUT : "",
    layoutRules: stage ? rules : {},
  };
}

/** Equality over the editable fields; undefined optionals and defaults compare equal, key order is ignored. */
export function channelConfigEqual(a: ChannelConfig, b: ChannelConfig): boolean {
  const x = normalise(a);
  const y = normalise(b);
  const keys = Object.keys(x) as (keyof typeof x)[];
  return keys.every((k) => (k === "layoutRules" ? rulesEqual(x.layoutRules, y.layoutRules) : x[k] === y[k]));
}

function rulesEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k]);
}

const PINNED = ["program", "preview"];

/** Program, then preview, then the rest by name. */
export function sortChannels(cs: ChannelConfig[]): ChannelConfig[] {
  const rank = (c: ChannelConfig) => {
    const i = PINNED.indexOf(c.id);
    return i === -1 ? PINNED.length : i;
  };
  return [...cs].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

export function newChannelDefaults(kind: ChannelKind): Partial<ChannelConfig> {
  if (kind === "stage") return { kind, follows: DEFAULT_STAGE_FOLLOWS, layoutId: DEFAULT_STAGE_LAYOUT };
  return { kind, renderMode: "normal", mirrorOf: undefined, background: "transparent" };
}

/** Set (or with null, remove) the layout rule for one item type. The last removal drops the key. */
export function setLayoutRule(cfg: ChannelConfig, kind: StageRuleKind, layoutId: string | null): ChannelConfig {
  const { layoutRules, ...rest } = cfg;
  const next: Partial<Record<StageRuleKind, string>> = { ...(layoutRules ?? {}) };
  if (layoutId === null) delete next[kind];
  else next[kind] = layoutId;
  return Object.keys(next).length === 0 ? (rest as ChannelConfig) : { ...rest, layoutRules: next };
}

/** After a save ack: the draft to keep, or null when the card has no edits beyond what was saved. */
export function draftAfterSave(current: ChannelConfig | undefined, saved: ChannelConfig): ChannelConfig | null {
  return current && !channelConfigEqual(current, saved) ? current : null;
}

export type DeleteImpact = { blocked: string | null; onAir: boolean; dependents: string[] };

/** What deleting `id` affects: program/preview are protected; mirrors and followers are listed. */
export function deleteImpact(id: string, channels: ChannelConfig[], onAir: boolean): DeleteImpact {
  const blocked = id === "program" || id === "preview" ? "Program and Preview can't be deleted." : null;
  const dependents = channels
    .filter((c) => c.id !== id && (c.mirrorOf === id || (c.kind === "stage" && (c.follows ?? DEFAULT_STAGE_FOLLOWS) === id)))
    .map((c) => c.name);
  return { blocked, onAir, dependents };
}

/** Lower-case a user-entered name into a channel id, within the server's id length limit. */
export function channelIdFromName(name: string, taken: string[]): string {
  const base = fitRecordId(name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")) || "channel";
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(fitRecordId(base, `-${n}`))) n++;
  return fitRecordId(base, `-${n}`);
}
