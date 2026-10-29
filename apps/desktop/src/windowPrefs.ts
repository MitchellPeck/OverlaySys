import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type {
  CachedDisplay,
  ChannelWindowPrefs,
  WindowPrefsFile,
} from "@overlaysys/core";

// NOTE: this schema is duplicated from `@overlaysys/core`'s
// `channelWindowPrefs.ts` on purpose. `@overlaysys/core` is consumed
// as raw TypeScript (its package.json `main` points at `src/index.ts`),
// so importing the schema *value* at runtime in the Electron main
// process — which is compiled by tsc and run by plain Node — would
// force a `require()` of a `.ts` file and crash on launch.
// Keep this structurally identical to the upstream schema. If
// `@overlaysys/core` ever ships a compiled `dist/`, collapse this back
// into a single import.
const WindowPrefsFileSchema = z.object({
  version: z.literal(1).default(1),
  displays: z
    .array(
      z.object({
        id: z.number(),
        label: z.string(),
        bounds: z.object({
          x: z.number(),
          y: z.number(),
          width: z.number(),
          height: z.number(),
        }),
        internal: z.boolean(),
      }),
    )
    .default([]),
  channels: z
    .record(
      z.string(),
      z.object({
        autoOpen: z.boolean().default(false),
        displayId: z.number().optional(),
        fullscreen: z.boolean().default(false),
        frameless: z.boolean().default(false),
        alwaysOnTop: z.boolean().default(false),
        transparent: z.boolean().default(false),
        audioOutput: z.object({ deviceId: z.string(), label: z.string() }).optional(),
        decklink: z
          .object({
            device: z.object({ name: z.string().min(1) }),
            format: z.string().default("1080p59.94"),
          })
          .optional(),
      }),
    )
    .default({}),
  decklinkFfmpegPath: z.string().optional(),
});

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

/**
 * Whether a channel should open at launch. Only the exact saved display (by
 * id) counts: a same-name or same-resolution screen is often the operator's
 * main monitor (same model as the TVs), and opening there piles every channel
 * onto it. Channels that never chose a display still open on the primary.
 * Manual opens still use the looser label/bounds matching.
 */
export function shouldAutoOpen(
  prefs: Pick<ChannelWindowPrefs, "autoOpen" | "displayId" | "decklink">,
  matchedBy: MatchedBy,
): boolean {
  if (!prefs.autoOpen) return false;
  // A Blackmagic output doesn't live on a display.
  if (prefs.decklink) return true;
  return prefs.displayId === undefined || matchedBy === "id";
}

/**
 * After a display is connected: the auto-open channels whose exact saved
 * display (by id) is now connected and that aren't already open.
 */
export function channelsToOpenOnDisplayChange(
  channels: Record<string, Pick<ChannelWindowPrefs, "autoOpen" | "displayId" | "decklink">>,
  resolve: (prefs: Pick<ChannelWindowPrefs, "autoOpen" | "displayId">) => MatchedBy,
  isOpen: (channelId: string) => boolean,
): string[] {
  return Object.entries(channels)
    .filter(([id, prefs]) => prefs.autoOpen && !prefs.decklink && prefs.displayId !== undefined && !isOpen(id))
    .filter(([, prefs]) => resolve(prefs) === "id")
    .map(([id]) => id);
}
