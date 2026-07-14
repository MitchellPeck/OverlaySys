// Single source of truth for the two-tier Live/Prep shell. Replaces the flat
// NAV_LINKS array that used to live in AppHeader.tsx.

export type WorkspaceId = "live" | "prep";

export type Destination = {
  /** Route the destination navigates to, e.g. "/timer". */
  route: string;
  /** Sidebar + palette label, e.g. "Timer". */
  label: string;
  /** Short glyph the sidebar and palette render as the icon. */
  icon: string;
  /** Hidden in the cloud/web build (no paired renderer). All Live surfaces are. */
  desktopOnly?: boolean;
};

export type Workspace = {
  id: WorkspaceId;
  label: string;
  /** Where the toggle lands when there is no last-visited route. */
  defaultRoute: string;
  destinations: Destination[];
};

export const WORKSPACES: Record<WorkspaceId, Workspace> = {
  live: {
    id: "live",
    label: "Live",
    defaultRoute: "/",
    destinations: [
      { route: "/", label: "Show", icon: "▦", desktopOnly: true },
      { route: "/timer", label: "Timer", icon: "⏱", desktopOnly: true },
      { route: "/stt", label: "Scripture", icon: "✝", desktopOnly: true },
      { route: "/channels", label: "Channels", icon: "◫", desktopOnly: true },
    ],
  },
  prep: {
    id: "prep",
    label: "Prep",
    defaultRoute: "/shows",
    destinations: [
      { route: "/projects", label: "Projects", icon: "◆" },
      { route: "/shows", label: "Shows", icon: "☰" },
      { route: "/songs", label: "Songs", icon: "♪" },
      { route: "/design", label: "Design", icon: "❖" },
      { route: "/hotcards", label: "Hotcards", icon: "⚡" },
      { route: "/data", label: "Data", icon: "⇅" },
    ],
  },
};

const ALL_DESTINATIONS: { route: string; workspace: WorkspaceId }[] = (
  ["live", "prep"] as const
).flatMap((id) => WORKSPACES[id].destinations.map((d) => ({ route: d.route, workspace: id })));

/**
 * Resolve which workspace a pathname belongs to. Longest-prefix match against
 * every destination route so "/shows/edit" resolves via "/shows". "/" only
 * matches the Show route exactly (never as a prefix of other routes). Unknown
 * routes fall back to "prep" (the management default, and the only workspace
 * in the cloud build).
 */
export function routeToWorkspace(pathname: string): WorkspaceId {
  let best: { route: string; workspace: WorkspaceId } | null = null;
  for (const d of ALL_DESTINATIONS) {
    const matches = d.route === "/" ? pathname === "/" : pathname === d.route || pathname.startsWith(d.route + "/");
    if (matches && (!best || d.route.length > best.route.length)) best = d;
  }
  return best?.workspace ?? "prep";
}

/** Destinations for a workspace, dropping desktopOnly entries in cloud mode. */
export function destinationsFor(id: WorkspaceId, cloud: boolean): Destination[] {
  return WORKSPACES[id].destinations.filter((d) => !(cloud && d.desktopOnly));
}

/** The other workspace (for toggling). */
export function otherWorkspace(id: WorkspaceId): WorkspaceId {
  return id === "live" ? "prep" : "live";
}

/** localStorage key for a workspace's last-visited route. Defined once here so
 *  AppShell (write) and the toggle/palette (read) never drift. */
export const lastRouteKey = (id: WorkspaceId): string => `overlaysys:lastRoute:${id}`;
