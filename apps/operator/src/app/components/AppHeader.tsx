"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useStore } from "@/lib/store";
import { getClient } from "@/lib/useWs";
import { Pill, type PillTone } from "@overlaysys/ui";
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { ProjectSwitcher } from "@/app/components/ProjectSwitcher";
import { CloudSignInButton } from "@/app/components/CloudSignInButton";
import { isCloudMode } from "@/lib/mode";

// `hideInCloud` marks routes that don't make sense in the web deploy. The
// Show view drives a live device (channel takes, song mode, etc.) and is
// pure noise without a paired Electron instance — same reason TakePanel
// disables itself in cloud mode.
const NAV_LINKS: { href: string; label: string; hideInCloud?: boolean }[] = [
  { href: "/", label: "Show", hideInCloud: true },
  { href: "/projects", label: "Projects" },
  { href: "/shows", label: "Shows" },
  { href: "/hotcards", label: "Hotcards" },
  { href: "/timer", label: "Timer" },
  { href: "/songs", label: "Songs" },
  { href: "/stt", label: "STT" },
  { href: "/design", label: "Design" },
  { href: "/channels", label: "Channels" },
  { href: "/data", label: "Data" },
];

export function AppHeader({
  title,
  context,
  actions,
}: {
  title?: ReactNode; // page title rendered with consistent styling
  context?: ReactNode; // page-specific info between nav and actions (e.g. show picker)
  actions?: ReactNode; // page-specific buttons aligned to the right edge
}) {
  const pathname = usePathname() ?? "/";
  const conn = useStore((s) => s.conn);
  const dot = { connecting: "🟡", open: "🟢", closed: "🔴" }[conn];
  const cloud = isCloudMode();
  const visibleNavLinks = useMemo(
    () => NAV_LINKS.filter((l) => !(cloud && l.hideInCloud)),
    [cloud],
  );

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
        {visibleNavLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            style={isActive(link.href) ? navLinkActiveStyle : navLinkStyle}
          >
            {link.label}
          </Link>
        ))}
      </nav>
      {title !== undefined && (
        <h1 style={{ margin: 0, marginLeft: 8, fontSize: 16, fontWeight: 600 }}>{title}</h1>
      )}
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
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 }}>
        <ProjectSwitcher />
        <CloudSignInButton />
        {actions}
        <SttStatusPill />
        <ConnectionPill conn={conn} dot={dot} />
      </div>
    </header>
  );
}

/**
 * Connection state + server port. The port matters when external tools
 * (Companion, Stream Deck) need to know where the server is listening —
 * especially in the packaged Electron build where the port can differ
 * from the dev default.
 */
function ConnectionPill({ conn, dot }: { conn: string; dot: string }) {
  const [port, setPort] = useState<string>("");
  useEffect(() => {
    try {
      const url = new URL(getClient().getUrl());
      setPort(url.port || (url.protocol === "wss:" ? "443" : "80"));
    } catch {
      // ignore parse errors — fall back to no port
    }
  }, [conn]);
  return (
    <span style={{ color: "var(--text-dim)", fontSize: 12 }}>
      {dot} {conn}
      {port && <span style={{ marginLeft: 4 }}>:{port}</span>}
    </span>
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
  if (!status) return null;
  // On /stt itself the page already shows a big status pill in its actions
  // slot; suppress the global one to avoid duplication.
  if (pathname === "/stt" || pathname.startsWith("/stt/")) return null;

  const TONES: Record<string, PillTone> = {
    idle: "dim",
    starting: "warn",
    running: "good",
    stopped: "dim",
    error: "bad",
  };
  const tone = TONES[status.state] ?? "dim";

  return (
    <Link
      href="/stt"
      title={
        status.state === "error" && status.lastError
          ? `STT: ${status.state} — ${status.lastError}`
          : `STT: ${status.state}`
      }
      style={{ textDecoration: "none" }}
    >
      <Pill tone={tone} uppercase>
        🎤 {status.state}
      </Pill>
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
