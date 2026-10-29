/**
 * Shared vocabulary for sending a channel to a Blackmagic (DeckLink) output
 * device. The desktop host drives the device; the operator shows choices and
 * status. Pure data and copy only — nothing here touches a device.
 */

export type SignalFormat = {
  id: string;
  label: string;
  width: number;
  height: number;
  /** Frame rate as ffmpeg must be given it: an exact fraction for NTSC rates. */
  rate: string;
  fps: number;
};

/**
 * Only formats proven on the hardware. With an output-only ffmpeg the mode is
 * chosen by the stream's size and rate alone, so formats that share both
 * (1080i59.94 vs 1080p29.97) can't be told apart — add one here only after
 * the Mac mini checklist shows the card takes it.
 */
export const SIGNAL_FORMATS: SignalFormat[] = [
  { id: "1080p59.94", label: "1080p 59.94", width: 1920, height: 1080, rate: "60000/1001", fps: 60000 / 1001 },
];

export const DEFAULT_FORMAT_ID = "1080p59.94";

/** The format with this id; an unknown id falls back to the default. */
export function findFormat(id: string): SignalFormat {
  return SIGNAL_FORMATS.find((f) => f.id === id) ?? SIGNAL_FORMATS.find((f) => f.id === DEFAULT_FORMAT_ID)!;
}

export type DeckLinkErrorCode =
  | "ffmpeg-not-found"
  | "no-decklink"
  | "device-not-found"
  | "device-ambiguous"
  | "device-busy"
  | "format-refused"
  | "stalled"
  | "exited";

/** What a device output is doing; "failed" is not retried. */
export type DeckLinkStatus =
  | { state: "starting" | "running" }
  | { state: "restarting"; code: DeckLinkErrorCode; attempt: number; delayMs: number }
  | { state: "failed"; code: DeckLinkErrorCode }
  | { state: "stopped" };

/** Operator-facing explanation of a device output problem. */
export function deckLinkErrorText(code: DeckLinkErrorCode, device: string): string {
  switch (code) {
    case "ffmpeg-not-found":
      return "The Blackmagic ffmpeg wasn't found. Set its path in Settings → Connection → Blackmagic output.";
    case "no-decklink":
      return "The ffmpeg in Settings → Connection has no Blackmagic support. Build it with the Narthex TV script.";
    case "device-not-found":
      return `“${device}” isn't connected, or the Blackmagic driver can't see it.`;
    case "device-ambiguous":
      return `Two devices are called “${device}”. OverlaySys won't guess which one to use.`;
    case "device-busy":
      return `“${device}” is in use by another program (Narthex TV, or a leftover ffmpeg).`;
    case "format-refused":
      return `“${device}” refused the signal format.`;
    case "stalled":
      return `“${device}” stopped taking frames.`;
    case "exited":
      return `The output to “${device}” stopped unexpectedly.`;
  }
}
