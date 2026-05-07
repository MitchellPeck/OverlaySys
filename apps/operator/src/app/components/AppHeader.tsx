"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useStore } from "@/lib/store";
import type { ReactNode } from "react";

const NAV_LINKS = [
  { href: "/", label: "Show" },
  { href: "/shows", label: "Shows" },
  { href: "/songs", label: "Songs" },
  { href: "/stt", label: "STT" },
  { href: "/design", label: "Design" },
  { href: "/channels", label: "Channels" },
];

export function AppHeader({
  context,
  actions,
}: {
  context?: ReactNode; // page-specific info between nav and actions (e.g. show title)
  actions?: ReactNode; // page-specific buttons aligned to the right edge
}) {
  const pathname = usePathname() ?? "/";
  const conn = useStore((s) => s.conn);
  const dot = { connecting: "🟡", open: "🟢", closed: "🔴" }[conn];

  function isActive(href: string): boolean {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(href + "/");
  }

  return (
    <header
      style={{
        padding: "10px 16px",
        borderBottom: "1px solid var(--border)",
        background: "var(--panel)",
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      <strong>OverlaySys</strong>
      <span style={{ color: "var(--text-dim)" }}>Operator</span>
      <nav style={{ marginLeft: 24, display: "flex", gap: 12 }}>
        {NAV_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            style={isActive(link.href) ? navLinkActiveStyle : navLinkStyle}
          >
            {link.label}
          </Link>
        ))}
      </nav>
      {context && (
        <div
          style={{
            marginLeft: 8,
            color: "var(--text-dim)",
            fontSize: 13,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          {context}
        </div>
      )}
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
        {actions}
        <span style={{ color: "var(--text-dim)", fontSize: 12 }}>
          {dot} {conn}
        </span>
      </div>
    </header>
  );
}

const navLinkStyle: React.CSSProperties = {
  color: "var(--text-dim)",
  textDecoration: "none",
  fontSize: 13,
  padding: "4px 10px",
  borderRadius: 4,
};

const navLinkActiveStyle: React.CSSProperties = {
  ...navLinkStyle,
  color: "var(--text)",
  background: "var(--panel-2)",
};
