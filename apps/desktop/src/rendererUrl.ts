/**
 * Pure builder for a channel window's renderer URL (main.ts imports
 * electron, so the logic lives here to be testable).
 */
export function buildRendererChannelUrl(opts: {
  isDev: boolean;
  devRendererUrl: string;
  serverHost: string;
  serverPort: number;
  channelId: string;
  audioOutput?: { deviceId: string; label: string };
  /** How this output names itself in Outputs status (e.g. the Blackmagic device). */
  label?: string;
}): string {
  const u = opts.isDev
    ? new URL(opts.devRendererUrl)
    : new URL(`http://${opts.serverHost}:${opts.serverPort}/renderer/`);
  u.searchParams.set("channel", opts.channelId);
  if (!opts.isDev) {
    u.searchParams.set("server", `ws://${opts.serverHost}:${opts.serverPort}/ws`);
  }
  if (opts.audioOutput) {
    u.searchParams.set("audioSinkId", opts.audioOutput.deviceId);
    u.searchParams.set("audioSinkLabel", opts.audioOutput.label);
  }
  if (opts.label) u.searchParams.set("label", opts.label);
  return u.toString();
}
