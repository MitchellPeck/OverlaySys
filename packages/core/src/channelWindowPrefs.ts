import { z } from "zod";

/**
 * Per-machine channel window preferences. Lives in
 * `userData/data/channel-window-prefs.json`; intentionally separate
 * from the shared `data/channels/<id>.json` so display assignments
 * do not leak across rigs when projects are synced.
 */

/**
 * Snapshot of an Electron `Display`'s identifying fields, captured at
 * the moment we last successfully resolved a configured channel to a
 * screen. Used as a fallback fingerprint when `Display.id` rotates
 * across reboots / sleep cycles — see `resolveDisplay` in the desktop
 * host.
 */
export const CachedDisplaySchema = z.object({
  id: z.number(),
  label: z.string(),
  bounds: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }),
  internal: z.boolean(),
});
export type CachedDisplay = z.infer<typeof CachedDisplaySchema>;

export const ChannelWindowPrefsSchema = z.object({
  autoOpen: z.boolean().default(false),
  /** Electron `Display.id` of the target display when the pref was saved.
   *  May not match the currently-attached set; the resolver in the
   *  desktop host handles fallback. */
  displayId: z.number().optional(),
  fullscreen: z.boolean().default(false),
  frameless: z.boolean().default(false),
  alwaysOnTop: z.boolean().default(false),
  transparent: z.boolean().default(false),
});
export type ChannelWindowPrefs = z.infer<typeof ChannelWindowPrefsSchema>;

export const WindowPrefsFileSchema = z.object({
  version: z.literal(1).default(1),
  displays: z.array(CachedDisplaySchema).default([]),
  channels: z.record(z.string(), ChannelWindowPrefsSchema).default({}),
});
export type WindowPrefsFile = z.infer<typeof WindowPrefsFileSchema>;
