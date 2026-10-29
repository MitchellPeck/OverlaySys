import { z } from "zod";
import { DEFAULT_FORMAT_ID } from "./deckLinkOutput";

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

/**
 * A channel sent to a Blackmagic output device instead of a display. The
 * device is an object so a field telling identical units apart (serial,
 * persistent id) can be added later without migrating prefs.
 */
export const DeckLinkOutputPrefSchema = z.object({
  device: z.object({ name: z.string().min(1) }),
  format: z.string().default(DEFAULT_FORMAT_ID),
});
export type DeckLinkOutputPref = z.infer<typeof DeckLinkOutputPrefSchema>;

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
  /** Output device for media audio in this window (per-machine; never synced).
   *  `label` is the fallback match — device ids are per-origin hashes. */
  audioOutput: z.object({ deviceId: z.string(), label: z.string() }).optional(),
  /** Set: this channel goes to a Blackmagic device; the display fields are ignored. */
  decklink: DeckLinkOutputPrefSchema.optional(),
});
export type ChannelWindowPrefs = z.infer<typeof ChannelWindowPrefsSchema>;

export const WindowPrefsFileSchema = z.object({
  version: z.literal(1).default(1),
  displays: z.array(CachedDisplaySchema).default([]),
  channels: z.record(z.string(), ChannelWindowPrefsSchema).default({}),
  /** ffmpeg built with Blackmagic support; unset = ~/.local/bin/ffmpeg-decklink. */
  decklinkFfmpegPath: z.string().optional(),
});
export type WindowPrefsFile = z.infer<typeof WindowPrefsFileSchema>;
