"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { hotkeyConflicts, type HotcardMeta } from "@overlaysys/core";
import { Button, Kbd, OfflineState, colors } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { hotcardAirState, type AirState } from "@/lib/rowAirState";
import { hotcardFireMessage } from "@/lib/shortcutGuards";
import { useWs } from "@/lib/useWs";
import { useConnection } from "@/lib/useConnection";
import { resolveAssetUrl } from "@/lib/uploadAsset";
import { hotcardImageValue } from "@/lib/liveDrawerModel";
import { useLivePrefs } from "../hooks/useLivePrefs";

type View = "grid" | "list";
const VIEW_STORAGE_KEY = "overlaysys:hotcardsView";

export function HotcardsPanel() {
  const { send } = useWs();
  const conn = useStore((s) => s.conn);
  const { retry } = useConnection();
  const { doubleClickTakes } = useLivePrefs();
  const allHotcards = useStore((s) => s.hotcards);
  const currentProjectId = useStore((s) => s.currentProjectId);
  // Only this project's cards: F-keys are scoped to the project too.
  const hotcards = useMemo(
    () => allHotcards.filter((h) => h.projectId === currentProjectId),
    [allHotcards, currentProjectId],
  );
  const hotcardCache = useStore((s) => s.hotcardCache);
  const templates = useStore((s) => s.templates);
  const selectedHotcardId = useStore((s) => s.selectedHotcardId);
  const setSelectedHotcard = useStore((s) => s.setSelectedHotcard);

  const channelStates = useStore((s) => s.channelStates);
  const [view, setView] = useState<View>("grid");
  // On-air only where the store already knows it: a live graphic with this
  // hotcard's template and data.
  // Cards sharing an F-key with another card in this project get a "!":
  // only one of them fires.
  const conflicted = new Set(Object.values(hotkeyConflicts(hotcards, currentProjectId)).flat());
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

  function fire(meta: HotcardMeta, target: "preview" | "program") {
    const full = hotcardCache[meta.id];
    if (!full) {
      // Cache miss — re-request and skip; the user can click again once it lands.
      send({ type: "get_hotcard", hotcardId: meta.id });
      return;
    }
    const action = target === "preview" ? "cue" : "take";
    send(hotcardFireMessage(full, action));
  }

  const header = (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px 0" }}>
      <span style={{ fontSize: 11, color: colors.textDim, flex: 1 }}>
        {hotcards.length} {hotcards.length === 1 ? "card" : "cards"}
      </span>
      <ViewToggleButton active={view === "list"} onClick={() => persistView("list")} label="List" />
      <ViewToggleButton active={view === "grid"} onClick={() => persistView("grid")} label="Grid" />
      <Link href="/hotcards" style={{ color: colors.textDim, fontSize: 11, textDecoration: "none" }}>
        Manage
      </Link>
    </div>
  );

  if (hotcards.length === 0) {
    return (
      <section style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ padding: 8 }}>
          {disconnected ? (
            <OfflineState noun="hotcards" onRetry={retry} compact />
          ) : (
            <p style={{ color: colors.textDim, fontSize: 12, margin: 0 }}>
              No hotcards yet.{" "}
              <Link href="/hotcards" style={{ color: colors.accent2 }}>
                Create one
              </Link>{" "}
              to keep reusable graphics at hand.
            </p>
          )}
        </div>
      </section>
    );
  }

  return (
    <section style={{ display: "flex", flexDirection: "column" }}>
      {header}
      <div style={{ padding: 8 }}>
        {disconnected && <OfflineState noun="hotcards" variant="stale" onRetry={retry} />}
        {view === "grid" ? (
          <GridView
            hotcards={hotcards}
            templates={templates}
            selectedId={selectedHotcardId}
            onSelect={setSelectedHotcard}
            onCue={(h) => fire(h, "preview")}
            onTake={(h) => fire(h, "program")}
            onDouble={(h) => fire(h, doubleClickTakes ? "program" : "preview")}
            air={air}
            conflicted={conflicted}
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
            onDouble={(h) => fire(h, doubleClickTakes ? "program" : "preview")}
            air={air}
            conflicted={conflicted}
            disconnected={disconnected}
          />
        )}
      </div>
    </section>
  );
}

