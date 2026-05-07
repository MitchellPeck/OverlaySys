"use client";

import { useEffect } from "react";
import { useWs, getClient } from "@/lib/useWs";
import { useStore } from "@/lib/store";
import { ShowPicker } from "./components/ShowPicker";
import { Rundown } from "./components/Rundown";
import { TakePanel } from "./components/TakePanel";
import { ChannelsList } from "./components/ChannelsList";
import { useGlobalShortcuts } from "./hooks/useGlobalShortcuts";
import { SongModePanel } from "./components/SongModePanel";
import { AppHeader } from "./components/AppHeader";

const SELECTED_SHOW_KEY = "overlaysys:selectedShowId";

export default function ShowPage() {
  const { send } = useWs();

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
        // When a song is live, add a third row for a horizontal channels
        // strip across the bottom. Otherwise normal 2-row layout.
        gridTemplateRows: programSession
          ? "auto minmax(0, 1fr) auto"
          : "auto minmax(0, 1fr)",
        overflow: "hidden",
      }}
    >
      <AppHeader />
      <div
        style={{
          display: "grid",
          // When a song is live, collapse the side panels and give song mode
          // the page. Rundown shrinks to a narrow context column; Channels
          // moves to the bottom strip below.
          gridTemplateColumns: programSession
            ? "260px minmax(0, 1fr)"
            : "minmax(360px, 1fr) 360px 320px",
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

        {!programSession && (
          <Panel title="Channels">
            <ChannelsList />
          </Panel>
        )}
      </div>

      {programSession && (
        <section
          style={{
            background: "var(--panel)",
            borderTop: "1px solid var(--border)",
            padding: "10px 16px",
            overflowX: "auto",
            overflowY: "auto",
            maxHeight: 380,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", marginBottom: 8, gap: 8 }}>
            <h3
              style={{
                margin: 0,
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: 1.2,
                color: "var(--text-dim)",
              }}
            >
              Channels & Preview
            </h3>
          </div>
          <div
            style={{
              display: "flex",
              gap: 12,
              alignItems: "stretch",
              flexWrap: "nowrap",
            }}
          >
            <ChannelsList orientation="horizontal" />
          </div>
        </section>
      )}
    </main>
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

