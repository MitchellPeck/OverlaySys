import { MAX_STT_CHANNELS, type SttInputDevice, type SttSpawnerConfig } from "@overlaysys/core";

/** Toggle a 1-based channel in the selection (ascending, at most 4). */
export function toggleChannel(channels: number[], ch: number): number[] {
  if (channels.includes(ch)) return channels.filter((c) => c !== ch);
  if (channels.length >= MAX_STT_CHANNELS) return channels;
  return [...channels, ch].sort((a, b) => a - b);
}

/**
 * Why the channel-select settings can't be used yet, or null when they can
 * (or when channel select is off). A saved device that isn't connected right
 * now isn't an error here — the capture reports it at start.
 */
export function channelSelectProblem(
  cfg: Pick<SttSpawnerConfig, "captureMode" | "channelDevice" | "channels">,
  inputDevices: SttInputDevice[] | null,
): string | null {
  if (cfg.captureMode !== "channels") return null;
  if (!cfg.channelDevice.trim()) return "Pick an input device.";
  if (cfg.channels.length === 0) return "Pick at least one channel.";
  const device = inputDevices?.find((d) => d.name === cfg.channelDevice);
  const over = device ? cfg.channels.filter((c) => c > device.channels) : [];
  if (over.length) {
    return `Channel ${over.join(", ")} is beyond ${device!.name}'s ${device!.channels} channels.`;
  }
  return null;
}
