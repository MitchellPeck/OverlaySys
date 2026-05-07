"use client";

import { useEffect, useRef, useState } from "react";
import type { Field } from "@overlaysys/core";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";
import { csvToRows } from "@/lib/csv";

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
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<ImagePreview | null>(null);

  // Fetch each unique graphic template referenced by the rundown so we can
  // show its declared field types (for pretty data formatting). Song rows
  // reference a lyricTemplateId — we load those the same way.
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
      <p style={{ color: "var(--text-dim)" }}>
        No show loaded. Pick one above, or import a CSV to start a new show.
      </p>
    );
  }

  function cueSelected() {
    if (!show || !selectedRowId) return;
    const row = show.rows.find((r) => r.id === selectedRowId);
    if (!row) return;
    if (row.kind === "song") {
      // Songs go straight to program (cueing them makes less sense; UX deferred to Plan B)
      send({ type: "song_take", channel: "program", showId: show.id, songRowId: row.id });
      return;
    }
    send({
      type: "cue", channel: "preview",
      templateId: row.templateId, data: row.data,
    });
  }

  function takeSelected() {
    if (!show || !selectedRowId) return;
    const row = show.rows.find((r) => r.id === selectedRowId);
    if (!row) return;
    if (row.kind === "song") {
      send({ type: "song_take", channel: "program", showId: show.id, songRowId: row.id });
      return;
    }
    send({
      type: "take", channel: "program",
      templateId: row.templateId, data: row.data,
    });
  }

  async function importCsv(file: File) {
    setBusy(true);
    try {
      const rows = await csvToRows(file);
      if (!show) return;
      const next = { ...show, rows: [...show.rows, ...rows] };
      send({ type: "save_show", show: next });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <button onClick={cueSelected} style={btn()}>Cue ▶ PVW (Enter)</button>
        <button onClick={takeSelected} style={btn("primary")}>Take ▶ PGM</button>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button onClick={() => fileRef.current?.click()} style={btn()} disabled={busy}>
          {busy ? "Importing…" : "Import CSV"}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importCsv(f);
            e.target.value = "";
          }}
        />
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ color: "var(--text-dim)", textAlign: "left" }}>
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
                      type: "song_take",
                      channel: "program",
                      showId: show.id,
                      songRowId: row.id,
                    });
                  }}
                  style={{
                    background: selected ? "rgba(255, 58, 58, 0.12)" : "transparent",
                    borderLeft: selected
                      ? "3px solid var(--accent)"
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
                    <div style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "ui-monospace, monospace", marginTop: 1 }}>
                      song · {row.lyricTemplateId}
                    </div>
                  </td>
                  <td style={td()}>
                    <span style={{ color: "var(--text-dim)", fontSize: 11 }}>
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
                    ? "3px solid var(--accent)"
                    : "3px solid transparent",
                  cursor: "pointer",
                }}
              >
                <td style={td()}>{i + 1}</td>
                <td style={td()}>
                  <div style={{ fontWeight: 600 }}>{tplName}</div>
                  {tplMeta && tplMeta.id !== tplName && (
                    <div style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "ui-monospace, monospace", marginTop: 1 }}>
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

      <p style={{ marginTop: 12, fontSize: 11, color: "var(--text-dim)" }}>
        ↑/↓ to navigate · Enter to cue · Space to take · Esc to clear · double-click row to fire instantly
      </p>
      <p style={{ marginTop: 6, fontSize: 11, color: "var(--text-dim)" }}>
        CSV format: first column <code>template</code>, then one column per fieldKey.
      </p>

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
  // Esc to close.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey, true); // capture so it beats other Esc handlers
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.85)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        cursor: "zoom-out",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: 16,
          maxWidth: "90vw",
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          gap: 12,
          cursor: "default",
        }}
      >
        <header style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <strong style={{ fontSize: 13 }}>{preview.label}</strong>
          <span
            style={{
              fontSize: 10,
              color: "var(--text-dim)",
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
          <button
            onClick={onClose}
            style={{
              marginLeft: "auto",
              width: 28,
              height: 28,
              background: "transparent",
              color: "var(--text)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            ×
          </button>
        </header>
        <div
          style={{
            background:
              "linear-gradient(45deg, #1a1c20 25%, transparent 25%, transparent 75%, #1a1c20 75%) 0 0 / 16px 16px, #0c0d10",
            padding: 8,
            borderRadius: 4,
            overflow: "auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={preview.src}
            alt={preview.label}
            style={{ maxWidth: "80vw", maxHeight: "75vh", display: "block" }}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Pretty-print a row's data for the rundown summary column.
 *
 * Looks up each declared field by its type and renders an appropriate token:
 *   - text/number → the raw value
 *   - color → "color: <hex>" + a small swatch
 *   - image → just the word "image" (avoids dumping huge data: URLs)
 *   - undeclared keys → key: value (operator can spot orphan fields)
 *
 * If we don't have the full template yet (still loading), falls back to the
 * old key:value view.
 */
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
    return <span style={{ color: "var(--text-dim)" }}>—</span>;
  }
  if (!fields) {
    return (
      <span style={{ color: "var(--text-dim)" }}>
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
            <span style={{ color: "var(--text-dim)", fontSize: 11 }}>{f.label}:</span>
            {renderFieldValue(f, v, onPreviewImage)}
          </span>
        );
      })}
      {entries
        .filter(([k]) => !fields.some((f) => f.key === k))
        .map(([k, v]) => (
          <span key={k} style={{ color: "var(--accent-2)", fontSize: 11 }}>
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
              borderRadius: 2,
              background: value || "transparent",
              border: "1px solid var(--border)",
              verticalAlign: "middle",
            }}
            title={value}
          />
          <span style={{ fontSize: 11, color: "var(--text)", fontFamily: "ui-monospace, monospace" }}>
            {value}
          </span>
        </>
      );
    case "image":
      if (!value) {
        return <span style={{ fontSize: 11, color: "var(--text-dim)", fontStyle: "italic" }}>(empty)</span>;
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
            background: "var(--panel-2)",
            border: "1px solid var(--border)",
            borderRadius: 3,
            color: "var(--accent-2)",
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

function btn(kind: "default" | "primary" = "default"): React.CSSProperties {
  return {
    flex: 1,
    padding: "8px 10px",
    background: kind === "primary" ? "var(--accent)" : "var(--panel-2)",
    color: kind === "primary" ? "#fff" : "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    fontWeight: 600,
    cursor: "pointer",
    fontSize: 12,
  };
}

function th(): React.CSSProperties {
  return { padding: "6px 8px", borderBottom: "1px solid var(--border)", fontWeight: 500, fontSize: 11 };
}
function td(): React.CSSProperties {
  return { padding: "8px", borderBottom: "1px solid var(--border)" };
}
