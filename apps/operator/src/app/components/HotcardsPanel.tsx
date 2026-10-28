"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { HotcardMeta } from "@overlaysys/core";
import { Button, Kbd, PanelHeader, colors } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { hotcardAirState, type AirState } from "@/lib/rowAirState";
import { hotcardKeyLabel } from "@/lib/shortcutGuards";
import { useWs } from "@/lib/useWs";

type View = "grid" | "list";
const VIEW_STORAGE_KEY = "overlaysys:hotcardsView";

export function HotcardsPanel() {
  const { send } = useWs();
  const conn = useStore((s) => s.conn);
  const hotcards = useStore((s) => s.hotcards);
  const hotcardCache = useStore((s) => s.hotcardCache);
  const templates = useStore((s) => s.templates);
  const selectedHotcardId = useStore((s) => s.selectedHotcardId);
  const setSelectedHotcard = useStore((s) => s.setSelectedHotcard);

  const channelStates = useStore((s) => s.channelStates);
  const [view, setView] = useState<View>("grid");
  // On-air only where the store already knows it: a live graphic with this
  // hotcard's template and data.
  const air: Record<string, AirState> = {};
  for (const h of hotcards) air[h.id] = hotcardAirState(hotcardCache[h.id], channelStates);
  const disconnected = conn !== "open";

  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = window.localStorage.getItem(VIEW_STORAGE_KEY);
    if (saved === "grid" || saved === "list") setView(saved);
  }, []);

  function persistView(v: View) {
    setView(v);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(VIEW_STORAGE_KEY, v);
    }
  }

  // Hydrate the cache for any meta we don't yet have a full body for. The body
  // is what we need to fire a take — list_hotcards only carries name+template.
  useEffect(() => {
    if (conn !== "open") return;
    for (const h of hotcards) {
      if (!hotcardCache[h.id]) send({ type: "get_hotcard", hotcardId: h.id });
    }
  }, [hotcards, hotcardCache, conn, send]);

  function fire(meta: HotcardMeta, target: "preview" | "program") {
    const full = hotcardCache[meta.id];
    if (!full) {
      // Cache miss — re-request and skip; the user can click again once it lands.
      send({ type: "get_hotcard", hotcardId: meta.id });
      return;
    }
    const channel = full.channelHint ?? target;
    if (target === "preview") {
      send({ type: "cue", channel, templateId: full.templateId, data: full.data });
    } else {
      send({ type: "take", channel, templateId: full.templateId, data: full.data });
    }
  }

  const header = (
    <PanelHeader
      title={`Hotcards · ${hotcards.length}`}
      right={
        <>
          <ViewToggleButton active={view === "list"} onClick={() => persistView("list")} label="List" />
          <ViewToggleButton active={view === "grid"} onClick={() => persistView("grid")} label="Grid" />
          <Link href="/hotcards" style={{ color: colors.textDim, fontSize: 11, textDecoration: "none" }}>
            Manage
          </Link>
        </>
      }
    />
  );

  if (hotcards.length === 0) {
    return (
      <section style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
        {header}
        <div style={{ padding: 12, overflow: "auto", flex: 1, minHeight: 0 }}>
          <p style={{ color: colors.textDim, fontSize: 12 }}>
            No hotcards yet.{" "}
            <Link href="/hotcards" style={{ color: colors.accent2 }}>
              Create one
            </Link>
            {" "}to keep reusable graphics at hand.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      {header}
      <div style={{ padding: 12, overflow: "auto", flex: 1, minHeight: 0 }}>
        {view === "grid" ? (
          <GridView
            hotcards={hotcards}
            templates={templates}
            selectedId={selectedHotcardId}
            onSelect={setSelectedHotcard}
            onCue={(h) => fire(h, "preview")}
            onTake={(h) => fire(h, "program")}
            air={air}
            disconnected={disconnected}
          />
        ) : (
          <ListView
            hotcards={hotcards}
            templates={templates}
            selectedId={selectedHotcardId}
            onSelect={setSelectedHotcard}
            onCue={(h) => fire(h, "preview")}
            onTake={(h) => fire(h, "program")}
            air={air}
            disconnected={disconnected}
          />
        )}
      </div>
    </section>
  );
}

function ViewToggleButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "2px 8px",
        background: active ? colors.panel2 : "transparent",
        color: active ? colors.text : colors.textDim,
        border: `1px solid ${colors.border}`,
        borderRadius: 4,
        fontSize: 11,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function GridView({
  hotcards,
  templates,
  selectedId,
  onSelect,
  onCue,
  onTake,
  air,
  disconnected,
}: {
  hotcards: HotcardMeta[];
  templates: { id: string; name: string }[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCue: (h: HotcardMeta) => void;
  onTake: (h: HotcardMeta) => void;
  air: Record<string, AirState>;
  disconnected: boolean;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        gap: 8,
      }}
    >
      {hotcards.map((h, i) => {
        const tplName = templates.find((t) => t.id === h.templateId)?.name ?? h.templateId;
        const selected = h.id === selectedId;
        const fkey = hotcardKeyLabel(i);
        const onAir = air[h.id];
        return (
          <div
            key={h.id}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(h.id)}
            onDoubleClick={() => {
              onSelect(h.id);
              onTake(h);
            }}
            onKeyDown={(e) => {
              if (e.key === " " || e.key === "Enter") {
                // Don't intercept — let the global shortcuts handler run with
                // the now-selected hotcard. We still update the selection on
                // keyboard activation so click-to-focus + key behaves naturally.
                onSelect(h.id);
              }
            }}
            style={{
              textAlign: "left",
              background: selected ? "rgba(255, 58, 58, 0.12)" : colors.panel2,
              border: onAir === "program"
                ? `2px solid ${colors.onair}`
                : onAir === "preview"
                ? `1px solid ${colors.ok}`
                : selected
                ? `1px solid ${colors.accent}`
                : `1px solid ${colors.border}`,
              borderRadius: 6,
              padding: onAir === "program" ? 9 : 10,
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              gap: 4,
              minHeight: 78,
            }}
            aria-label={`${h.name}${onAir === "program" ? " (on air)" : onAir === "preview" ? " (on preview)" : ""}`}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: colors.text, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {h.name}
              </div>
              {fkey && <Kbd title={`${fkey} take · Shift+${fkey} cue`}>{fkey}</Kbd>}
            </div>
            <div
              style={{
                fontSize: 10,
                color: colors.textDim,
                fontFamily: "ui-monospace, monospace",
              }}
              title={tplName}
            >
              {tplName}
            </div>
            <div style={{ display: "flex", gap: 4, marginTop: "auto", paddingTop: 6 }}>
              <Button
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(h.id);
                  onCue(h);
                }}
                size="sm"
                disabled={disconnected}
                style={{ flex: 1, fontSize: 11 }}
              >
                Cue
              </Button>
              <Button
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(h.id);
                  onTake(h);
                }}
                variant="primary"
                size="sm"
                disabled={disconnected}
                style={{ flex: 1, fontSize: 11 }}
              >
                Take
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ListView({
  hotcards,
  templates,
  selectedId,
  onSelect,
  onCue,
  onTake,
  air,
  disconnected,
}: {
  hotcards: HotcardMeta[];
  templates: { id: string; name: string }[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCue: (h: HotcardMeta) => void;
  onTake: (h: HotcardMeta) => void;
  air: Record<string, AirState>;
  disconnected: boolean;
}) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <tbody>
        {hotcards.map((h, i) => {
          const tplName = templates.find((t) => t.id === h.templateId)?.name ?? h.templateId;
          const selected = h.id === selectedId;
          const fkey = hotcardKeyLabel(i);
          const onAir = air[h.id];
          return (
            <tr
              key={h.id}
              onClick={() => onSelect(h.id)}
              onDoubleClick={() => {
                onSelect(h.id);
                onTake(h);
              }}
              style={{
                background: selected ? "rgba(255, 58, 58, 0.12)" : "transparent",
                borderLeft: onAir === "program"
                  ? `3px solid ${colors.onair}`
                  : onAir === "preview"
                  ? `3px solid ${colors.ok}`
                  : selected
                  ? `3px solid ${colors.accent}`
                  : "3px solid transparent",
                cursor: "pointer",
              }}
            >
              <td style={td()}>
                <div style={{ fontWeight: 600, display: "flex", gap: 6, alignItems: "baseline" }}>
                  {h.name}
                  {fkey && <Kbd title={`${fkey} take · Shift+${fkey} cue`}>{fkey}</Kbd>}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: colors.textDim,
                    fontFamily: "ui-monospace, monospace",
                    marginTop: 1,
                  }}
                >
                  {tplName}
                </div>
              </td>
              <td style={{ ...td(), width: 132, textAlign: "right" }}>
                <div style={{ display: "inline-flex", gap: 4 }}>
                  <Button
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(h.id);
                      onCue(h);
                    }}
                    size="sm"
                    disabled={disconnected}
                    style={{ width: 56, fontSize: 11 }}
                  >
                    Cue
                  </Button>
                  <Button
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(h.id);
                      onTake(h);
                    }}
                    variant="primary"
                    size="sm"
                    disabled={disconnected}
                    style={{ width: 56, fontSize: 11 }}
                  >
                    Take
                  </Button>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function td(): React.CSSProperties {
  return { padding: "8px", borderBottom: `1px solid ${colors.border}` };
}
