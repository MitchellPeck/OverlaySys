"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AreaTabs, Button, Kbd, colors, fontSize, fontWeight } from "@overlaysys/ui";
import { isCloudMode } from "@/lib/mode";
import { useStore } from "@/lib/store";
import { channelHasContent } from "@/lib/onAir";
import { ProjectSwitcher } from "@/app/components/ProjectSwitcher";
import { AccountMenu } from "@/app/components/AccountMenu";
import { useShellChrome } from "./ShellChromeContext";
import { StatusBar } from "./StatusBar";
import { FirstRunChecklist } from "./FirstRunChecklist";
import { AREAS, areasFor, defaultRouteFor, lastRouteKey, routeToArea, showsProjectSwitcher, type AreaId } from "./areas";
import { guardedNavigate } from "@/lib/unsavedGuardFlow";

/**
 * Navigate to an area's last-visited route, falling back to its default.
 * Live has a single route, so it always goes to "/".
 */
export function enterArea(router: { push: (r: string) => void }, id: AreaId, cloud: boolean): void {
  if (id === "live") {
    router.push("/");
    return;
  }
  const saved = typeof window !== "undefined" ? localStorage.getItem(lastRouteKey(id)) : null;
  router.push(saved || defaultRouteFor(id, cloud));
}

export function TopBar() {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const cloud = isCloudMode();
  const area = routeToArea(pathname);
  const chrome = useShellChrome();
  const pgmHasContent = useStore((s) => channelHasContent(s.channelStates["program"]));
  return (
    <header
      className="shell-topbar"
      style={{
        display: "flex",
        alignItems: "center",
        height: 40,
        padding: "0 12px",
        borderBottom: `1px solid ${colors.border}`,
        background: colors.surface,
        minWidth: 0,
        // The shell grid's auto column grows to its widest row; never let
        // wide page content stretch the bar past the viewport.
        maxWidth: "100vw",
      }}
    >
      <AreaTabs
        // Links (with the area's default route) so they're real navigation;
        // a plain click returns to the last route visited in that area.
        items={areasFor(cloud).map((id) => ({
          id,
          label: AREAS[id].label,
          tone: "brand",
          // The red dot means something is on program; the tab itself stays accent.
          dot: id === "live" && pgmHasContent,
          href: defaultRouteFor(id, cloud),
        }))}
        linkComponent={Link}
        active={area}
        onSelect={(id) => {
          if (id !== area) enterArea({ push: (href) => void guardedNavigate(href, router) }, id, cloud);
        }}
      />
      {chrome.title !== undefined && (
        <h1 className="shell-title" style={{ margin: 0, fontSize: fontSize.base, fontWeight: fontWeight.semibold }}>
          {chrome.title}
        </h1>
      )}
      {chrome.context && (
        <div className="shell-context" style={{ color: colors.textDim, fontSize: fontSize.md, display: "flex", alignItems: "center", gap: 8 }}>
          {chrome.context}
        </div>
      )}
      {showsProjectSwitcher(pathname) && <ProjectSwitcher />}
      <div className="shell-topbar-right" style={{ marginLeft: "auto", display: "flex", alignItems: "center" }}>
        {chrome.actions}
        <Button
          variant="ghost"
          size="sm"
          aria-label="Open command palette"
          onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }))}
        >
          <Kbd>⌘K</Kbd>
        </Button>
        <FirstRunChecklist />
        <StatusBar />
        <AccountMenu />
      </div>
    </header>
  );
}
