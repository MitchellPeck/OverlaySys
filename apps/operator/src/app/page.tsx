"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useWs, getClient } from "@/lib/useWs";
import { useStore } from "@/lib/store";
import { ShowPicker } from "./components/ShowPicker";
import { Rundown } from "./components/Rundown";
import { TakePanel } from "./components/TakePanel";
import { ChannelsList } from "./components/ChannelsList";
import { useGlobalShortcuts } from "./hooks/useGlobalShortcuts";
import { SongModePanel } from "./components/SongModePanel";

const SELECTED_SHOW_KEY = "overlaysys:selectedShowId";

export default function ShowPage() {
  const { send } = useWs();
  const conn = useStore((s) => s.conn);

  // Auto-load: prefer the show the operator had selected last (persisted in
  // localStorage so a refresh doesn't silently jump to a different show);
  // fall back to the first available show if the saved id no longer exists.
  const showMetas = useStore((s) => s.showMetas);
  const show = useStore((s) => s.show);
  const programSession = useStore((s) => s.songSessions["program"]);
  useEffect(() => {
    if (show || showMetas.length === 0) return;
    const saved =
      typeof window !== "undefined" ? localStorage.getItem(SELECTED_SHOW_KEY) : null;
    const targetId =
      saved && showMetas.some((m) => m.id === saved) ? saved : showMetas[0]!.id;
    send({ type: "get_show", showId: targetId });
  }, [show, showMetas, send]);

  // Persist the loaded show's id whenever it changes so a refresh restores it.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (show) localStorage.setItem(SELECTED_SHOW_KEY, show.id);
  }, [show?.id]);

  // Subscribe to incoming "show" messages even when arriving via auto-load.
  useEffect(() => {
    const off = getClient().on((msg) => {
      if (msg.type === "show") useStore.getState().setShow(msg.show);
    });
    return off;
  }, []);

  useGlobalShortcuts();

  return (
    <main
      style={{
        position: "fixed",
        inset: 0,
        display: "grid",
        gridTemplateRows: "auto minmax(0, 1fr)",
        overflow: "hidden",
      }}
    >
      <Header conn={conn} />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(360px, 1fr) 360px 320px",
          gap: 1,
          background: "var(--border)",
          minHeight: 0,
        }}
      >
        <Panel title="Rundown" actions={<ShowPicker />}>
          <Rundown />
        </Panel>

        <Panel title={programSession ? "Song mode" : "Take controls"}>
          {programSession ? (
            <SongModePanel channel="program" session={programSession} />
          ) : (
            <TakePanel />
          )}
        </Panel>

        <Panel title="Channels">
          <ChannelsList />
        </Panel>
      </div>
    </main>
  );
}

function Header({ conn }: { conn: "connecting" | "open" | "closed" }) {
  const dot = { connecting: "🟡", open: "🟢", closed: "🔴" }[conn];
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
      <span style={{ color: "var(--text-dim)" }}>· operator</span>
      <nav style={{ marginLeft: 24, display: "flex", gap: 12 }}>
        <Link href="/" style={navLinkActiveStyle}>Show</Link>
        <Link href="/shows" style={navLinkStyle}>Shows</Link>
        <Link href="/songs" style={navLinkStyle}>Songs</Link>
        <Link href="/design" style={navLinkStyle}>Design</Link>
        <Link href="/channels" style={navLinkStyle}>Channels</Link>
      </nav>
      <span style={{ marginLeft: "auto", color: "var(--text-dim)", fontSize: 12 }}>
        {dot} {conn}
      </span>
    </header>
  );
}

function Panel({
  title,
  actions,
  children,
}: {
  title: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        background: "var(--panel)",
        padding: 16,
        overflow: "auto",
        minHeight: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", marginBottom: 12, gap: 8 }}>
        <h3
          style={{
            margin: 0,
            fontSize: 11,
            textTransform: "uppercase",
            letterSpacing: 1.2,
            color: "var(--text-dim)",
          }}
        >
          {title}
        </h3>
        <div style={{ marginLeft: "auto" }}>{actions}</div>
      </div>
      {children}
    </section>
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
