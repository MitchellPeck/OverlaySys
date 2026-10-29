import type { SomeCompanionConfigField } from "@companion-module/base";

export interface ModuleConfig {
  host: string;
  port: number;
  channels: string;
  loadedShowId: string;
  /** LAN token, only when the server sets OVERLAYSYS_TOKEN. */
  token: string;
  /** Companion page per row kind, for `rundown_<n>_page` (blank = none). */
  pageSong: string;
  pageGraphic: string;
  pageScripture: string;
  pageVideo: string;
  pageSlides: string;
}

export type RowKind = "song" | "graphic" | "scripture" | "video" | "slides";

const PAGE_FIELDS: { id: keyof ModuleConfig; kind: RowKind; label: string }[] = [
  { id: "pageSong", kind: "song", label: "Page for song rows" },
  { id: "pageGraphic", kind: "graphic", label: "Page for graphic rows" },
  { id: "pageScripture", kind: "scripture", label: "Page for scripture rows" },
  { id: "pageVideo", kind: "video", label: "Page for video rows" },
  { id: "pageSlides", kind: "slides", label: "Page for slides rows" },
];

export const defaultConfig: ModuleConfig = {
  host: "127.0.0.1",
  port: 4000,
  channels: "program,preview",
  loadedShowId: "",
  token: "",
  pageSong: "",
  pageGraphic: "",
  pageScripture: "",
  pageVideo: "",
  pageSlides: "",
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
    {
      id: "pagesInfo",
      type: "static-text",
      label: "Pages by row type",
      value:
        "Optional. Fills $(OverlaySys:rundown_<n>_page) so one \"Surface: Set to page\" " +
        "action can jump to the page for the row's type. Leave blank for none.",
      width: 12,
    },
    ...PAGE_FIELDS.map(
      (f): SomeCompanionConfigField => ({
        id: f.id,
        type: "textinput",
        label: f.label,
        width: 4,
        default: "",
        regex: "/^\\s*\\d*\\s*$/",
      }),
    ),
  ];
}

/** The configured page per row kind; kinds left blank are absent. */
export function rowKindPages(config: ModuleConfig): Partial<Record<RowKind, string>> {
  const out: Partial<Record<RowKind, string>> = {};
  for (const f of PAGE_FIELDS) {
    const v = String(config[f.id] ?? "").trim();
    if (v) out[f.kind] = v;
  }
  return out;
}

export function parseChannels(csv: string): string[] {
  return csv
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
