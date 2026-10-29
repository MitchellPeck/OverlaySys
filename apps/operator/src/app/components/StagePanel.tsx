"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowDown, ArrowUp, ChevronLeft, ChevronRight, X } from "lucide-react";
import { Button, IconButton, Input, Select, Switch, colors } from "@overlaysys/ui";
import { DEFAULT_MESSAGE_PRESETS } from "@overlaysys/core";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";
import { getStageSettings } from "@/lib/stageSettingsClient";
import { useResolvedChannelConfigs } from "@/lib/useResolvedChannels";
import { showHasPcoItems, stagePreviewWarnings, stageTargetNames } from "@/lib/liveDrawerModel";

const MAX_MESSAGE = 200;
/** PCO Live reads as stale once its last successful poll is older than this. */
const STALE_MS = 35_000;

export function StagePanel() {
  const { send } = useWs();
  const show = useStore((s) => s.show);
  const stage = useStore((s) => s.stageState);
  const pcoLive = useStore((s) => s.pcoLive);
  const previews = useStore((s) => s.stageLayoutPreviews);
  const channelConfigs = useResolvedChannelConfigs();
  const startError = useStore((s) => s.pcoLiveStartError);
  const [presets, setPresets] = useState<string[]>(DEFAULT_MESSAGE_PRESETS);
  const [text, setText] = useState("");
  const offset = useStore((s) => s.serverTimeOffsetMs);
  const [localNow, setNow] = useState(() => Date.now());
  // lastPolledAt is a server-clock timestamp.
  const now = localNow + offset;

  // Re-evaluate staleness while syncing; the server only rebroadcasts on
  // change or a heartbeat, so lastPolledAt can't drive re-renders by itself.
  const syncing = !!pcoLive?.enabled;
  useEffect(() => {
    if (!syncing) return;
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, [syncing]);

  useEffect(() => {
    let alive = true;
    getStageSettings()
      .then((s) => alive && setPresets(s.messagePresets))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const sets = show?.sermonNotes ?? [];
  const active = stage?.state.notes;
  // Fall back to "" when the active set isn't one of this show's (another
  // show's notes, or a set that was deleted) so the select never goes blank.
  const activeId =
    show && active && active.showId === show.id && sets.some((n) => n.id === active.notesId) ? active.notesId : "";
  const hasActive = !!active;
  const canNavigate = (stage?.pointCount ?? 0) > 0;
  const message = stage?.state.message ?? null;
  const targets = stageTargetNames(channelConfigs);
  const warnings = stagePreviewWarnings(previews, channelConfigs);

  function sendMessage(t: string) {
    const trimmed = t.trim().slice(0, MAX_MESSAGE);
    if (!trimmed) return;
    send({ type: "stage_message", text: trimmed });
  }

  const hasPco = showHasPcoItems(show?.rows);
  const following = !!pcoLive?.enabled && !!show && pcoLive.showId === show.id;
  const service = following ? pcoLive.service : null;
  const followingOther = !!pcoLive?.enabled && !following;
  const liveLabel =
    pcoLive?.status === "live" && service
      ? `Live · item ${service.itemIndex} of ${service.itemCount}`
      : pcoLive?.status === "notStarted"
        ? "Not started"
        : pcoLive?.status === "ended"
          ? "Ended"
          : null;
  const stale =
    following && pcoLive.lastPolledAt !== null && now - pcoLive.lastPolledAt > STALE_MS;

  return (
    <div style={{ flexShrink: 0 }}>
      <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <Switch
            label="Follow PCO Live"
            checked={following}
            disabled={!show || (!following && !hasPco)}
            onChange={(on) => {
              useStore.getState().setPcoLiveStartError(null);
              if (on && show) send({ type: "pco_live_start", showId: show.id });
              else send({ type: "pco_live_stop" });
            }}
          />
          {show && !hasPco && !following && (
            <div style={{ fontSize: 12, color: colors.textDim }}>This show has no Planning Center items</div>
          )}
          {startError ? (
            <div style={{ fontSize: 12, color: colors.errorText }}>{startError}</div>
          ) : pcoLive?.enabled && pcoLive.error ? (
            <div style={{ fontSize: 12, color: colors.errorText }}>{pcoLive.error}</div>
          ) : following && liveLabel ? (
            <div style={{ fontSize: 12, color: colors.textDim }}>{liveLabel}</div>
          ) : null}
          {followingOther && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: colors.textDim }}>
              Following PCO Live for another show
              <Button size="sm" variant="ghost" onClick={() => send({ type: "pco_live_stop" })}>
                Stop
              </Button>
            </div>
          )}
          {stale && (
            <div style={{ fontSize: 12, color: colors.warn }}>
              stale · last update {Math.round((now - pcoLive.lastPolledAt!) / 1000)} s ago
            </div>
          )}
        </div>
        {sets.length === 0 && !hasActive ? (
          <div style={{ fontSize: 12, color: colors.textDim }}>
            No sermon notes in this show
            {show && (
              <>
                {" · "}
                <Link href={`/shows/edit?id=${encodeURIComponent(show.id)}`} style={{ color: colors.brand }}>
                  Edit show
                </Link>
              </>
            )}
          </div>
        ) : (
          <>
            <Select
              aria-label="Sermon notes"
              value={activeId}
              disabled={!show}
              onChange={(e) =>
                show && send({ type: "notes_select", showId: show.id, notesId: e.target.value || null })
              }
            >
              <option value="">
                {hasActive && !activeId
                  ? active.showId === show?.id ? "(missing notes)" : "(other show's notes)"
                  : "No notes"}
              </option>
              {sets.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.title}
                </option>
              ))}
            </Select>
            {hasActive && stage && (
              <div style={{ fontSize: 12, minWidth: 0 }}>
                <div style={{ color: colors.textDim }}>
                  {stage.title ?? "Notes"} · {stage.state.pointIdx + 1}/{stage.pointCount}
                </div>
                <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {stage.pointHeading ?? ""}
                </div>
              </div>
            )}
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              <Button disabled={!canNavigate} onClick={() => send({ type: "notes_point", delta: -1 })}>
                <ChevronLeft size={14} aria-hidden /> Prev
              </Button>
              <Button disabled={!canNavigate} onClick={() => send({ type: "notes_point", delta: 1 })}>
                Next <ChevronRight size={14} aria-hidden />
              </Button>
              <Button disabled={!canNavigate} title="Scroll up" aria-label="Scroll up" onClick={() => send({ type: "notes_scroll", delta: -0.33 })}>
                <ArrowUp size={14} aria-hidden />
              </Button>
              <Button disabled={!canNavigate} title="Scroll down" aria-label="Scroll down" onClick={() => send({ type: "notes_scroll", delta: 0.33 })}>
                <ArrowDown size={14} aria-hidden />
              </Button>
              <Button disabled={!canNavigate} onClick={() => send({ type: "notes_reset" })}>
                Top
              </Button>
              <Button
                disabled={!active}
                title="Clear the active sermon notes"
                onClick={() =>
                  active && send({ type: "notes_select", showId: show?.id ?? active.showId, notesId: null })
                }
              >
                Clear
              </Button>
            </div>
          </>
        )}

        <div style={{ display: "flex", gap: 4 }}>
          <Input
            aria-label="Stage message"
            placeholder="Message to stage…"
            maxLength={MAX_MESSAGE}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                sendMessage(text);
                setText("");
              }
            }}
          />
          <Button
            variant="primary"
            disabled={!text.trim()}
            onClick={() => {
              sendMessage(text);
              setText("");
            }}
          >
            Send
          </Button>
        </div>
        {presets.length > 0 && (
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {presets.map((p) => (
              <Button key={p} onClick={() => sendMessage(p)} style={{ fontSize: 11 }}>
                {p}
              </Button>
            ))}
          </div>
        )}
        {message && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, fontSize: 12 }}>
            <div
              title={message.text}
              style={{
                flex: 1,
                minWidth: 0,
                padding: "2px 10px",
                borderRadius: 999,
                background: colors.brandSubtle,
                color: colors.brand,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              On stage: {message.text}
            </div>
            <IconButton size={24} aria-label="Clear stage message" title="Clear stage message" onClick={() => send({ type: "stage_message_clear" })}>
              <X size={14} aria-hidden />
            </IconButton>
          </div>
        )}
        {message && targets.length > 0 && (
          <div style={{ fontSize: 11, color: colors.textDim }}>Showing on {targets.join(", ")}</div>
        )}
        {warnings.map((w) => (
          <div
            key={w.channel}
            role="status"
            style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: colors.warn, border: `1px solid ${colors.warn}`, borderRadius: 6, padding: "4px 8px" }}
          >
            <AlertTriangle size={14} aria-hidden style={{ flexShrink: 0 }} />
            <span style={{ flex: 1, minWidth: 0 }}>{w.text}</span>
            <Button size="sm" onClick={() => send({ type: "stage_layout_preview", channel: w.channel, layout: null })}>
              Stop preview
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
