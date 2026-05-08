"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collectDependencies,
  type BundleSelection,
  type Show,
  type Song,
  type Template,
} from "@overlaysys/core";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";
import { downloadJson } from "@/lib/download";

type Tab = "songs" | "shows" | "templates";

export function ExportBundle() {
  const { send } = useWs();
  const conn = useStore((s) => s.conn);
  const songsList = useStore((s) => s.songs);
  const showMetas = useStore((s) => s.showMetas);
  const templates = useStore((s) => s.templates);
  const songCache = useStore((s) => s.songCache);
  const showCache = useStore((s) => s.showCache);
  const templateCache = useStore((s) => s.templateCache);

  const [tab, setTab] = useState<Tab>("songs");
  const [includeDeps, setIncludeDeps] = useState(true);
  const [bundleName, setBundleName] = useState("");
  const [selectedSongs, setSelectedSongs] = useState<Set<string>>(new Set());
  const [selectedShows, setSelectedShows] = useState<Set<string>>(new Set());
  const [selectedTemplates, setSelectedTemplates] = useState<Set<string>>(new Set());

  // Hydrate the lists once when the page opens.
  useEffect(() => {
    if (conn !== "open") return;
    send({ type: "list_songs" });
    send({ type: "list_shows" });
    send({ type: "list_templates" });
  }, [conn, send]);

  // Build a store snapshot for collectDependencies.
  const storeSnapshot = useMemo(
    () => ({
      songs: new Map<string, Song>(Object.entries(songCache)),
      templates: new Map<string, Template>(Object.entries(templateCache)),
      shows: new Map<string, Show>(Object.entries(showCache)),
    }),
    [songCache, templateCache, showCache],
  );

  const selection: BundleSelection = useMemo(
    () => ({
      songIds: Array.from(selectedSongs),
      showIds: Array.from(selectedShows),
      templateIds: Array.from(selectedTemplates),
    }),
    [selectedSongs, selectedShows, selectedTemplates],
  );

  const hasSelection =
    selectedSongs.size > 0 || selectedShows.size > 0 || selectedTemplates.size > 0;

  // Resolve the bundle preview reactively.
  const preview = useMemo(() => {
    if (!hasSelection) return null;
    if (!includeDeps) {
      return {
        songs: Array.from(selectedSongs)
          .map((id) => songCache[id])
          .filter(Boolean) as Song[],
        templates: Array.from(selectedTemplates)
          .map((id) => templateCache[id])
          .filter(Boolean) as Template[],
        shows: Array.from(selectedShows)
          .map((id) => showCache[id])
          .filter(Boolean) as Show[],
        missing: [],
      };
    }
    return collectDependencies(selection, storeSnapshot);
  }, [
    hasSelection, includeDeps, selection, storeSnapshot, selectedSongs,
    selectedShows, selectedTemplates, songCache, templateCache, showCache,
  ]);

  function toggle(set: Set<string>, id: string): Set<string> {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  }

  // Prefetch any selected entity that isn't cached yet.
  useEffect(() => {
    if (conn !== "open") return;
    for (const id of selectedSongs) if (!songCache[id]) send({ type: "get_song", songId: id });
    for (const id of selectedShows) if (!showCache[id]) send({ type: "get_show", showId: id });
    for (const id of selectedTemplates) if (!templateCache[id]) send({ type: "get_template", templateId: id });
  }, [conn, send, selectedSongs, selectedShows, selectedTemplates, songCache, showCache, templateCache]);

  function downloadBundle() {
    if (!preview) return;
    const filename = `${slugify(bundleName) || "overlaysys"}.bundle.json`;
    const bundle = {
      format: "overlaysys-bundle" as const,
      version: 1 as const,
      exportedAt: new Date().toISOString(),
      ...(bundleName.trim() ? { name: bundleName.trim() } : {}),
      songs: preview.songs,
      templates: preview.templates,
      shows: preview.shows,
    };
    downloadJson(filename, bundle);
  }

  return (
    <section style={{ marginBottom: 24, padding: 12, border: "1px solid var(--border)", borderRadius: 4 }}>
      <h2 style={{ marginTop: 0, fontSize: 14 }}>Export bundle</h2>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <label style={{ width: 120, fontSize: 12, color: "var(--text-dim)" }}>Bundle name</label>
        <input
          value={bundleName}
          onChange={(e) => setBundleName(e.target.value)}
          placeholder="(optional)"
          style={{ flex: 1, maxWidth: 320 }}
        />
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginBottom: 8 }}>
        <input
          type="checkbox"
          checked={includeDeps}
          onChange={(e) => setIncludeDeps(e.target.checked)}
        />
        Include referenced dependencies
      </label>

      <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
        {(["songs", "shows", "templates"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              ...btn(),
              ...(tab === t ? { background: "var(--accent)", color: "#fff" } : {}),
            }}
          >
            {t} ({t === "songs" ? songsList.length : t === "shows" ? showMetas.length : templates.length})
          </button>
        ))}
      </div>

      <div style={{ maxHeight: 240, overflowY: "auto", border: "1px solid var(--border)", borderRadius: 4, padding: 6, marginBottom: 8 }}>
        {tab === "songs" && songsList.map((s) => (
          <CheckRow
            key={s.id}
            id={s.id}
            label={s.title || s.id}
            checked={selectedSongs.has(s.id)}
            onToggle={() => setSelectedSongs((cur) => toggle(cur, s.id))}
          />
        ))}
        {tab === "shows" && showMetas.map((s) => (
          <CheckRow
            key={s.id}
            id={s.id}
            label={s.name || s.id}
            checked={selectedShows.has(s.id)}
            onToggle={() => setSelectedShows((cur) => toggle(cur, s.id))}
          />
        ))}
        {tab === "templates" && templates.map((t) => (
          <CheckRow
            key={t.id}
            id={t.id}
            label={t.name || t.id}
            checked={selectedTemplates.has(t.id)}
            onToggle={() => setSelectedTemplates((cur) => toggle(cur, t.id))}
          />
        ))}
      </div>

      {preview && (preview.missing.length > 0) && (
        <div style={{ padding: 8, background: "rgba(245, 158, 11, 0.1)", border: "1px solid #f59e0b", borderRadius: 4, marginBottom: 8, fontSize: 12 }}>
          <strong>⚠ {preview.missing.length} reference(s) not found locally</strong>
          <ul style={{ margin: "4px 0 0", paddingLeft: 16 }}>
            {preview.missing.map((m, i) => (
              <li key={i}>
                <code>{m.kind}:{m.id}</code> referenced by <code>{m.referencedBy}</code> — will be omitted
              </li>
            ))}
          </ul>
        </div>
      )}

      {preview && (
        <p style={{ fontSize: 12, color: "var(--text-dim)" }}>
          Will export: <strong>{preview.songs.length}</strong> song(s),{" "}
          <strong>{preview.templates.length}</strong> template(s),{" "}
          <strong>{preview.shows.length}</strong> show(s).
        </p>
      )}

      <button onClick={downloadBundle} disabled={!hasSelection} style={btn("primary")}>
        Download bundle
      </button>
    </section>
  );
}

function CheckRow({
  id, label, checked, onToggle,
}: {
  id: string; label: string; checked: boolean; onToggle: () => void;
}) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 6px", fontSize: 13, cursor: "pointer" }}>
      <input type="checkbox" checked={checked} onChange={onToggle} />
      <span style={{ fontWeight: 600 }}>{label}</span>
      <code style={{ marginLeft: "auto", fontSize: 10, color: "var(--text-dim)" }}>{id}</code>
    </label>
  );
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function btn(kind: "default" | "primary" = "default"): React.CSSProperties {
  return {
    padding: "6px 10px",
    background: kind === "primary" ? "var(--accent)" : "var(--panel-2)",
    color: kind === "primary" ? "#fff" : "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    fontWeight: 600,
    cursor: "pointer",
    fontSize: 12,
  };
}
