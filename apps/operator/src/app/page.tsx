"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { colors } from "@overlaysys/ui";
import { useWs, getClient } from "@/lib/useWs";
import { useStore } from "@/lib/store";
import { isCloudMode } from "@/lib/mode";
import { ShowPicker } from "./components/ShowPicker";
import { Rundown } from "./components/Rundown";
import { Monitors } from "./components/Monitors";
import { StageArea } from "./components/StageArea";
import { LiveDrawer } from "./components/LiveDrawer";
import { useLivePrefs } from "./hooks/useLivePrefs";
import { useHotcardHydration } from "./hooks/useHotcardHydration";
import { DRAWER_COLLAPSED_WIDTH, DRAWER_OPEN_WIDTH } from "@/lib/liveDrawerModel";
import { ConsoleBottomBar } from "./components/ConsoleBottomBar";
import { useGlobalShortcuts } from "./hooks/useGlobalShortcuts";
import { PageChrome } from "./shell/PageChrome";

const SELECTED_SHOW_KEY = "overlaysys:selectedShowId";

export default function LivePage() {
  const router = useRouter();
  // The Live view drives a paired Electron renderer — pointless on the web
  // deploy. Redirect to the Shows list so the user lands on something they
  // can actually interact with. Done in an effect so the redirect happens
  // after hydration; SSR-friendly even though Next.js exports static here.
  useEffect(() => {
    if (isCloudMode()) router.replace("/shows");
  }, [router]);
  if (isCloudMode()) {
    return null;
  }

  return <LivePageLocal />;
}

function LivePageLocal() {
  const { send } = useWs();

  const showMetas = useStore((s) => s.showMetas);
  const show = useStore((s) => s.show);
  useEffect(() => {
    if (show || showMetas.length === 0) return;
    const saved =
      typeof window !== "undefined" ? localStorage.getItem(SELECTED_SHOW_KEY) : null;
    const targetId =
      saved && showMetas.some((m) => m.id === saved) ? saved : showMetas[0]!.id;
    // useWs only adopts a show Live asked for.
    useStore.getState().setRequestedShowId(targetId);
    send({ type: "get_show", showId: targetId });
  }, [show, showMetas, send]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (show) localStorage.setItem(SELECTED_SHOW_KEY, show.id);
  }, [show?.id]);

  // useWs only applies a `show` broadcast for the loaded show, so a save of
  // some other show (any console) never replaces this rundown. The one other
  // show we accept is the one the Show picker just asked for.
  useEffect(() => {
    const off = getClient().on((msg) => {
      if (msg.type === "show") useStore.getState().adoptRequestedShow(msg.show);
    });
    return off;
  }, []);

  useGlobalShortcuts();
  useHotcardHydration();
  const { drawerOpen } = useLivePrefs();

  return (
    <div
      style={{
        height: "100%",
        display: "grid",
        gridTemplateRows: "minmax(0,1fr) auto",
        // One column bounded by the viewport: wide content (a video transport) can't grow the page.
        gridTemplateColumns: "minmax(0, 1fr)",
        overflow: "hidden",
      }}
    >
      <PageChrome title="Live" context={<ShowPicker />} />
      <div
        style={{
          display: "grid",
          // 300px rundown; narrows to 240px on small screens (1024) so the centre keeps room.
          gridTemplateColumns: "clamp(240px, 22vw, 300px) minmax(0, 1fr) auto",
          gap: 1,
          background: colors.border,
          minHeight: 0,
        }}
      >
        <section aria-label="Rundown" style={columnStyle}>
          {/* The rundown's own header line names the show and counts its items. */}
          <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
            <Rundown />
          </div>
        </section>
        <section aria-label="Monitors and selected item" style={columnStyle}>
          {/* Monitors + air controls in one fixed row; the selected item scrolls below. */}
          <Monitors />
          <StageArea />
        </section>
        {/* [P2a.15] right drawer */}
        <section style={{ ...columnStyle, width: drawerOpen ? DRAWER_OPEN_WIDTH : DRAWER_COLLAPSED_WIDTH }}>
          <LiveDrawer />
        </section>
        {/* [/P2a.15] */}
      </div>
      <ConsoleBottomBar />
    </div>
  );
}

const columnStyle: React.CSSProperties = {
  background: colors.panel,
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  overflow: "hidden",
};
