"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  collectDependencies,
  collectReferencedAssetFilenames,
  type BundleAsset,
  type BundleSelection,
  type Hotcard,
  type Show,
  type Song,
  type Template,
} from "@overlaysys/core";
import { Button, Field, Input, Inline, Panel, colors } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";
import { downloadJson } from "@/lib/download";
import { fetchAssetBase64 } from "@/lib/assetTransfer";
import { isCloudMode } from "@/lib/mode";
import {
  getHotcardCloud,
  getShowCloud,
  getSongCloud,
  getTemplateCloud,
  refreshHotcardMetasCloud,
  refreshShowMetasCloud,
  refreshSongMetasCloud,
  refreshTemplateMetasCloud,
} from "@/lib/cloudData";

type Tab = "songs" | "shows" | "hotcards" | "templates";

export function ExportBundle() {
  const { send } = useWs();
  const conn = useStore((s) => s.conn);
  const songsList = useStore((s) => s.songs);
  const showMetas = useStore((s) => s.showMetas);
  const templates = useStore((s) => s.templates);
  const hotcardsList = useStore((s) => s.hotcards);
  const songCache = useStore((s) => s.songCache);
  const showCache = useStore((s) => s.showCache);
  const templateCache = useStore((s) => s.templateCache);
  const hotcardCache = useStore((s) => s.hotcardCache);

  const [tab, setTab] = useState<Tab>("songs");
  const [includeDeps, setIncludeDeps] = useState(true);
  const [includeAssets, setIncludeAssets] = useState(true);
  const [bundleName, setBundleName] = useState("");
  const [selectedSongs, setSelectedSongs] = useState<Set<string>>(new Set());
  const [selectedShows, setSelectedShows] = useState<Set<string>>(new Set());
  const [selectedTemplates, setSelectedTemplates] = useState<Set<string>>(new Set());
  const [selectedHotcards, setSelectedHotcards] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  // "Already asked" sets so we don't re-request entities while their replies
  // are in flight. The cache guards alone would otherwise re-fire each pending
  // request on every cache update, spamming the server and the render loop.
  const requestedSongs = useRef<Set<string>>(new Set());
  const requestedTemplates = useRef<Set<string>>(new Set());
  const requestedShows = useRef<Set<string>>(new Set());
  const requestedHotcards = useRef<Set<string>>(new Set());

  const cloud = isCloudMode();

  // Hydrate the lists once when the page opens.
  useEffect(() => {
    if (cloud) {
      Promise.all([
        refreshSongMetasCloud(),
        refreshShowMetasCloud(),
        refreshTemplateMetasCloud(),
        refreshHotcardMetasCloud(),
      ]).catch((err) => console.warn("[export] cloud list failed", err));
      return;
    }
    if (conn !== "open") return;
    send({ type: "list_songs" });
    send({ type: "list_shows" });
    send({ type: "list_templates" });
    send({ type: "list_hotcards" });
  }, [cloud, conn, send]);

  const storeSnapshot = useMemo(
    () => ({
      songs: new Map<string, Song>(Object.entries(songCache)),
      templates: new Map<string, Template>(Object.entries(templateCache)),
      shows: new Map<string, Show>(Object.entries(showCache)),
      hotcards: new Map<string, Hotcard>(Object.entries(hotcardCache)),
    }),
    [songCache, templateCache, showCache, hotcardCache],
  );

  const selection: BundleSelection = useMemo(
    () => ({
      songIds: Array.from(selectedSongs),
      showIds: Array.from(selectedShows),
      templateIds: Array.from(selectedTemplates),
      hotcardIds: Array.from(selectedHotcards),
    }),
    [selectedSongs, selectedShows, selectedTemplates, selectedHotcards],
  );

  const hasSelection =
    selectedSongs.size > 0 ||
    selectedShows.size > 0 ||
    selectedTemplates.size > 0 ||
    selectedHotcards.size > 0;

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
        hotcards: Array.from(selectedHotcards)
          .map((id) => hotcardCache[id])
          .filter(Boolean) as Hotcard[],
        missing: [],
      };
    }
    return collectDependencies(selection, storeSnapshot);
  }, [
    hasSelection, includeDeps, selection, storeSnapshot, selectedSongs,
    selectedShows, selectedTemplates, selectedHotcards,
    songCache, templateCache, showCache, hotcardCache,
  ]);

  const referencedAssets = useMemo(() => {
    if (!preview) return new Set<string>();
    return collectReferencedAssetFilenames({
      templates: preview.templates,
      hotcards: preview.hotcards,
      shows: preview.shows,
    });
  }, [preview]);

  function toggle(set: Set<string>, id: string): Set<string> {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  }

  function fetchSong(id: string): void {
    if (songCache[id] || requestedSongs.current.has(id)) return;
    requestedSongs.current.add(id);
    if (cloud) {
      getSongCloud(id)
        .then((s) => {
          if (s) useStore.getState().setSong(s);
        })
        .catch((err) => console.warn(`[export] song ${id}`, err));
      return;
    }
    send({ type: "get_song", songId: id });
  }
  function fetchTemplate(id: string): void {
    if (templateCache[id] || requestedTemplates.current.has(id)) return;
    requestedTemplates.current.add(id);
    if (cloud) {
      getTemplateCloud(id)
        .then((t) => {
          if (t) useStore.getState().setTemplate(t);
        })
        .catch((err) => console.warn(`[export] template ${id}`, err));
      return;
    }
    send({ type: "get_template", templateId: id });
  }
  function fetchShow(id: string): void {
    if (showCache[id] || requestedShows.current.has(id)) return;
    requestedShows.current.add(id);
    if (cloud) {
      getShowCloud(id)
        .then((s) => {
          if (s) useStore.getState().setShowFull(s);
        })
        .catch((err) => console.warn(`[export] show ${id}`, err));
      return;
    }
    send({ type: "get_show", showId: id });
  }
  function fetchHotcard(id: string): void {
    if (hotcardCache[id] || requestedHotcards.current.has(id)) return;
    requestedHotcards.current.add(id);
    if (cloud) {
      getHotcardCloud(id)
        .then((h) => {
          if (h) useStore.getState().setHotcard(h);
        })
        .catch((err) => console.warn(`[export] hotcard ${id}`, err));
      return;
    }
    send({ type: "get_hotcard", hotcardId: id });
  }

  // Eagerly hydrate every song, template, and hotcard once the meta lists
  // land. With these in cache, selecting a show resolves its dependency
  // walk in a single round-trip (the show itself) — the "references not
  // found locally" warning never has a chance to appear. Same logic for
  // hotcards so asset collection sees their data.
  useEffect(() => {
    if (!cloud && conn !== "open") return;
    for (const s of songsList) fetchSong(s.id);
    for (const t of templates) fetchTemplate(t.id);
    for (const h of hotcardsList) fetchHotcard(h.id);
    // fetchSong/fetchTemplate read from refs + caches; explicit deps below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloud, conn, send, songsList, templates, hotcardsList, songCache, templateCache, hotcardCache]);

  useEffect(() => {
    if (!cloud && conn !== "open") return;
    for (const id of selectedSongs) fetchSong(id);
    for (const id of selectedShows) fetchShow(id);
    for (const id of selectedTemplates) fetchTemplate(id);
    for (const id of selectedHotcards) fetchHotcard(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    conn, send, selectedSongs, selectedShows, selectedTemplates, selectedHotcards,
    songCache, showCache, templateCache, hotcardCache,
  ]);

  // Hydrate transitive deps surfaced by the dependency walk (e.g. songs and
  // templates referenced by a selected show). With eager hydration above
  // this is normally a no-op, but it covers the cold-cache race where a show
  // arrives before its songs/templates have been fetched.
  useEffect(() => {
    if (conn !== "open" || !preview) return;
    for (const m of preview.missing) {
      if (m.kind === "song") fetchSong(m.id);
      else if (m.kind === "template") fetchTemplate(m.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn, send, preview, songCache, templateCache]);

  async function downloadBundle() {
    if (!preview || downloading) return;
    setDownloading(true);
    setDownloadError(null);
    const filename = `${slugify(bundleName) || "overlaysys"}.bundle.json`;
    let assets: BundleAsset[] = [];
    if (includeAssets && referencedAssets.size > 0) {
      try {
        const fetched = await Promise.all(
          Array.from(referencedAssets).map(async (name): Promise<BundleAsset | null> => {
            const r = await fetchAssetBase64(name);
            if (!r) return null;
            return { filename: r.filename, size: r.size, data: r.base64 };
          }),
        );
        assets = fetched.filter((a): a is BundleAsset => a !== null);
      } catch (err) {
        setDownloadError(String(err));
        setDownloading(false);
        return;
      }
    }
    const bundle = {
      format: "overlaysys-bundle" as const,
      version: 1 as const,
      exportedAt: new Date().toISOString(),
      ...(bundleName.trim() ? { name: bundleName.trim() } : {}),
      songs: preview.songs,
      templates: preview.templates,
      shows: preview.shows,
      hotcards: preview.hotcards,
      assets,
    };
    downloadJson(filename, bundle);
    setDownloading(false);
  }

  return (
    <Panel title="Export bundle" padding="md" style={{ marginBottom: 24 }}>
      <Field label="Bundle name" layout="inline" labelWidth={120}>
        <Input
          value={bundleName}
          onChange={(e) => setBundleName(e.target.value)}
          placeholder="(optional)"
          style={{ maxWidth: 320 }}
        />
      </Field>

      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginBottom: 4 }}>
        <input
          type="checkbox"
          checked={includeDeps}
          onChange={(e) => setIncludeDeps(e.target.checked)}
        />
        Include referenced dependencies
      </label>

      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginBottom: 8 }}>
        <input
          type="checkbox"
          checked={includeAssets}
          onChange={(e) => setIncludeAssets(e.target.checked)}
        />
        Include binary assets (videos, fonts, images) — embeds bytes as base64
      </label>

      <Inline gap={1} style={{ marginBottom: 8 }}>
        {(["songs", "shows", "hotcards", "templates"] as const).map((t) => (
          <Button
            key={t}
            size="sm"
            variant={tab === t ? "primary" : "secondary"}
            onClick={() => setTab(t)}
          >
            {t} (
            {t === "songs"
              ? songsList.length
              : t === "shows"
              ? showMetas.length
              : t === "hotcards"
              ? hotcardsList.length
              : templates.length}
            )
          </Button>
        ))}
      </Inline>

      <div
        style={{
          maxHeight: 240,
          overflowY: "auto",
          border: `1px solid ${colors.border}`,
          borderRadius: 4,
          padding: 6,
          marginBottom: 8,
        }}
      >
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
        {tab === "hotcards" && hotcardsList.map((h) => (
          <CheckRow
            key={h.id}
            id={h.id}
            label={h.name || h.id}
            checked={selectedHotcards.has(h.id)}
            onToggle={() => setSelectedHotcards((cur) => toggle(cur, h.id))}
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
        <div
          style={{
            padding: 8,
            background: "rgba(245, 158, 11, 0.1)",
            border: `1px solid ${colors.warn}`,
            borderRadius: 4,
            marginBottom: 8,
            fontSize: 12,
          }}
        >
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
        <p style={{ fontSize: 12, color: colors.textDim }}>
          Will export: <strong>{preview.songs.length}</strong> song(s),{" "}
          <strong>{preview.templates.length}</strong> template(s),{" "}
          <strong>{preview.shows.length}</strong> show(s),{" "}
          <strong>{preview.hotcards.length}</strong> hotcard(s)
          {includeAssets && referencedAssets.size > 0 ? (
            <>
              {", "}
              <strong>{referencedAssets.size}</strong> asset(s)
            </>
          ) : null}
          .
        </p>
      )}

      {downloadError && (
        <p style={{ color: colors.errorText, fontSize: 12 }}>{downloadError}</p>
      )}

      <Button
        onClick={downloadBundle}
        disabled={!hasSelection || downloading}
        variant="primary"
        size="sm"
      >
        {downloading ? "Bundling…" : "Download bundle"}
      </Button>
    </Panel>
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
      <code style={{ marginLeft: "auto", fontSize: 10, color: colors.textDim }}>{id}</code>
    </label>
  );
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
