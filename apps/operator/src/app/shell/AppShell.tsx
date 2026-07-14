"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { colors } from "@overlaysys/ui";
import { isCloudMode } from "@/lib/mode";
import { ProjectSwitcher } from "@/app/components/ProjectSwitcher";
import { Sidebar } from "./Sidebar";
import { StatusPills } from "./StatusPills";
import { CommandPalette } from "./CommandPalette";
import { ShellChromeProvider, useShellChrome } from "./ShellChromeContext";
import { routeToWorkspace, lastRouteKey } from "./workspaces";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <ShellChromeProvider>
      <ShellFrame>{children}</ShellFrame>
    </ShellChromeProvider>
  );
}

function ShellFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "/";
  const workspace = routeToWorkspace(pathname);
  const chrome = useShellChrome();

  // Persist last-visited route per workspace so the toggle returns you where
  // you were.
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem(lastRouteKey(workspace), pathname);
    }
  }, [workspace, pathname]);

  return (
    <div style={{ position: "fixed", inset: 0, display: "flex", overflow: "hidden" }}>
      <Sidebar workspace={workspace} />
      <div style={{ flex: 1, minWidth: 0, display: "grid", gridTemplateRows: "auto minmax(0,1fr)" }}>
        <header
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "9px 14px",
            borderBottom: `1px solid ${colors.border}`,
            background: colors.surface,
          }}
        >
          {chrome.title !== undefined && (
            <h1 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{chrome.title}</h1>
          )}
          {chrome.context && (
            <div style={{ color: colors.textDim, fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
              {chrome.context}
            </div>
          )}
          <ProjectSwitcher />
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
            {chrome.actions}
            <StatusPills />
          </div>
        </header>
        <div style={{ minHeight: 0, overflow: "hidden" }}>{children}</div>
      </div>
      <CommandPalette />
    </div>
  );
}
