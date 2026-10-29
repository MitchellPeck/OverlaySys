"use client";

import { Check, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { v4 as uuid } from "uuid";
import {
  detectImport,
  type Bundle,
  type BundleAsset,
  type Hotcard,
  type Project,
  type Show,
  type Song,
  type Template,
} from "@overlaysys/core";
import { Button, FileDrop, Panel, SegmentedControl, Select, colors, useConfirm, useToast } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { findLikelySongDuplicate, setAllFlagged, type LikelyDuplicate } from "./bundleDuplicates";
import { buildImportRequest } from "./importRequest";
import { planImport, summarizePlan, type ImportDecision } from "./planImport";
import { defaultServerUrl } from "@/lib/wsClient";
import { isCloudMode } from "@/lib/mode";
import {
  applyBundleCloud,
  refreshHotcardMetasCloud,
  refreshProjectsCloud,
  refreshShowMetasCloud,
  refreshSongMetasCloud,
  refreshTemplateMetasCloud,
} from "@/lib/cloudData";

/**
 * Bundle import UI. Reads a bundle (or single-entity) JSON file, shows a
 * plan with a decision per item (import, replace, copy, skip) and a target
 * project for shows and hotcards, then posts the whole filtered bundle to
 * `POST /api/import` in a single request.
 *
 * The server handles all of the asset-lift / URL-rewrite / fan-out save
 * work — see `server/src/importRoute.ts`. Keeping that logic server-side
 * avoids the half-dozen failure modes the previous WS-based loop hit.
 */

type ItemKind = "song" | "template" | "show" | "hotcard";

interface ItemRow {
  kind: ItemKind;
  id: string;
  name: string;
  /** An existing item with the same id; importing replaces it. */
  conflict?: { name: string; updatedAt?: string };
  /** Songs only: an existing song under another id that this probably duplicates. */
  likelyDuplicate?: LikelyDuplicate;
  /** Project the item came from (shows and hotcards). */
  project?: string;
  decision: ImportDecision;
  targetProject: string;
}

interface PreviewState {
  songs: Song[];
  templates: Template[];
  shows: Show[];
  hotcards: Hotcard[];
  assets: BundleAsset[];
  rows: ItemRow[];
  /**
   * Carried from the source bundle when present. Cloud import forwards it
   * to applyBundleCloud so shows and hotcards land scoped to the right
   * project — see server/src/importRoute.ts for the local-mode equivalent.
   */
  project?: Project;
}

interface ImportResult {
  ok: boolean;
  counts: {
    templates: number;
    hotcards: number;
    shows: number;
    songs: number;
    projects?: number;
    assets: number;
  };
  errors: { kind: string; id: string; message: string }[];
}

const KIND_LABEL: Record<ItemKind, string> = { song: "Song", template: "Design", show: "Show", hotcard: "Hotcard" };

function formatEdited(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function ImportPreview() {
  const songMetas = useStore((s) => s.songs);
  const showMetas = useStore((s) => s.showMetas);
  const templates = useStore((s) => s.templates);
  const hotcardMetas = useStore((s) => s.hotcards);
  const projects = useStore((s) => s.projects);
  const currentProjectId = useStore((s) => s.currentProjectId);
  const toast = useToast();
  const confirm = useConfirm();

  const [parseError, setParseError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  function buildPreview(
    songs: Song[],
    tpls: Template[],
    shows: Show[],
    hotcards: Hotcard[],
    assets: BundleAsset[],
    project?: Project,
  ): PreviewState {
    const exSongs = new Map(songMetas.map((s) => [s.id, s]));
    const exTemplates = new Map(templates.map((t) => [t.id, t]));
    const exShows = new Map(showMetas.map((s) => [s.id, s]));
    const exHotcards = new Map(hotcardMetas.map((h) => [h.id, h]));
    // Only projects that exist on this install count; anything else falls back to the current project.
    const known = new Set(projects.map((p) => p.id));
    const fromProject = (id: string | undefined) => (id && known.has(id) ? id : undefined);

    const rows = [
      ...songs.map((s) => {
        const hit = exSongs.get(s.id);
        const dup = hit ? null : findLikelySongDuplicate(s, songMetas);
        return {
          kind: "song" as const,
          id: s.id,
          name: s.title || "Untitled song",
          ...(hit ? { conflict: { name: hit.title, ...(hit.updatedAt ? { updatedAt: hit.updatedAt } : {}) } } : {}),
          ...(dup ? { likelyDuplicate: dup } : {}),
        };
      }),
      ...tpls.map((t) => {
        const hit = exTemplates.get(t.id);
        return {
          kind: "template" as const,
          id: t.id,
          name: t.name || "Untitled design",
          ...(hit ? { conflict: { name: hit.name, ...(hit.updatedAt ? { updatedAt: hit.updatedAt } : {}) } } : {}),
        };
      }),
      ...hotcards.map((h) => {
        const hit = exHotcards.get(h.id);
        const proj = fromProject(h.projectId);
        return {
          kind: "hotcard" as const,
          id: h.id,
          name: h.name || "Untitled hotcard",
          ...(hit ? { conflict: { name: hit.name } } : {}),
          ...(proj ? { project: proj } : {}),
        };
      }),
      ...shows.map((sh) => {
        const hit = exShows.get(sh.id);
        const proj = fromProject(sh.projectId);
        return {
          kind: "show" as const,
          id: sh.id,
          name: sh.name || "Untitled show",
          ...(hit ? { conflict: { name: hit.name, ...(hit.updatedAt ? { updatedAt: hit.updatedAt } : {}) } } : {}),
          ...(proj ? { project: proj } : {}),
        };
      }),
    ];
    const planned = planImport(rows, { currentProject: currentProjectId }).rows as ItemRow[];
    return { songs, templates: tpls, shows, hotcards, assets, rows: planned, ...(project ? { project } : {}) };
  }

  async function readFile(f: File) {
    setFile(f);
    setParseError(null);
    setPreview(null);
    setResult(null);
    setImportError(null);
    let text: string;
    try {
      text = await f.text();
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
      setPreview(buildPreview(b.songs, b.templates, b.shows, b.hotcards, b.assets, b.project));
    } else if (detected.kind === "song") {
      setPreview(buildPreview([detected.song], [], [], [], []));
    } else if (detected.kind === "template") {
      setPreview(buildPreview([], [detected.template], [], [], []));
    } else if (detected.kind === "show") {
      setPreview(buildPreview([], [], [detected.show], [], []));
    } else if (detected.kind === "hotcard") {
      setPreview(buildPreview([], [], [], [detected.hotcard], []));
    }
  }

  function setAll(decision: ImportDecision) {
    setPreview((p) => (p ? { ...p, rows: setAllFlagged(p.rows, decision) } : p));
  }

  function patchRow(idx: number, patch: Partial<ItemRow>) {
    setPreview((p) => {
      if (!p || !p.rows[idx]) return p;
      const rows = p.rows.slice();
      rows[idx] = { ...rows[idx]!, ...patch };
      return { ...p, rows };
    });
  }

  async function applyImport() {
    if (!preview || busy) return;
    const replaced = preview.rows.filter((r) => r.decision === "replace").length;
    if (replaced > 0) {
      const ok = await confirm({
        title: "Replace existing items?",
        message: `${replaced} existing item${replaced === 1 ? "" : "s"} will be overwritten with the versions in this file.`,
        confirmLabel: `Replace ${replaced}`,
        danger: true,
      });
      if (!ok) return;
    }
    setBusy(true);
    setImportError(null);
    setResult(null);

    const body = buildImportRequest(preview, preview.rows, (prefix) => `${prefix}-${uuid().slice(0, 8)}`);

    try {
      if (isCloudMode()) {
        // Forward the source project descriptor only when everything lands in it;
        // otherwise it would override the per-item target projects.
        const landsInSource =
          preview.project &&
          [...body.shows, ...body.hotcards].every((x) => x.projectId === preview.project!.id);
        const res = await applyBundleCloud({
          format: "overlaysys-bundle",
          version: 1,
          exportedAt: new Date().toISOString(),
          ...(landsInSource && preview.project ? { project: preview.project } : {}),
          templates: body.templates,
          songs: body.songs,
          hotcards: body.hotcards,
          shows: body.shows,
          channels: [],
          channelOverrides: [],
          assets: body.assets,
        });
        // Refresh in-memory caches so the operator UI reflects what just
        // landed on the cloud without a hard reload.
        await Promise.all([
          refreshProjectsCloud(),
          refreshTemplateMetasCloud(),
          refreshSongMetasCloud(),
          refreshShowMetasCloud(),
          refreshHotcardMetasCloud(),
        ]).catch(() => {});
        finish({ ok: res.errors.length === 0, counts: res.counts, errors: res.errors });
      } else {
        const res = await fetch(`${httpBase()}/api/import`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
        }
        finish((await res.json()) as ImportResult);
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function finish(r: ImportResult) {
    setResult(r);
    if (r.ok) toast({ tone: "ok", message: "Import finished" });
  }

  function dismissResult() {
    setResult(null);
    setImportError(null);
    setPreview(null);
    setFile(null);
  }

  const rows = preview?.rows ?? [];
  const conflictCount = rows.filter((r) => r.conflict).length;
  const duplicateCount = rows.filter((r) => r.likelyDuplicate).length;
  const doingCount = rows.filter((r) => r.decision !== "skip").length;
  const summary = summarizePlan(rows);

  return (
    <Panel title="Import bundle" padding="md">
      <FileDrop
        accept=".json"
        hint={
          <>
            Drop a bundle, show, song, design or hotcard file (.json). Items already in your library are
            flagged before anything is saved.
          </>
        }
        file={file}
        onFile={(f) => void readFile(f)}
        onClear={dismissResult}
      />

      {parseError && (
        <p role="alert" style={{ color: colors.errorText, fontSize: 12 }}>
          Could not read this file: {parseError}
        </p>
      )}

      {preview && !result && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
          {(conflictCount > 0 || duplicateCount > 0) && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12 }}>
              <span style={{ color: colors.warn }}>
                <TriangleAlert size={14} aria-hidden style={{ verticalAlign: "-2px" }} />{" "}
                {conflictCount > 0 && `${conflictCount} already exist${conflictCount === 1 ? "s" : ""}`}
                {conflictCount > 0 && duplicateCount > 0 && ", "}
                {duplicateCount > 0 &&
                  `${duplicateCount} song${duplicateCount === 1 ? " looks" : "s look"} like ${duplicateCount === 1 ? "one" : "ones"} you have`}
              </span>
              <Button size="sm" onClick={() => setAll("replace")}>Replace all</Button>
              <Button size="sm" onClick={() => setAll("skip")}>Skip all</Button>
              <Button size="sm" onClick={() => setAll("copy")}>Import all as copies</Button>
            </div>
          )}

          <div style={{ maxHeight: 360, overflowY: "auto", border: `1px solid ${colors.border}`, borderRadius: 4 }}>
            {rows.length === 0 ? (
              <p style={{ fontSize: 12, color: colors.textDim, padding: 8, margin: 0 }}>This file has nothing to import.</p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: colors.textDim }}>
                    <th style={{ padding: "6px 8px", width: 80 }}>Type</th>
                    <th style={{ padding: "6px 8px" }}>Name</th>
                    <th style={{ padding: "6px 8px", width: 230 }}>Project</th>
                    <th style={{ padding: "6px 8px", width: 260 }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, idx) => {
                    const options: { value: ImportDecision; label: string }[] = row.conflict
                      ? [
                          { value: "replace", label: "Replace" },
                          ...(row.kind !== "template" ? [{ value: "copy" as const, label: "Copy" }] : []),
                          { value: "skip", label: "Skip" },
                        ]
                      : [
                          { value: "import", label: row.likelyDuplicate ? "Import anyway" : "Import" },
                          ...(row.likelyDuplicate && row.kind !== "template" ? [{ value: "copy" as const, label: "Copy" }] : []),
                          { value: "skip", label: "Skip" },
                        ];
                    const edited = formatEdited(row.conflict?.updatedAt);
                    const perProject = row.kind === "show" || row.kind === "hotcard";
                    return (
                      <tr key={`${row.kind}:${row.id}`} style={{ borderTop: `1px solid ${colors.border}`, verticalAlign: "top" }}>
                        <td style={{ padding: "6px 8px", color: colors.textDim }}>{KIND_LABEL[row.kind]}</td>
                        <td style={{ padding: "6px 8px" }}>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{row.name}</div>
                          {row.conflict && (
                            <div style={{ color: colors.warn, fontSize: 11 }}>
                              Replaces: {row.conflict.name || row.name}
                              {edited && ` · edited ${edited}`}
                            </div>
                          )}
                          {row.likelyDuplicate && (
                            <div style={{ color: colors.warn, fontSize: 11 }}>
                              Possible duplicate of {row.likelyDuplicate.title || "a song in your library"}
                              {row.likelyDuplicate.reason === "ccli" ? " (same CCLI #)" : " (same title)"}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: "6px 8px" }}>
                          {perProject ? (
                            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                              <span style={{ color: colors.textDim, whiteSpace: "nowrap" }}>
                                Put into:
                              </span>
                              <Select
                                aria-label={`Project for ${row.name}`}
                                value={row.targetProject}
                                onChange={(e) => patchRow(idx, { targetProject: e.target.value })}
                                style={{ minWidth: 120 }}
                              >
                                {projects.map((p) => (
                                  <option key={p.id} value={p.id}>{p.name}</option>
                                ))}
                              </Select>
                            </div>
                          ) : (
                            <span style={{ color: colors.textDim }}>Library</span>
                          )}
                        </td>
                        <td style={{ padding: "6px 8px" }}>
                          <SegmentedControl<ImportDecision>
                            size="sm"
                            aria-label={`What to do with ${row.name}`}
                            value={row.decision}
                            options={options}
                            onChange={(d) => patchRow(idx, { decision: d })}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {preview.assets.length > 0 && (
            <p style={{ fontSize: 12, color: colors.textDim, margin: 0 }}>
              This file includes {preview.assets.length} media file{preview.assets.length === 1 ? "" : "s"}; they will be restored with it.
            </p>
          )}

          <div>
            <Button
              onClick={() => void applyImport()}
              disabled={(doingCount === 0 && preview.assets.length === 0) || busy}
              variant="primary"
              size="sm"
            >
              {busy ? "Importing…" : summary}
            </Button>
          </div>
        </div>
      )}

      {importError && (
        <div
          style={{
            marginTop: 12,
            padding: 10,
            background: "rgba(245, 158, 11, 0.1)",
            border: `1px solid ${colors.warn}`,
            borderRadius: 4,
            fontSize: 12,
          }}
        >
          <strong>Import failed:</strong> {importError}
          <div>
            <Button onClick={dismissResult} variant="secondary" size="sm" style={{ marginTop: 8 }}>
              Close
            </Button>
          </div>
        </div>
      )}

      {result && (
        <div
          style={{
            marginTop: 12,
            padding: 10,
            background: result.ok ? "rgba(34, 197, 94, 0.08)" : "rgba(245, 158, 11, 0.1)",
            border: `1px solid ${result.ok ? colors.border : colors.warn}`,
            borderRadius: 4,
            fontSize: 12,
          }}
        >
          <strong>
            {result.ok ? (
              <>
                <Check size={14} aria-hidden style={{ verticalAlign: "-2px" }} /> Imported
              </>
            ) : (
              "Imported with errors"
            )}
            : {result.counts.shows} show{result.counts.shows === 1 ? "" : "s"}, {result.counts.songs} song
            {result.counts.songs === 1 ? "" : "s"}, {result.counts.templates} design
            {result.counts.templates === 1 ? "" : "s"}, {result.counts.hotcards} hotcard
            {result.counts.hotcards === 1 ? "" : "s"}, {result.counts.assets} media file
            {result.counts.assets === 1 ? "" : "s"}
          </strong>
          {result.errors.length > 0 && (
            <ul style={{ margin: "4px 0 0", paddingLeft: 16, color: colors.errorText }}>
              {result.errors.map((e, i) => (
                <li key={i}>
                  {e.kind}: {e.message}
                </li>
              ))}
            </ul>
          )}
          <div>
            <Button onClick={dismissResult} variant="secondary" size="sm" style={{ marginTop: 8 }}>
              Close
            </Button>
          </div>
        </div>
      )}
    </Panel>
  );
}

/**
 * HTTP origin of the server, derived from the WS URL the operator is already
 * configured with. The operator may run on a different host than the server
 * in dev (operator @ :3000, server @ :4000), so we can't just use
 * `window.location.origin` here.
 */
function httpBase(): string {
  const ws = defaultServerUrl();
  try {
    const u = new URL(ws);
    const proto = u.protocol === "wss:" ? "https:" : "http:";
    return `${proto}//${u.host}`;
  } catch {
    return typeof window !== "undefined" ? window.location.origin : "";
  }
}
