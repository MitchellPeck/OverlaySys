"use client";

import { TriangleAlert } from "lucide-react";
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
import { Button, Checkbox, Field, Input, Panel, SegmentedControl, colors, useToast } from "@overlaysys/ui";
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

type Tab = "shows" | "songs" | "templates" | "hotcards";

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

  const toast = useToast();
  const projects = useStore((s) => s.projects);
  const currentProjectId = useStore((s) => s.currentProjectId);
  const [tab, setTab] = useState<Tab>("shows");
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
    // The bundle's project: that of the first selected show or hotcard, else the current one.
    const firstProjectId =
      showMetas.find((m) => selectedShows.has(m.id))?.projectId ??
      hotcardsList.find((h) => selectedHotcards.has(h.id))?.projectId ??
      currentProjectId;
    const project = projects.find((p) => p.id === firstProjectId);
    const bundle = {
      format: "overlaysys-bundle" as const,
      version: 1 as const,
      exportedAt: new Date().toISOString(),
      ...(project ? { project } : {}),
      ...(bundleName.trim() ? { name: bundleName.trim() } : {}),
      songs: preview.songs,
      templates: preview.templates,
      shows: preview.shows,
      hotcards: preview.hotcards,
      assets,
    };
    downloadJson(filename, bundle);
    setDownloading(false);
    toast({ tone: "ok", message: `Downloaded ${filename}` });
  }

  const projectName = (id: string | undefined) =>
    id ? (projects.find((p) => p.id === id)?.name ?? "Other project") : undefined;

  const lists: Record<
    Tab,
    { label: string; items: { id: string; label: string; sub?: string }[]; selected: Set<string>; set: (s: Set<string>) => void }
  > = {
    shows: {
      label: "Shows",
      items: showMetas.map((s) => ({ id: s.id, label: s.name || "Untitled show", sub: projectName(s.projectId) })),
      selected: selectedShows,
      set: setSelectedShows,
    },
    songs: {
      label: "Songs",
      items: songsList.map((s) => ({ id: s.id, label: s.title || "Untitled song" })),
      selected: selectedSongs,
      set: setSelectedSongs,
    },
    templates: {
      label: "Designs",
      items: templates.map((t) => ({ id: t.id, label: t.name || "Untitled design" })),
      selected: selectedTemplates,
      set: setSelectedTemplates,
    },
    hotcards: {
      label: "Hotcards",
      items: hotcardsList.map((h) => ({ id: h.id, label: h.name || "Untitled hotcard", sub: projectName(h.projectId) })),
      selected: selectedHotcards,
      set: setSelectedHotcards,
    },
  };
  const active = lists[tab];
  const allSelected = active.items.length > 0 && active.items.every((it) => active.selected.has(it.id));

  return (
    <Panel title="Export bundle" padding="md">
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Field label="Bundle name" layout="inline" labelWidth={120}>
          <Input
            value={bundleName}
            onChange={(e) => setBundleName(e.target.value)}
            placeholder="(optional)"
            style={{ maxWidth: 320 }}
          />
        </Field>

        <Checkbox checked={includeDeps} onChange={setIncludeDeps} label="Include referenced dependencies" />
        <Checkbox
          checked={includeAssets}
          onChange={setIncludeAssets}
          label="Include binary assets (videos, fonts, images); embeds bytes as base64"
        />

        <SegmentedControl<Tab>
          aria-label="What to export"
          value={tab}
          onChange={setTab}
          options={(Object.keys(lists) as Tab[]).map((t) => ({
            value: t,
            label: `${lists[t].label} \u00b7 ${lists[t].selected.size} selected`,
          }))}
        />

        <div style={{ border: `1px solid ${colors.border}`, borderRadius: 4 }}>
          <div style={{ padding: "6px 10px", borderBottom: `1px solid ${colors.border}` }}>
            <Checkbox
              checked={allSelected}
              disabled={active.items.length === 0}
              onChange={(on) => active.set(on ? new Set(active.items.map((it) => it.id)) : new Set())}
              label={`Select all ${active.label.toLowerCase()}`}
            />
          </div>
          <div style={{ maxHeight: 240, overflowY: "auto", padding: 6 }}>
            {active.items.length === 0 && (
              <p style={{ fontSize: 12, color: colors.textDim, margin: 6 }}>Nothing here yet.</p>
            )}
            {active.items.map((it) => (
              <div key={it.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 6px", fontSize: 13 }}>
                <Checkbox
                  checked={active.selected.has(it.id)}
                  onChange={() => active.set(toggle(active.selected, it.id))}
                  aria-label={`Export ${it.label}`}
                />
                <span style={{ fontWeight: 600 }}>{it.label}</span>
                {it.sub && <span style={{ marginLeft: "auto", fontSize: 11, color: colors.textDim }}>{it.sub}</span>}
              </div>
            ))}
          </div>
        </div>

        {preview && preview.missing.length > 0 && (
          <div
            style={{
              padding: 8,
              background: "rgba(245, 158, 11, 0.1)",
              border: `1px solid ${colors.warn}`,
              borderRadius: 4,
              fontSize: 12,
            }}
          >
            <strong>
              <TriangleAlert size={14} aria-hidden style={{ verticalAlign: "-2px" }} /> {preview.missing.length}{" "}
              reference{preview.missing.length === 1 ? "" : "s"} not found locally; they will be left out
            </strong>
          </div>
        )}

        {preview && (
          <p style={{ fontSize: 12, color: colors.textDim, margin: 0 }}>
            Will export {preview.shows.length} show{preview.shows.length === 1 ? "" : "s"}, {preview.songs.length}{" "}
            song{preview.songs.length === 1 ? "" : "s"}, {preview.templates.length} design
            {preview.templates.length === 1 ? "" : "s"}, {preview.hotcards.length} hotcard
            {preview.hotcards.length === 1 ? "" : "s"}
            {includeAssets && referencedAssets.size > 0
              ? `, ${referencedAssets.size} asset${referencedAssets.size === 1 ? "" : "s"}`
              : ""}
            .
          </p>
        )}

        {downloadError && <p role="alert" style={{ color: colors.errorText, fontSize: 12, margin: 0 }}>{downloadError}</p>}

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Button onClick={downloadBundle} disabled={!hasSelection || downloading} variant="primary" size="sm">
            {downloading ? "Bundling…" : "Download bundle"}
          </Button>
          {!hasSelection && <span style={{ fontSize: 12, color: colors.textDim }}>Pick at least one item</span>}
        </div>
      </div>
    </Panel>
  );
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
