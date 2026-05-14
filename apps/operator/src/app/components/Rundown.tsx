"use client";

import { useEffect, useState } from "react";
import type { Field } from "@overlaysys/core";
import { Button, IconButton, Modal, colors, fontSize as ts, radius } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";
import { resolveAssetUrl } from "@/lib/uploadAsset";
import { HotcardsPanel } from "./HotcardsPanel";

type ImagePreview = { src: string; label: string };

export function Rundown() {
  const { send } = useWs();
  const show = useStore((s) => s.show);
  const templates = useStore((s) => s.templates);
  const templateCache = useStore((s) => s.templateCache);
  const conn = useStore((s) => s.conn);
  const selectedRowId = useStore((s) => s.selectedRowId);
  const setSelectedRow = useStore((s) => s.setSelectedRow);
  const selectedHotcardId = useStore((s) => s.selectedHotcardId);
  const hotcardCache = useStore((s) => s.hotcardCache);
  const songs = useStore((s) => s.songs);
  const [preview, setPreview] = useState<ImagePreview | null>(null);

  useEffect(() => {
    if (!show || conn !== "open") return;
    const seen = new Set<string>();
    for (const r of show.rows) {
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
      <div>
        <p style={{ color: colors.textDim }}>
          No show loaded. Pick one above to get started.
        </p>
        <HotcardsPanel />
      </div>
    );
  }

  function cueSelected() {
    if (selectedRowId && show) {
      const row = show.rows.find((r) => r.id === selectedRowId);
      if (!row) return;
      if (row.kind === "song") {
        send({ type: "song_take", channel: "preview", showId: show.id, songRowId: row.id });
        return;
      }
      send({
        type: "cue", channel: "preview",
        templateId: row.templateId, data: row.data,
      });
      return;
    }
    if (selectedHotcardId) {
      const h = hotcardCache[selectedHotcardId];
      if (!h) {
        send({ type: "get_hotcard", hotcardId: selectedHotcardId });
        return;
      }
      send({
        type: "cue",
        channel: h.channelHint ?? "preview",
        templateId: h.templateId,
        data: h.data,
      });
    }
  }

  function takeSelected() {
    if (selectedRowId && show) {
      const row = show.rows.find((r) => r.id === selectedRowId);
      if (!row) return;
      if (row.kind === "song") {
        send({
          type: "song_take_pvw_to_pgm",
          showId: show.id,
          songRowId: row.id,
          fromChannel: "preview",
          toChannel: "program",
        });
        return;
      }
      send({
        type: "take", channel: "program",
        templateId: row.templateId, data: row.data,
      });
      return;
    }
    if (selectedHotcardId) {
      const h = hotcardCache[selectedHotcardId];
      if (!h) {
        send({ type: "get_hotcard", hotcardId: selectedHotcardId });
        return;
      }
      send({
        type: "take",
        channel: h.channelHint ?? "program",
        templateId: h.templateId,
        data: h.data,
      });
    }
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <Button onClick={cueSelected} size="md" style={{ flex: 1 }}>Cue ▶ PVW (Enter)</Button>
        <Button onClick={takeSelected} variant="primary" size="md" style={{ flex: 1 }}>Take ▶ PGM</Button>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ color: colors.textDim, textAlign: "left" }}>
            <th style={th()}>#</th>
            <th style={th()}>Template</th>
            <th style={th()}>Data</th>
          </tr>
        </thead>
        <tbody>
          {show.rows.map((row, i) => {
            const selected = row.id === selectedRowId;
            if (row.kind === "song") {
              const song = songs.find((s) => s.id === row.songId);
              return (
                <tr
                  key={row.id}
                  onClick={() => setSelectedRow(row.id)}
                  onDoubleClick={() => {
                    setSelectedRow(row.id);
                    send({
                      type: "song_take_pvw_to_pgm",
                      showId: show.id,
                      songRowId: row.id,
                      fromChannel: "preview",
                      toChannel: "program",
                    });
                  }}
                  style={{
                    background: selected ? "rgba(255, 58, 58, 0.12)" : "transparent",
                    borderLeft: selected
                      ? `3px solid ${colors.accent}`
                      : "3px solid transparent",
                    cursor: "pointer",
                  }}
                >
                  <td style={td()}>{i + 1}</td>
                  <td style={td()}>
                    <div style={{ fontWeight: 600 }}>
                      <span aria-hidden style={{ marginRight: 6 }}>♪</span>
                      {song?.title ?? row.songId}
                    </div>
                    <div style={{ fontSize: 10, color: colors.textDim, fontFamily: "ui-monospace, monospace", marginTop: 1 }}>
                      song · {row.lyricTemplateId}
                    </div>
                  </td>
                  <td style={td()}>
                    <span style={{ color: colors.textDim, fontSize: 11 }}>
                      arrangement: {(row.arrangement ?? []).join(" → ") || "(default)"}
                    </span>
                  </td>
                </tr>
              );
            }
            const tplMeta = templates.find((t) => t.id === row.templateId);
            const tpl = templateCache[row.templateId] ?? null;
            const tplName = tplMeta?.name ?? row.templateId;
            return (
              <tr
                key={row.id}
                onClick={() => setSelectedRow(row.id)}
                onDoubleClick={() => {
                  setSelectedRow(row.id);
                  send({
                    type: "take",
                    channel: "program",
                    templateId: row.templateId,
                    data: row.data,
                  });
                }}
                style={{
                  background: selected ? "rgba(255, 58, 58, 0.12)" : "transparent",
                  borderLeft: selected
                    ? `3px solid ${colors.accent}`
                    : "3px solid transparent",
                  cursor: "pointer",
                }}
              >
                <td style={td()}>{i + 1}</td>
                <td style={td()}>
                  <div style={{ fontWeight: 600 }}>{tplName}</div>
                  {tplMeta && tplMeta.id !== tplName && (
                    <div style={{ fontSize: 10, color: colors.textDim, fontFamily: "ui-monospace, monospace", marginTop: 1 }}>
                      {tplMeta.id}
                    </div>
                  )}
                </td>
                <td style={td()}>
                  <DataSummary
                    data={row.data}
                    fields={tpl?.fields ?? null}
                    onPreviewImage={setPreview}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <p style={{ marginTop: 12, fontSize: 11, color: colors.textDim }}>
        ↑/↓ to navigate · Enter to cue · Space to take · Esc to clear · double-click row to fire instantly
      </p>

      <HotcardsPanel />

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
              "linear-gradient(45deg, #1a1c20 25%, transparent 25%, transparent 75%, #1a1c20 75%) 0 0 / 16px 16px, #0c0d10",
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
          🖼 view image
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

function th(): React.CSSProperties {
  return { padding: "6px 8px", borderBottom: `1px solid ${colors.border}`, fontWeight: 500, fontSize: ts.xs };
}
function td(): React.CSSProperties {
  return { padding: "8px", borderBottom: `1px solid ${colors.border}` };
}
