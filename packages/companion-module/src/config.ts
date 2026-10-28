import type { SomeCompanionConfigField } from "@companion-module/base";

export interface ModuleConfig {
  host: string;
  port: number;
  channels: string;
  loadedShowId: string;
  /** LAN token, only when the server sets OVERLAYSYS_TOKEN. */
  token: string;
}

export const defaultConfig: ModuleConfig = {
  host: "127.0.0.1",
  port: 4000,
  channels: "program,preview",
  loadedShowId: "",
  token: "",
};

export function configFields(): SomeCompanionConfigField[] {
  return [
    {
      id: "host",
      type: "textinput",
      label: "Server host",
      width: 6,
      default: defaultConfig.host,
    },
    {
      id: "port",
      type: "number",
      label: "Server port",
      width: 6,
      default: defaultConfig.port,
      min: 1,
      max: 65535,
    },
    {
      id: "token",
      type: "textinput",
      label: "LAN token (only if the server requires one)",
      width: 12,
      default: "",
    },
    {
      id: "channels",
      type: "textinput",
      label: "Channels to subscribe (comma-separated)",
      width: 12,
      default: defaultConfig.channels,
    },
    {
      id: "loadedShowId",
      type: "textinput",
      label:
        "Loaded show ID (persists across restarts; usually set via the Load Show action)",
      width: 12,
      default: "",
    },
  ];
}

export function parseChannels(csv: string): string[] {
  return csv
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
