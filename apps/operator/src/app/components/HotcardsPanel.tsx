"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { HotcardMeta } from "@overlaysys/core";
import { Button, colors } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
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

  const [view, setView] = useState<View>("grid");

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
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
      <h3
        style={{
          margin: 0,
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: 1.2,
          color: colors.textDim,
        }}
      >
        Hotcards
      </h3>
      <span style={{ color: colors.textDim, fontSize: 11 }}>
        {hotcards.length}
      </span>
      <div style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
        <ViewToggleButton
          active={view === "list"}
          onClick={() => persistView("list")}
          label="List"
        />
        <ViewToggleButton
          active={view === "grid"}
          onClick={() => persistView("grid")}
          label="Grid"
        />
        <Link
          href="/hotcards"
          style={{
            color: colors.textDim,
            fontSize: 11,
            textDecoration: "none",
            padding: "2px 8px",
            borderRadius: 4,
            border: `1px solid ${colors.border}`,
          }}
        >
          Manage
        </Link>
      </div>
    </div>
  );

  if (hotcards.length === 0) {
    return (
      <section style={{ paddingTop: 16, borderTop: `1px solid ${colors.border}`, marginTop: 16 }}>
        {header}
        <p style={{ color: colors.textDim, fontSize: 12 }}>
          No hotcards yet.{" "}
          <Link href="/hotcards" style={{ color: colors.accent2 }}>
            Create one
          </Link>
          {" "}to keep reusable graphics at hand.
        </p>
      </section>
    );
  }

  return (
    <section style={{ paddingTop: 16, borderTop: `1px solid ${colors.border}`, marginTop: 16 }}>
      {header}
      {view === "grid" ? (
        <GridView
          hotcards={hotcards}
          templates={templates}
          selectedId={selectedHotcardId}
          onSelect={setSelectedHotcard}
          onCue={(h) => fire(h, "preview")}
          onTake={(h) => fire(h, "program")}
        />
      ) : (
        <ListView
          hotcards={hotcards}
          templates={templates}
          selectedId={selectedHotcardId}
          onSelect={setSelectedHotcard}
          onCue={(h) => fire(h, "preview")}
          onTake={(h) => fire(h, "program")}
        />
      )}
      <p style={{ marginTop: 8, fontSize: 11, color: colors.textDim }}>
        Click to select · Enter to cue · Space to take · double-click to fire instantly
      </p>
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
}: {
  hotcards: HotcardMeta[];
  templates: { id: string; name: string }[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCue: (h: HotcardMeta) => void;
  onTake: (h: HotcardMeta) => void;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
        gap: 8,
      }}
    >
      {hotcards.map((h) => {
        const tplName = templates.find((t) => t.id === h.templateId)?.name ?? h.templateId;
        const selected = h.id === selectedId;
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
              border: selected
                ? `1px solid ${colors.accent}`
                : `1px solid ${colors.border}`,
              borderRadius: 6,
              padding: 10,
              cursor: "pointer",
              display: "flex",
              flexDirection: "column",
              gap: 4,
              minHeight: 78,
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 13, color: colors.text }}>{h.name}</div>
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
}: {
  hotcards: HotcardMeta[];
  templates: { id: string; name: string }[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCue: (h: HotcardMeta) => void;
  onTake: (h: HotcardMeta) => void;
}) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <tbody>
        {hotcards.map((h) => {
          const tplName = templates.find((t) => t.id === h.templateId)?.name ?? h.templateId;
          const selected = h.id === selectedId;
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
                borderLeft: selected
                  ? `3px solid ${colors.accent}`
                  : "3px solid transparent",
                cursor: "pointer",
              }}
            >
              <td style={td()}>
                <div style={{ fontWeight: 600 }}>{h.name}</div>
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
