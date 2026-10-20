"use client";

import { useEffect, useState } from "react";
import type { Field } from "@overlaysys/core";
import { resolveArrangement } from "@overlaysys/core";
import { IconButton, Modal, colors, radius } from "@overlaysys/ui";
import { BookOpen, Film, Image, Music, Type } from "lucide-react";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";
import { videoRowTakeMessage, onAirMediaFor, formatClock } from "@/lib/mediaTake";
import { resolveAssetUrl } from "@/lib/uploadAsset";
import { rowAirState, type AirState } from "@/lib/rowAirState";
import { arrangementSummary } from "@/app/shows/edit/ArrangementModal";

type ImagePreview = { src: string; label: string };

export function Rundown() {
  const { send } = useWs();
  const show = useStore((s) => s.show);
  const templates = useStore((s) => s.templates);
  const templateCache = useStore((s) => s.templateCache);
  const conn = useStore((s) => s.conn);
  const selectedRowId = useStore((s) => s.selectedRowId);
  const setSelectedRow = useStore((s) => s.setSelectedRow);
  const songs = useStore((s) => s.songs);
  const songCache = useStore((s) => s.songCache);
  const channelStates = useStore((s) => s.channelStates);
  const songSessions = useStore((s) => s.songSessions);
  const [preview, setPreview] = useState<ImagePreview | null>(null);

  useEffect(() => {
    if (!show || conn !== "open") return;
    const seen = new Set<string>();
    for (const r of show.rows) {
      if (r.kind === "scripture") {
        // Scripture rows don't use a single templateId for lookup here;
        // they dispatch per-slide via ScriptureTakeStrip in the stage area.
        continue;
      }
      if (r.kind === "video") continue;
      const id = r.kind === "graphic" ? r.templateId : r.lyricTemplateId;
      if (seen.has(id)) continue;
      seen.add(id);
      if (!templateCache[id]) {
        send({ type: "get_template", templateId: id });
      }
    }
  }, [show, templateCache, conn, send]);

  if (!show) {
    return (
      <p style={{ color: colors.textDim, padding: 12, margin: 0 }}>
        No show loaded. Pick one from the top bar.
      </p>
    );
  }

  return (
    <div>
      <div role="list" style={{ display: "flex", flexDirection: "column", gap: 2, padding: 6 }}>
        {show.rows.map((row, i) => {
          const selected = row.id === selectedRowId;
          const air = rowAirState(row, channelStates, songSessions);
          if (row.kind === "song") {
            const song = songs.find((s) => s.id === row.songId);
            const cachedSong = songCache[row.songId];
            const showSong = show.songs.find((s) => s.songId === row.songId);
            return (
              <RundownItem
                key={row.id}
                index={i + 1}
                icon={<Music size={14} />}
                title={song?.title ?? row.songId}
                typeLabel="song"
                detail={
                  cachedSong
                    ? arrangementSummary(resolveArrangement(row, showSong, cachedSong), cachedSong)
                    : (row.arrangement ?? showSong?.arrangement ?? []).join(" · ") || "Default arrangement"
                }
                selected={selected}
                air={air}
                onClick={() => setSelectedRow(row.id)}
                onDoubleClick={() => {
                  setSelectedRow(row.id);
                  send({
                    type: "song_take_pvw_to_pgm",
                    showId: show.id,
                    songRowId: row.id,
                    fromChannel: "preview",
                    toChannel: row.channelHint ?? "program",
                  });
                }}
              />
            );
          }
          if (row.kind === "scripture") {
            return (
              <RundownItem
                key={row.id}
                index={i + 1}
                icon={<BookOpen size={14} />}
                title={row.reference}
                typeLabel="scripture"
                detail={row.translation}
                selected={selected}
                air={air}
                onClick={() => setSelectedRow(row.id)}
              />
            );
          }
          if (row.kind === "video") {
            return (
              <RundownItem
                key={row.id}
                index={i + 1}
                icon={<Film size={14} />}
                title={row.label || "Video"}
                typeLabel="video"
                detail={`${row.durationSec ? `${formatClock(row.durationSec)} · ` : ""}${row.endAction === "clear" ? "clears at end" : "holds at end"}`}
                selected={selected}
                air={air}
                onClick={() => setSelectedRow(row.id)}
                onDoubleClick={() => {
                  setSelectedRow(row.id);
                  if (onAirMediaFor(row, useStore.getState().channelStates)) return;
                  send(videoRowTakeMessage(row));
                }}
              />
            );
          }
          const tplMeta = templates.find((t) => t.id === row.templateId);
          const tpl = templateCache[row.templateId] ?? null;
          return (
            <RundownItem
              key={row.id}
              index={i + 1}
              icon={<Type size={14} />}
              title={tplMeta?.name ?? row.templateId}
              typeLabel="graphic"
              detail={<DataSummary data={row.data} fields={tpl?.fields ?? null} onPreviewImage={setPreview} />}
              selected={selected}
              air={air}
              onClick={() => setSelectedRow(row.id)}
              onDoubleClick={() => {
                setSelectedRow(row.id);
                send({
                  type: "take",
                  channel: row.channelHint ?? "program",
                  templateId: row.templateId,
                  data: row.data,
                });
              }}
            />
          );
        })}
      </div>

      {preview && <ImagePreviewModal preview={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

function ImagePreviewModal({
  preview,
  onClose,
}: {
  preview: ImagePreview;
  onClose: () => void;
}) {
  return (
    <Modal
      open
      onClose={onClose}
      onCancel={onClose}
      captureKeys
      size="lg"
      bodyStyle={{ padding: 0 }}
      containerStyle={{
        background: colors.panel,
        maxWidth: "90vw",
        maxHeight: "90vh",
      }}
    >
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <header style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <strong style={{ fontSize: 13 }}>{preview.label}</strong>
          <span
            style={{
              fontSize: 10,
              color: colors.textDim,
              fontFamily: "ui-monospace, monospace",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              maxWidth: 360,
            }}
            title={preview.src}
          >
            {preview.src.startsWith("data:")
              ? `(data url, ${(preview.src.length / 1024).toFixed(0)} kB)`
              : preview.src}
          </span>
          <IconButton onClick={onClose} style={{ marginLeft: "auto" }} title="Close">
            ×
          </IconButton>
        </header>
        <div
          style={{
            background:
              "linear-gradient(45deg, var(--surface-2) 25%, transparent 25%, transparent 75%, var(--surface-2) 75%) 0 0 / 16px 16px, var(--bg)",
            padding: 8,
            borderRadius: radius.md,
            overflow: "auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={resolveAssetUrl(preview.src)}
            alt={preview.label}
            style={{ maxWidth: "80vw", maxHeight: "75vh", display: "block" }}
          />
        </div>
      </div>
    </Modal>
  );
}

function DataSummary({
  data,
  fields,
  onPreviewImage,
}: {
  data: Record<string, string>;
  fields: Field[] | null;
  onPreviewImage: (p: ImagePreview) => void;
}) {
  const entries = Object.entries(data);
  if (entries.length === 0) {
    return <span style={{ color: colors.textDim }}>—</span>;
  }
  if (!fields) {
    return (
      <span style={{ color: colors.textDim }}>
        {entries.map(([k, v]) => `${k}: ${truncate(v)}`).join(" · ")}
      </span>
    );
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px" }}>
      {fields.map((f) => {
        const v = data[f.key];
        if (v === undefined) return null;
        return (
          <span key={f.key} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{ color: colors.textDim, fontSize: 11 }}>{f.label}:</span>
            {renderFieldValue(f, v, onPreviewImage)}
          </span>
        );
      })}
      {entries
        .filter(([k]) => !fields.some((f) => f.key === k))
        .map(([k, v]) => (
          <span key={k} style={{ color: colors.accent2, fontSize: 11 }}>
            {k}*: {truncate(v)}
          </span>
        ))}
    </div>
  );
}

function renderFieldValue(
  field: Field,
  value: string,
  onPreviewImage: (p: ImagePreview) => void,
): React.ReactNode {
  switch (field.type) {
    case "color":
      return (
        <>
          <span
            style={{
              display: "inline-block",
              width: 12,
              height: 12,
              // 2px radius is a deliberate small swatch — not the standard token.
              borderRadius: 2,
              background: value || "transparent",
              border: `1px solid ${colors.border}`,
              verticalAlign: "middle",
            }}
            title={value}
          />
          <span style={{ fontSize: 11, color: colors.text, fontFamily: "ui-monospace, monospace" }}>
            {value}
          </span>
        </>
      );
    case "image":
      if (!value) {
        return <span style={{ fontSize: 11, color: colors.textDim, fontStyle: "italic" }}>(empty)</span>;
      }
      return (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPreviewImage({ src: value, label: field.label });
          }}
          title={value.startsWith("data:") ? "(inline data URL)" : value}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "2px 6px",
            background: colors.panel2,
            border: `1px solid ${colors.border}`,
            borderRadius: radius.sm,
            color: colors.accent2,
            fontSize: 11,
            cursor: "pointer",
            fontStyle: "normal",
          }}
        >
          <Image size={14} aria-hidden style={{ verticalAlign: "-2px" }} /> view image
        </button>
      );
    case "number":
    case "text":
    default:
      return <span style={{ fontSize: 12 }}>{truncate(value)}</span>;
  }
}

function truncate(s: string, max = 40): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

function RundownItem({
  index,
  icon,
  title,
  typeLabel,
  detail,
  selected,
  air,
  onClick,
  onDoubleClick,
}: {
  index: number;
  icon: React.ReactNode;
  title: React.ReactNode;
  typeLabel: string;
  detail?: React.ReactNode;
  selected: boolean;
  air: AirState;
  onClick: () => void;
  onDoubleClick?: () => void;
}) {
  const bar = air === "program" ? colors.onair : air === "preview" ? colors.ok : "transparent";
  const tint =
    air === "program" ? "rgba(255,51,65,0.12)" : air === "preview" ? "rgba(16,185,129,0.10)" : "transparent";
  return (
    <div
      role="listitem"
      aria-selected={selected}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 8,
        padding: "7px 8px",
        borderRadius: radius.md,
        cursor: "pointer",
        background: tint,
        boxShadow: `inset 3px 0 0 ${bar}`,
        outline: selected ? `1px solid ${colors.brand}` : "none",
        outlineOffset: -1,
      }}
    >
      <span style={{ width: 18, textAlign: "right", color: colors.textMuted, fontSize: 11, paddingTop: 1 }}>{index}</span>
      <span style={{ color: colors.textDim, paddingTop: 1 }}>{icon}</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ color: colors.text, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {title}
        </div>
        {detail && <div style={{ fontSize: 11, color: colors.textDim, marginTop: 2 }}>{detail}</div>}
      </div>
      <span style={{ fontSize: 10, color: colors.textMuted, paddingTop: 2 }}>{typeLabel}</span>
    </div>
  );
}
