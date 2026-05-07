"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useStore } from "@/lib/store";
import type { CSSProperties, ReactNode } from "react";

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
        <SttStatusPill />
        <span style={{ color: "var(--text-dim)", fontSize: 12 }}>
          {dot} {conn}
        </span>
      </div>
    </header>
  );
}

/**
 * Tiny STT spawner status indicator. Always rendered in the global header
 * so the operator can see at a glance whether STT is up — no matter which
 * page they're on. Click navigates to /stt for control + logs.
 */
function SttStatusPill() {
  const status = useStore((s) => s.sttSpawnerStatus);
  const pathname = usePathname() ?? "/";
  // No status yet (haven't received the first stt_spawner_status broadcast)
  // — render nothing rather than a confusing "idle" stub.
  if (!status) return null;
  // On /stt itself the page already shows a big status pill in its actions
  // slot; suppress the global one to avoid duplication.
  if (pathname === "/stt" || pathname.startsWith("/stt/")) return null;

  const colors: Record<string, string> = {
    idle: "var(--text-dim)",
    starting: "#fbbf24",
    running: "#4ade80",
    stopped: "var(--text-dim)",
    error: "#ef4444",
  };
  const color = colors[status.state] ?? "var(--text-dim)";

  return (
    <Link
      href="/stt"
      title={
        status.state === "error" && status.lastError
          ? `STT: ${status.state} — ${status.lastError}`
          : `STT: ${status.state}`
      }
      style={{
        fontSize: 11,
        padding: "3px 10px",
        borderRadius: 999,
        border: `1px solid ${color}`,
        color,
        textDecoration: "none",
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: 1,
      }}
    >
      🎤 {status.state}
    </Link>
  );
}

const navLinkStyle: CSSProperties = {
  color: "var(--text-dim)",
  textDecoration: "none",
  fontSize: 13,
  padding: "4px 10px",
  borderRadius: 4,
};

const navLinkActiveStyle: CSSProperties = {
  ...navLinkStyle,
  color: "var(--text)",
  background: "var(--panel-2)",
};
