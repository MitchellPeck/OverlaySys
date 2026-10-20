"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { CommandPalette } from "./CommandPalette";
import { ShellChromeProvider } from "./ShellChromeContext";
import { SubNav } from "./SubNav";
import { TopBar } from "./TopBar";
import { LAST_NON_LIVE_KEY, LEGACY_REDIRECTS, lastRouteKey, routeToArea } from "./areas";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <ShellChromeProvider>
      <ShellFrame>{children}</ShellFrame>
    </ShellChromeProvider>
  );
}

function ShellFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const area = routeToArea(pathname);

  // Remember where you were in each area (tabs return there) and the last
  // non-live route (⌘⇧L returns there from Live).
  useEffect(() => {
    if (typeof window === "undefined") return;
    // Redirect-only routes resolve to "library" via the fallback; saving them
    // would make the Library tab / ⌘⇧L bounce through a redirect page.
    if (pathname in LEGACY_REDIRECTS || pathname === "/settings") return;
    localStorage.setItem(lastRouteKey(area), pathname);
    if (area !== "live") localStorage.setItem(LAST_NON_LIVE_KEY, pathname);
  }, [area, pathname]);

  return (
    <div style={{ position: "fixed", inset: 0, display: "grid", gridTemplateRows: "auto minmax(0,1fr)", overflow: "hidden" }}>
      <TopBar />
      <div style={{ display: "flex", minHeight: 0 }}>
        {area !== "live" && <SubNav area={area} />}
        <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: "hidden" }}>{children}</div>
      </div>
      <CommandPalette />
    </div>
  );
}