/** Keeps clicks from leaving focus on the control, so Space/Enter still reach the console shortcuts. */
const noFocus = (e: React.MouseEvent) => e.preventDefault();

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
      onMouseDown={noFocus}
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
  onDouble,
  air,
  conflicted,
  disconnected,
}: {
  hotcards: HotcardMeta[];
  templates: { id: string; name: string }[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCue: (h: HotcardMeta) => void;
  onTake: (h: HotcardMeta) => void;
  onDouble: (h: HotcardMeta) => void;
  air: Record<string, AirState>;
  conflicted: Set<string>;
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
      {hotcards.map((h) => {
        const tplName = templates.find((t) => t.id === h.templateId)?.name ?? h.templateId;
        const selected = h.id === selectedId;
        const fkey = h.hotkey ?? null;
        const onAir = air[h.id];
        return (
          <div
            key={h.id}
            role="button"
            tabIndex={0}
            onMouseDown={noFocus}
            onClick={() => onSelect(h.id)}
            onDoubleClick={() => {
              onSelect(h.id);
              onDouble(h);
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
              background: selected ? colors.brandSubtle : colors.panel2,
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
              {fkey && <HotkeyBadge hotkey={fkey} conflicted={conflicted.has(h.id)} />}
            </div>
            <div
              style={{
                fontSize: 11,
                color: colors.textDim,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={tplName}
            >
              {tplName}
            </div>
            <HotcardThumb id={h.id} />
            <div style={{ display: "flex", gap: 4, marginTop: "auto", paddingTop: 6 }}>
              <Button
                onMouseDown={noFocus}
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
                onMouseDown={noFocus}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelect(h.id);
                  onTake(h);
                }}
                variant="onair"
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
  onDouble,
  air,
  conflicted,
  disconnected,
}: {
  hotcards: HotcardMeta[];
  templates: { id: string; name: string }[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCue: (h: HotcardMeta) => void;
  onTake: (h: HotcardMeta) => void;
  onDouble: (h: HotcardMeta) => void;
  air: Record<string, AirState>;
  conflicted: Set<string>;
  disconnected: boolean;
}) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <tbody>
        {hotcards.map((h) => {
          const tplName = templates.find((t) => t.id === h.templateId)?.name ?? h.templateId;
          const selected = h.id === selectedId;
          const fkey = h.hotkey ?? null;
          const onAir = air[h.id];
          return (
            <tr
              key={h.id}
              onClick={() => onSelect(h.id)}
              onDoubleClick={() => {
                onSelect(h.id);
                onDouble(h);
              }}
              style={{
                background: selected ? colors.brandSubtle : "transparent",
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
                  {fkey && <HotkeyBadge hotkey={fkey} conflicted={conflicted.has(h.id)} />}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: colors.textDim,
                    marginTop: 1,
                  }}
                >
                  {tplName}
                </div>
              </td>
              <td style={{ ...td(), width: 52 }}>
                <HotcardThumb id={h.id} />
              </td>
              <td style={{ ...td(), width: 132, textAlign: "right" }}>
                <div style={{ display: "inline-flex", gap: 4 }}>
                  <Button
                    onMouseDown={noFocus}
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
                    onMouseDown={noFocus}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(h.id);
                      onTake(h);
                    }}
                    variant="onair"
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

/** 48 px thumbnail of the card's first image field; nothing when it has none. */
function HotcardThumb({ id }: { id: string }) {
  const card = useStore((s) => s.hotcardCache[id]);
  const template = useStore((s) => (card ? s.templateCache[card.templateId] : undefined));
  const value = hotcardImageValue(template?.fields, card?.data);
  if (!value) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={resolveAssetUrl(value)}
      alt=""
      width={48}
      height={48}
      style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 4, border: `1px solid ${colors.border}`, flexShrink: 0 }}
    />
  );
}

function HotkeyBadge({ hotkey, conflicted }: { hotkey: string; conflicted: boolean }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "baseline", gap: 2, flexShrink: 0 }}>
      <Kbd title={`${hotkey} take · Shift+${hotkey} cue`}>{hotkey}</Kbd>
      {conflicted && (
        <span
          role="img"
          aria-label={`${hotkey} conflict`}
          title={`Another card in this project also uses ${hotkey}; only one fires. Fix it in Manage.`}
          style={{ color: colors.warn, fontWeight: 700, fontSize: 12 }}
        >
          !
        </span>
      )}
    </span>
  );
}

function td(): React.CSSProperties {
  return { padding: "8px", borderBottom: `1px solid ${colors.border}` };
}
