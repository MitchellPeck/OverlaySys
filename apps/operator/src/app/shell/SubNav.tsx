"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { colors, fontWeight } from "@overlaysys/ui";
import { isCloudMode } from "@/lib/mode";
import { AccountMenu } from "@/app/components/AccountMenu";
import { destinationsFor, type AreaId } from "./areas";

function isActive(pathname: string, route: string): boolean {
  if (route === "/") return pathname === "/";
  return pathname === route || pathname.startsWith(route + "/");
}

/** Left sub-nav for Library and Settings. Live has none. */
export function SubNav({ area }: { area: AreaId }) {
  const pathname = usePathname() ?? "/";
  const items = destinationsFor(area, isCloudMode());
  return (
    <aside
      style={{
        width: 168,
        flexShrink: 0,
        background: colors.surface,
        borderRight: `1px solid ${colors.border}`,
        display: "flex",
        flexDirection: "column",
        padding: "12px 8px",
        gap: 2,
      }}
    >
      {items.map((d) => {
        const on = isActive(pathname, d.route);
        const Icon = d.icon;
        return (
          <Link
            key={d.route}
            href={d.route}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "7px 9px",
              borderRadius: 7,
              textDecoration: "none",
              fontWeight: fontWeight.medium,
              color: on ? colors.text : colors.textDim,
              background: on ? colors.brandSubtle : "transparent",
            }}
          >
            <Icon size={16} aria-hidden />
            {d.label}
          </Link>
        );
      })}
      {area === "settings" && (
        <>
          <div style={{ flex: 1 }} />
          <div style={{ borderTop: `1px solid ${colors.border}`, paddingTop: 8 }}>
            <AccountMenu />
          </div>
        </>
      )}
    </aside>
  );
}
