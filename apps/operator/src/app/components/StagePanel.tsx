"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, Input, PanelHeader, Select, colors } from "@overlaysys/ui";
import { DEFAULT_MESSAGE_PRESETS } from "@overlaysys/core";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";
import { getStageSettings } from "@/lib/stageSettingsClient";

const MAX_MESSAGE = 200;

export function StagePanel() {
  const { send } = useWs();
  const show = useStore((s) => s.show);
  const stage = useStore((s) => s.stageState);
  const pcoLive = useStore((s) => s.pcoLive);
  const [presets, setPresets] = useState<string[]>(DEFAULT_MESSAGE_PRESETS);
  const [text, setText] = useState("");

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

  function sendMessage(t: string) {
    const trimmed = t.trim().slice(0, MAX_MESSAGE);
    if (!trimmed) return;
    send({ type: "stage_message", text: trimmed });
  }

  const following = !!pcoLive?.enabled && !!show && pcoLive.showId === show.id;
  const service = following ? pcoLive.service : null;
  const liveLabel =
    pcoLive?.status === "error" || pcoLive?.error
      ? null
      : pcoLive?.status === "live" && service
        ? `Live · item ${service.itemIndex} of ${service.itemCount}`
        : pcoLive?.status === "notStarted"
          ? "Not started"
          : pcoLive?.status === "ended"
            ? "Ended"
            : null;

  return (
    <div style={{ flexShrink: 0, borderTop: `1px solid ${colors.border}` }}>
      <PanelHeader title="Stage" />
      <div style={{ padding: 8, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <input
              type="checkbox"
              role="switch"
              aria-label="Follow PCO Live"
              checked={following}
              disabled={!show}
              onChange={(e) =>
                e.target.checked && show ? send({ type: "pco_live_start", showId: show.id }) : send({ type: "pco_live_stop" })
              }
            />
            Follow PCO Live
          </label>
          {pcoLive?.error ? (
            <div style={{ fontSize: 12, color: colors.errorText }}>{pcoLive.error}</div>
          ) : following && liveLabel ? (
            <div style={{ fontSize: 12, color: colors.textDim }}>{liveLabel}</div>
          ) : null}
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
                ◀ Prev
              </Button>
              <Button disabled={!canNavigate} onClick={() => send({ type: "notes_point", delta: 1 })}>
                Next ▶
              </Button>
              <Button disabled={!canNavigate} title="Scroll up" onClick={() => send({ type: "notes_scroll", delta: -0.33 })}>
                ↑
              </Button>
              <Button disabled={!canNavigate} title="Scroll down" onClick={() => send({ type: "notes_scroll", delta: 0.33 })}>
                ↓
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
          <Button disabled={!message} onClick={() => send({ type: "stage_message_clear" })}>
            Clear
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
          <div
            style={{
              alignSelf: "flex-start",
              maxWidth: "100%",
              padding: "2px 10px",
              borderRadius: 999,
              background: colors.brandSubtle,
              color: colors.brand,
              fontSize: 12,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={message.text}
          >
            {message.text}
          </div>
        )}
      </div>
    </div>
  );
}
