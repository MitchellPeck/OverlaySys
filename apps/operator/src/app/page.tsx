"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { colors, PanelHeader } from "@overlaysys/ui";
import { useWs, getClient } from "@/lib/useWs";
import { useStore } from "@/lib/store";
import { isCloudMode } from "@/lib/mode";
import { ShowPicker } from "./components/ShowPicker";
import { Rundown } from "./components/Rundown";
import { Monitors } from "./components/Monitors";
import { StageArea } from "./components/StageArea";
import { LiveDrawer } from "./components/LiveDrawer";
import { useLivePrefs } from "./hooks/useLivePrefs";
import { DRAWER_COLLAPSED_WIDTH, DRAWER_OPEN_WIDTH } from "@/lib/liveDrawerModel";
import { ConsoleBottomBar } from "./components/ConsoleBottomBar";
import { useGlobalShortcuts } from "./hooks/useGlobalShortcuts";
import { PageChrome } from "./shell/PageChrome";

const SELECTED_SHOW_KEY = "overlaysys:selectedShowId";

export default function ShowPage() {
  const router = useRouter();
  // The Show view drives a paired Electron renderer — pointless on the web
  // deploy. Redirect to the Shows list so the user lands on something they
  // can actually interact with. Done in an effect so the redirect happens
  // after hydration; SSR-friendly even though Next.js exports static here.
  useEffect(() => {
    if (isCloudMode()) router.replace("/shows");
  }, [router]);
  if (isCloudMode()) {
    return null;
  }

  return <ShowPageLocal />;
}

function ShowPageLocal() {
  const { send } = useWs();

  const showMetas = useStore((s) => s.showMetas);
  const show = useStore((s) => s.show);
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
  const { drawerOpen } = useLivePrefs();

  return (
    <div style={{ height: "100%", display: "grid", gridTemplateRows: "minmax(0,1fr) auto", overflow: "hidden" }}>
      <PageChrome title="Show" context={<ShowPicker />} />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `320px minmax(0, 1fr) ${drawerOpen ? DRAWER_OPEN_WIDTH : DRAWER_COLLAPSED_WIDTH}px`,
          gap: 1,
          background: colors.border,
          minHeight: 0,
        }}
      >
        <section style={columnStyle}>
          <PanelHeader title="Rundown" right={show ? `${show.rows.length} items` : undefined} />
          <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
            <Rundown />
          </div>
        </section>
        <section style={columnStyle}>
          <Monitors />
          <StageArea />
        </section>
        {/* [P2a.15] right drawer */}
        <section style={columnStyle}>
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
