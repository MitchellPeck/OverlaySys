"use client";

import { useState } from "react";
import {
  detectImport,
  type Bundle,
  type Show,
  type Song,
  type Template,
} from "@overlaysys/core";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";

type Decision = "save" | "skip";

interface ItemRow {
  kind: "song" | "template" | "show";
  id: string;
  label: string;
  conflict: boolean;
  decision: Decision;
}

interface PreviewState {
  songs: Song[];
  templates: Template[];
  shows: Show[];
  rows: ItemRow[];
}

export function ImportPreview() {
  const { send } = useWs();
  const songMetas = useStore((s) => s.songs);
  const showMetas = useStore((s) => s.showMetas);
  const templates = useStore((s) => s.templates);

  const [parseError, setParseError] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);

  function existingIds() {
    return {
      songs: new Set(songMetas.map((s) => s.id)),
      templates: new Set(templates.map((t) => t.id)),
      shows: new Set(showMetas.map((s) => s.id)),
    };
  }

  function buildPreview(songs: Song[], templates: Template[], shows: Show[]): PreviewState {
    const ex = existingIds();
    const rows: ItemRow[] = [
      ...songs.map<ItemRow>((s) => ({
        kind: "song",
        id: s.id,
        label: s.title || s.id,
        conflict: ex.songs.has(s.id),
        decision: ex.songs.has(s.id) ? "skip" : "save",
      })),
      ...templates.map<ItemRow>((t) => ({
        kind: "template",
        id: t.id,
        label: t.name || t.id,
        conflict: ex.templates.has(t.id),
        decision: ex.templates.has(t.id) ? "skip" : "save",
      })),
      ...shows.map<ItemRow>((sh) => ({
        kind: "show",
        id: sh.id,
        label: sh.name || sh.id,
        conflict: ex.shows.has(sh.id),
        decision: ex.shows.has(sh.id) ? "skip" : "save",
      })),
    ];
    return { songs, templates, shows, rows };
  }

  async function readFile(file: File) {
    setFilename(file.name);
    setParseError(null);
    setPreview(null);
    let text: string;
    try {
      text = await file.text();
    } catch (err) {
      setParseError(`could not read file: ${String(err)}`);
      return;
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch (err) {
      setParseError(`invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    const detected = detectImport(json);
    if (detected.kind === "error") {
      setParseError(detected.message);
      return;
    }
    if (detected.kind === "bundle") {
      const b: Bundle = detected.bundle;
      setPreview(buildPreview(b.songs, b.templates, b.shows));
    } else if (detected.kind === "song") {
      setPreview(buildPreview([detected.song], [], []));
    } else if (detected.kind === "template") {
      setPreview(buildPreview([], [detected.template], []));
    } else if (detected.kind === "show") {
      setPreview(buildPreview([], [], [detected.show]));
    }
  }

  function setDecision(idx: number, decision: Decision) {
    setPreview((p) => {
      if (!p) return p;
      const rows = p.rows.slice();
      const row = rows[idx];
      if (!row) return p;
      rows[idx] = { ...row, decision };
      return { ...p, rows };
    });
  }

  function applyImport() {
    if (!preview) return;
    for (const row of preview.rows) {
      if (row.decision === "skip") continue;
      if (row.kind === "template") {
        const t = preview.templates.find((x) => x.id === row.id);
        if (t) send({ type: "save_template", template: t });
      }
    }
    for (const row of preview.rows) {
      if (row.decision === "skip") continue;
      if (row.kind === "song") {
        const s = preview.songs.find((x) => x.id === row.id);
        if (s) send({ type: "save_song", song: s });
      }
    }
    for (const row of preview.rows) {
      if (row.decision === "skip") continue;
      if (row.kind === "show") {
        const sh = preview.shows.find((x) => x.id === row.id);
        if (sh) send({ type: "save_show", show: sh });
      }
    }
    setPreview(null);
    setFilename(null);
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) readFile(file);
  }

  const saveCount = preview?.rows.filter((r) => r.decision === "save").length ?? 0;
  const skipCount = preview?.rows.filter((r) => r.decision === "skip").length ?? 0;

  return (
    <section style={{ marginBottom: 24, padding: 12, border: "1px solid var(--border)", borderRadius: 4 }}>
      <h2 style={{ marginTop: 0, fontSize: 14 }}>Import</h2>

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        style={{ padding: 12, border: "1px dashed var(--border)", borderRadius: 4, marginBottom: 8 }}
      >
        <input
          type="file"
          accept=".json"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) readFile(f);
          }}
          style={{ marginRight: 8 }}
        />
        <span style={{ fontSize: 12, color: "var(--text-dim)" }}>
          or drop a <code>.json</code> / <code>.bundle.json</code> file here
        </span>
        {filename && (
          <span style={{ marginLeft: 8, fontSize: 12 }}>
            Loaded: <code>{filename}</code>
          </span>
        )}
      </div>

      {parseError && (
        <p style={{ color: "#ef4444", fontSize: 12 }}>Parse failed: {parseError}</p>
      )}

      {preview && (
        <>
          <div style={{ maxHeight: 320, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 4, padding: 6, marginBottom: 8 }}>
            {preview.rows.length === 0 ? (
              <p style={{ fontSize: 12, color: "var(--text-dim)" }}>
                The file contained no entities.
              </p>
            ) : (
              preview.rows.map((row, idx) => (
                <div
                  key={`${row.kind}:${row.id}`}
                  style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "4px 6px", fontSize: 13,
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  <span style={{ minWidth: 80, fontSize: 11, color: "var(--text-dim)", fontFamily: "ui-monospace, monospace" }}>
                    {row.kind}
                  </span>
                  <span style={{ fontWeight: 600 }}>{row.label}</span>
                  <code style={{ fontSize: 10, color: "var(--text-dim)" }}>{row.id}</code>
                  <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
                    {row.conflict ? (
                      <>
                        <span style={{ color: "#f59e0b", fontSize: 11 }}>⚠ exists</span>
                        <label style={{ fontSize: 11 }}>
                          <input
                            type="radio"
                            name={`decision-${idx}`}
                            checked={row.decision === "save"}
                            onChange={() => setDecision(idx, "save")}
                          />{" "}
                          Replace
                        </label>
                        <label style={{ fontSize: 11 }}>
                          <input
                            type="radio"
                            name={`decision-${idx}`}
                            checked={row.decision === "skip"}
                            onChange={() => setDecision(idx, "skip")}
                          />{" "}
                          Skip
                        </label>
                      </>
                    ) : (
                      <span style={{ color: "#10b981", fontSize: 11 }}>new</span>
                    )}
                  </span>
                </div>
              ))
            )}
          </div>
          <button
            onClick={applyImport}
            disabled={saveCount === 0}
            style={{
              padding: "6px 10px",
              background: "var(--accent)",
              color: "#fff",
              border: "1px solid var(--border)",
              borderRadius: 4,
              fontWeight: 600,
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            Save {saveCount} item(s){skipCount > 0 ? `, skip ${skipCount}` : ""}
          </button>
        </>
      )}
    </section>
  );
}
