import fs from "node:fs";
import path from "node:path";
import {
  WindowPrefsFileSchema,
  type WindowPrefsFile,
} from "@overlaysys/core";

const DEFAULTS: WindowPrefsFile = {
  version: 1,
  displays: [],
  channels: {},
};

export function loadPrefs(file: string): WindowPrefsFile {
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch {
    return structuredClone(DEFAULTS);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return structuredClone(DEFAULTS);
  }
  const result = WindowPrefsFileSchema.safeParse(parsed);
  return result.success ? result.data : structuredClone(DEFAULTS);
}

export function savePrefs(file: string, prefs: WindowPrefsFile): void {
  const validated = WindowPrefsFileSchema.parse(prefs);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(validated, null, 2), "utf8");
}

import type { CachedDisplay, ChannelWindowPrefs } from "@overlaysys/core";

/**
 * Subset of Electron's `Display` used by resolve/fingerprint. Defined
 * structurally so the module stays free of an `electron` import and
 * remains unit-testable with plain object fixtures.
 */
export interface DisplayLike {
  id: number;
  label: string;
  bounds: { x: number; y: number; width: number; height: number };
  internal: boolean;
}

export type MatchedBy = "id" | "label" | "bounds" | "fallback";

export interface ResolveContext {
  /** Currently-attached displays, in `screen.getAllDisplays()` order. */
  displays: DisplayLike[];
  /** Cached display fingerprints from a previous successful match. */
  cached: CachedDisplay[];
  /** Used when nothing else matches. */
  primary: DisplayLike;
}

export interface ResolveResult {
  display: DisplayLike;
  matchedBy: MatchedBy;
}

export function resolveDisplay(
  prefs: Pick<ChannelWindowPrefs, "displayId">,
  ctx: ResolveContext,
): ResolveResult {
  const want = prefs.displayId;
  if (want === undefined) return { display: ctx.primary, matchedBy: "fallback" };

  // 1. Exact id.
  const byId = ctx.displays.find((d) => d.id === want);
  if (byId) return { display: byId, matchedBy: "id" };

  // Look up the cached fingerprint for that id, if any.
  const cached = ctx.cached.find((c) => c.id === want);
  if (cached) {
    // 2. Same label.
    const byLabel = ctx.displays.find((d) => d.label === cached.label);
    if (byLabel) return { display: byLabel, matchedBy: "label" };

    // 3. Same bounds.width × bounds.height + internal flag. First hit wins.
    const byBounds = ctx.displays.find(
      (d) =>
        d.internal === cached.internal &&
        d.bounds.width === cached.bounds.width &&
        d.bounds.height === cached.bounds.height,
    );
    if (byBounds) return { display: byBounds, matchedBy: "bounds" };
  }

  // 4. Fallback.
  return { display: ctx.primary, matchedBy: "fallback" };
}

export function fingerprintDisplay(d: DisplayLike): CachedDisplay {
  return {
    id: d.id,
    label: d.label,
    bounds: { ...d.bounds },
    internal: d.internal,
  };
}

export function updateDisplayCache(
  previous: CachedDisplay[],
  attached: DisplayLike[],
  channels: Record<string, ChannelWindowPrefs>,
): CachedDisplay[] {
  const referenced = new Set<number>();
  for (const prefs of Object.values(channels)) {
    if (typeof prefs.displayId === "number") referenced.add(prefs.displayId);
  }

  const attachedById = new Map(attached.map((d) => [d.id, d]));
  const out: CachedDisplay[] = [];

  // Attached displays always win — fresh fingerprint.
  for (const d of attached) out.push(fingerprintDisplay(d));

  // Keep stale entries only if their id is referenced by a pref AND
  // they are not already represented by an attached display.
  for (const cached of previous) {
    if (attachedById.has(cached.id)) continue;
    if (referenced.has(cached.id)) out.push(cached);
  }

  return out;
}
