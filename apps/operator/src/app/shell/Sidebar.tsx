"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { colors, fontWeight } from "@overlaysys/ui";
import { isCloudMode } from "@/lib/mode";
import { AccountMenu } from "@/app/components/AccountMenu";
import { WorkspaceToggle } from "./WorkspaceToggle";
import { destinationsFor, type WorkspaceId } from "./workspaces";

function isActive(pathname: string, route: string): boolean {
  if (route === "/") return pathname === "/";
  return pathname === route || pathname.startsWith(route + "/");
}

export function Sidebar({ workspace }: { workspace: WorkspaceId }) {
  const pathname = usePathname() ?? "/";
  const cloud = isCloudMode();
  const items = destinationsFor(workspace, cloud);
  return (
    <aside
      style={{
        width: 200,
        flexShrink: 0,
        background: colors.surface,
        borderRight: `1px solid ${colors.border}`,
        display: "flex",
        flexDirection: "column",
        padding: "12px 10px",
        gap: 4,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 6px 12px" }}>
        <span style={{ width: 24, height: 24, borderRadius: 6, background: colors.gradBrand }} />
        <strong style={{ fontSize: 14 }}>OverlaySys</strong>
      </div>

      {!cloud && (
        <div style={{ padding: "0 4px 8px" }}>
          <WorkspaceToggle active={workspace} />
        </div>
      )}

      <nav style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {items.map((d) => {
          const on = isActive(pathname, d.route);
          const liveActive = on && workspace === "live";
          return (
            <Link
              key={d.route}
              href={d.route}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                padding: "7px 9px",
                borderRadius: 7,
                textDecoration: "none",
                fontWeight: fontWeight.medium,
                color: on ? colors.text : colors.textDim,
                background: on ? (liveActive ? "rgba(255,51,65,0.12)" : colors.brandSubtle) : "transparent",
                boxShadow: on
                  ? `inset 2px 0 0 ${liveActive ? colors.onair : colors.brand}`
                  : undefined,
              }}
            >
              <span style={{ width: 15, textAlign: "center", opacity: 0.9 }}>{d.icon}</span>
              {d.label}
            </Link>
          );
        })}
      </nav>

      <div style={{ flex: 1 }} />
      <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 8 }}>
        <AccountMenu />
      </div>
    </aside>
  );
}
