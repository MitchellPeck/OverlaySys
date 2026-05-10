"use client";

import { useEffect } from "react";
import { colors } from "@overlaysys/ui";
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

  const showMetas = useStore((s) => s.showMetas);
  const show = useStore((s) => s.show);
  const programSession = useStore((s) => s.songSessions["program"]);
  const previewSession = useStore((s) => s.songSessions["preview"]);
  const activeSongChannel: "program" | "preview" | null = programSession
    ? "program"
    : previewSession
    ? "preview"
    : null;
  const activeSongSession = programSession ?? previewSession ?? null;
  useEffect(() => {
    if (show || showMetas.length === 0) return;
    const saved =
      typeof window !== "undefined" ? localStorage.getItem(SELECTED_SHOW_KEY) : null;
    const targetId =
      saved && showMetas.some((m) => m.id === saved) ? saved : showMetas[0]!.id;
    send({ type: "get_show", showId: targetId });
  }, [show, showMetas, send]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (show) localStorage.setItem(SELECTED_SHOW_KEY, show.id);
  }, [show?.id]);

  useEffect(() => {
    const off = getClient().on((msg) => {
      if (msg.type === "show") useStore.getState().setShow(msg.show);
    });
    return off;
  }, []);

  useGlobalShortcuts();

  const songModeActive = activeSongSession !== null;
  return (
    <main
      style={{
        position: "fixed",
        inset: 0,
        display: "grid",
        gridTemplateRows: songModeActive
          ? "auto minmax(0, 1fr) auto"
          : "auto minmax(0, 1fr)",
        overflow: "hidden",
      }}
    >
      <AppHeader />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: songModeActive
            ? "260px minmax(0, 1fr)"
            : "minmax(360px, 1fr) 360px 320px",
          gap: 1,
          background: colors.border,
          minHeight: 0,
        }}
      >
        <ShellPanel title="Rundown" actions={<ShowPicker />}>
          <Rundown />
        </ShellPanel>

        <ShellPanel
          title={
            activeSongChannel === "program"
              ? "Song mode (PGM)"
              : activeSongChannel === "preview"
              ? "Song mode (PVW · cued)"
              : "Take controls"
          }
        >
          {activeSongSession && activeSongChannel ? (
            <SongModePanel channel={activeSongChannel} session={activeSongSession} />
          ) : (
            <TakePanel />
          )}
        </ShellPanel>

        {!songModeActive && (
          <ShellPanel title="Channels">
            <ChannelsList />
          </ShellPanel>
        )}
      </div>

      {songModeActive && (
        <section
          style={{
            background: colors.panel,
            borderTop: `1px solid ${colors.border}`,
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
                color: colors.textDim,
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

/**
 * Operator shell pane — the fixed three-column layout's panel header style is
 * domain-specific (small uppercase letterspaced label) and distinct from the
 * bordered card primitive. Kept local so the operator hot-path layout doesn't
 * pull in @overlaysys/ui Panel's title typography.
 */
function ShellPanel({
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
        background: colors.panel,
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
            color: colors.textDim,
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
