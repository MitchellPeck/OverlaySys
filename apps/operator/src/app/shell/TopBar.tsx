"use client";

import { usePathname, useRouter } from "next/navigation";
import { AreaTabs, colors } from "@overlaysys/ui";
import { isCloudMode } from "@/lib/mode";
import { ProjectSwitcher } from "@/app/components/ProjectSwitcher";
import { useShellChrome } from "./ShellChromeContext";
import { StatusBar } from "./StatusBar";
import { AREAS, areasFor, defaultRouteFor, lastRouteKey, routeToArea, type AreaId } from "./areas";

/** Navigate to an area's last-visited route, falling back to its default. */
export function enterArea(router: { push: (r: string) => void }, id: AreaId, cloud: boolean): void {
  const saved = typeof window !== "undefined" ? localStorage.getItem(lastRouteKey(id)) : null;
  router.push(saved || defaultRouteFor(id, cloud));
}

export function TopBar() {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const cloud = isCloudMode();
  const area = routeToArea(pathname);
  const chrome = useShellChrome();
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        height: 40,
        padding: "0 12px",
        borderBottom: `1px solid ${colors.border}`,
        background: colors.surface,
      }}
    >
      <AreaTabs
        items={areasFor(cloud).map((id) => ({ id, label: AREAS[id].label, tone: id === "live" ? "onair" : "brand" }))}
        active={area}
        onSelect={(id) => {
          if (id !== area) enterArea(router, id, cloud);
        }}
      />
      {chrome.title !== undefined && <h1 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{chrome.title}</h1>}
      {chrome.context && (
        <div style={{ color: colors.textDim, fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>{chrome.context}</div>
      )}
      <ProjectSwitcher />
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
        {chrome.actions}
        <StatusBar />
      </div>
    </header>
  );
}
