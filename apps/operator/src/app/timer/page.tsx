"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/app/components/AppHeader";
import { TimerPanel } from "@/app/components/TimerPanel";
import { ActiveTimersPanel } from "@/app/components/ActiveTimersPanel";
import { ChannelsList } from "@/app/components/ChannelsList";
import { isCloudMode } from "@/lib/mode";
import { colors } from "@overlaysys/ui";

/**
 * Dedicated route for time-based takes — countdowns, count-ups, clocks. The
 * panel is wider than TakePanel since it surfaces a live preview for every
 * time field; the right rail mirrors the show page's Channels panel so
 * operators can see which channels are live while they configure a timer.
 *
 * Cloud build redirects to /shows — firing live takes requires a paired
 * Electron renderer. Same pattern as the Show page in `/`.
 */
export default function TimerPage() {
  const router = useRouter();
  useEffect(() => {
    if (isCloudMode()) router.replace("/shows");
  }, [router]);
  if (isCloudMode()) return null;

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
      <AppHeader title="Timer" />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) 320px",
          gap: 1,
          background: colors.border,
          minHeight: 0,
        }}
      >
        <section style={{ background: colors.panel, padding: 16, overflow: "auto" }}>
          <div style={{ maxWidth: 720, display: "flex", flexDirection: "column", gap: 24 }}>
            <div>
              <SectionLabel>Start</SectionLabel>
              <TimerPanel />
            </div>
            <div>
              <SectionLabel>Active timers</SectionLabel>
              <ActiveTimersPanel />
            </div>
          </div>
        </section>
        <section style={{ background: colors.panel, padding: 16, overflow: "auto" }}>
          <SectionLabel>Channels</SectionLabel>
          <ChannelsList />
        </section>
      </div>
    </main>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3
      style={{
        margin: 0,
        marginBottom: 12,
        fontSize: 11,
        textTransform: "uppercase",
        letterSpacing: 1.2,
        color: colors.textDim,
      }}
    >
      {children}
    </h3>
  );
}
