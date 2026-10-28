"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { colors, fontWeight } from "@overlaysys/ui";
import { isCloudMode } from "@/lib/mode";
import { AREAS, destinationsFor, type AreaId } from "./areas";

function isActive(pathname: string, route: string): boolean {
  if (route === "/") return pathname === "/";
  return pathname === route || pathname.startsWith(route + "/");
}

/**
 * Left sub-nav for Library and Settings. Live has none. Labels are always
 * visible, at every width (see .shell-subnav in globals.css). The account menu lives in
 * the top bar so it's reachable from every area.
 */
export function SubNav({ area }: { area: AreaId }) {
  const pathname = usePathname() ?? "/";
  const items = destinationsFor(area, isCloudMode());
  return (
    <nav
      aria-label={AREAS[area].label}
      className="shell-subnav"
      style={{
        flexShrink: 0,
        background: colors.surface,
        borderRight: `1px solid ${colors.border}`,
        display: "flex",
        flexDirection: "column",
        gap: 2,
        overflowY: "auto",
      }}
    >
      {items.map((d) => {
        const on = isActive(pathname, d.route);
        const Icon = d.icon;
        return (
          <Link
            key={d.route}
            href={d.route}
            aria-current={on ? "page" : undefined}
            title={d.label}
            aria-label={d.label}
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
              whiteSpace: "nowrap",
            }}
          >
            <Icon size={16} aria-hidden style={{ flexShrink: 0 }} />
            <span>{d.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
