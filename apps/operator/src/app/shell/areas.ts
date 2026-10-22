// Single source of truth for the Live · Library · Settings shell. Replaces
// workspaces.ts (Live/Prep).

import {
  ArrowDownUp, BookOpen, CloudDownload, FolderKanban, ListOrdered, Mic, MonitorPlay,
  MonitorSpeaker, Music, Palette, UserRound, Zap, type LucideIcon,
} from "lucide-react";

export type AreaId = "live" | "library" | "settings";

export type Destination = {
  route: string;
  label: string;
  icon: LucideIcon;
  /** Hidden in the cloud/web build (no paired renderer). */
  desktopOnly?: boolean;
};

export type Area = { id: AreaId; label: string; destinations: Destination[] };

export const AREA_ORDER = ["live", "library", "settings"] as const;

export const AREAS: Record<AreaId, Area> = {
  live: {
    id: "live",
    label: "Live",
    destinations: [{ route: "/", label: "Show", icon: MonitorPlay, desktopOnly: true }],
  },
  library: {
    id: "library",
    label: "Library",
    destinations: [
      { route: "/shows", label: "Shows", icon: ListOrdered },
      { route: "/songs", label: "Songs", icon: Music },
      { route: "/design", label: "Designs", icon: Palette },
      { route: "/hotcards", label: "Hotcards", icon: Zap },
      { route: "/pco", label: "Planning Center", icon: CloudDownload, desktopOnly: true },
    ],
  },
  settings: {
    id: "settings",
    label: "Settings",
    destinations: [
      { route: "/settings/channels", label: "Channels", icon: MonitorSpeaker, desktopOnly: true },
      { route: "/settings/stt", label: "Speech-to-text", icon: Mic, desktopOnly: true },
      { route: "/settings/scripture", label: "Scripture", icon: BookOpen, desktopOnly: true },
      { route: "/data", label: "Data", icon: ArrowDownUp },
      { route: "/projects", label: "Projects", icon: FolderKanban },
      { route: "/account", label: "Account", icon: UserRound },
    ],
  },
};

/** Old live-tool routes and where they moved. Each has a client redirect page. */
export const LEGACY_REDIRECTS: Record<string, string> = {
  "/timer": "/",
  "/channels": "/settings/channels",
  "/stt": "/settings/stt",
};

const ALL: { route: string; area: AreaId }[] = AREA_ORDER.flatMap((id) =>
  AREAS[id].destinations.map((d) => ({ route: d.route, area: id })),
);

/** Longest-prefix match; "/" only matches exactly. Unknown routes → library. */
export function routeToArea(pathname: string): AreaId {
  let best: { route: string; area: AreaId } | null = null;
  for (const d of ALL) {
    const hit = d.route === "/" ? pathname === "/" : pathname === d.route || pathname.startsWith(d.route + "/");
    if (hit && (!best || d.route.length > best.route.length)) best = d;
  }
  return best?.area ?? "library";
}

export function destinationsFor(id: AreaId, cloud: boolean): Destination[] {
  return AREAS[id].destinations.filter((d) => !(cloud && d.desktopOnly));
}

export function areasFor(cloud: boolean): AreaId[] {
  return AREA_ORDER.filter((id) => destinationsFor(id, cloud).length > 0);
}

export function defaultRouteFor(id: AreaId, cloud: boolean): string {
  return destinationsFor(id, cloud)[0]?.route ?? "/shows";
}

export const lastRouteKey = (id: AreaId): string => `overlaysys:lastRoute:${id}`;
export const LAST_NON_LIVE_KEY = "overlaysys:lastRoute:nonLive";

/** Where ⌘⇧L goes: into Live from anywhere else; back out of Live to the last non-live route. */
export function liveToggleTarget(current: AreaId, lastNonLive: string | null, cloud: boolean): string {
  if (cloud) return lastNonLive ?? defaultRouteFor(current, cloud);
  if (current !== "live") return "/";
  return lastNonLive ?? defaultRouteFor("library", cloud);
}
