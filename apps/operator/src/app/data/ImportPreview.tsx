"use client";

import { useState } from "react";
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
import { Button, Panel, colors } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
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
 * preview with Replace/Skip decisions per existing-id conflict, then posts
 * the whole filtered bundle to `POST /api/import` in a single request.
 *
 * The server handles all of the asset-lift / URL-rewrite / fan-out save
 * work — see `server/src/importRoute.ts`. Keeping that logic server-side
 * avoids the half-dozen failure modes the previous WS-based loop hit.
 */

type Decision = "save" | "skip";
type ItemKind = "song" | "template" | "show" | "hotcard";

interface ItemRow {
  kind: ItemKind;
  id: string;
  label: string;
  conflict: boolean;
  decision: Decision;
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

export function ImportPreview() {
  const songMetas = useStore((s) => s.songs);
  const showMetas = useStore((s) => s.showMetas);
  const templates = useStore((s) => s.templates);
  const hotcardMetas = useStore((s) => s.hotcards);

  const [parseError, setParseError] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  function existingIds() {
    return {
      songs: new Set(songMetas.map((s) => s.id)),
      templates: new Set(templates.map((t) => t.id)),
      shows: new Set(showMetas.map((s) => s.id)),
      hotcards: new Set(hotcardMetas.map((h) => h.id)),
    };
  }

  function buildPreview(
    songs: Song[],
    templates: Template[],
    shows: Show[],
    hotcards: Hotcard[],
    assets: BundleAsset[],
    project?: Project,
  ): PreviewState {
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
      ...hotcards.map<ItemRow>((h) => ({
        kind: "hotcard",
        id: h.id,
        label: h.name || h.id,
        conflict: ex.hotcards.has(h.id),
        decision: ex.hotcards.has(h.id) ? "skip" : "save",
      })),
      ...shows.map<ItemRow>((sh) => ({
        kind: "show",
        id: sh.id,
        label: sh.name || sh.id,
        conflict: ex.shows.has(sh.id),
        decision: ex.shows.has(sh.id) ? "skip" : "save",
      })),
    ];
    return {
      songs,
      templates,
      shows,
      hotcards,
      assets,
      rows,
      ...(project ? { project } : {}),
    };
  }

  async function readFile(file: File) {
    setFilename(file.name);
    setParseError(null);
    setPreview(null);
    setResult(null);
    setImportError(null);
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
      setPreview(
        buildPreview(b.songs, b.templates, b.shows, b.hotcards, b.assets, b.project),
      );
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

  async function applyImport() {
    if (!preview || busy) return;
    setBusy(true);
    setImportError(null);
    setResult(null);

    // Filter by per-row decision; assets are always included (sha-named
    // files are idempotent on the server side).
    const savedTemplateIds = new Set(
      preview.rows.filter((r) => r.kind === "template" && r.decision === "save").map((r) => r.id),
    );
    const savedSongIds = new Set(
      preview.rows.filter((r) => r.kind === "song" && r.decision === "save").map((r) => r.id),
    );
    const savedHotcardIds = new Set(
      preview.rows.filter((r) => r.kind === "hotcard" && r.decision === "save").map((r) => r.id),
    );
    const savedShowIds = new Set(
      preview.rows.filter((r) => r.kind === "show" && r.decision === "save").map((r) => r.id),
    );

    const body = {
      templates: preview.templates.filter((t) => savedTemplateIds.has(t.id)),
      songs: preview.songs.filter((s) => savedSongIds.has(s.id)),
      hotcards: preview.hotcards.filter((h) => savedHotcardIds.has(h.id)),
      shows: preview.shows.filter((s) => savedShowIds.has(s.id)),
      assets: preview.assets,
    };

    try {
      if (isCloudMode()) {
        // Reconstruct the Bundle envelope applyBundleCloud expects.
        // The preview UI strips the `format`/`version` shell when it parses
        // an incoming bundle, so we synthesize a fresh one here. Any
        // `project` descriptor the source bundle carried is preserved on
        // the preview state and forwarded so shows/hotcards land scoped.
        const result = await applyBundleCloud({
          format: "overlaysys-bundle",
          version: 1,
          exportedAt: new Date().toISOString(),
          ...(preview.project ? { project: preview.project } : {}),
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
        setResult({
          ok: result.errors.length === 0,
          counts: result.counts,
          errors: result.errors,
        });
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
        const data = (await res.json()) as ImportResult;
        setResult(data);
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function dismissResult() {
    setResult(null);
    setImportError(null);
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
    <Panel title="Import" padding="md" style={{ marginBottom: 24 }}>
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        style={{ padding: 12, border: `1px dashed ${colors.border}`, borderRadius: 4, marginBottom: 8 }}
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
        <span style={{ fontSize: 12, color: colors.textDim }}>
          or drop a <code>.json</code> / <code>.bundle.json</code> file here
        </span>
        {filename && (
          <span style={{ marginLeft: 8, fontSize: 12 }}>
            Loaded: <code>{filename}</code>
          </span>
        )}
      </div>

      {parseError && (
        <p style={{ color: colors.errorText, fontSize: 12 }}>Parse failed: {parseError}</p>
      )}

      {preview && !result && (
        <>
          <div
            style={{
              maxHeight: 320,
              overflowY: "auto",
              border: `1px solid ${colors.border}`,
              borderRadius: 4,
              padding: 6,
              marginBottom: 8,
            }}
          >
            {preview.rows.length === 0 ? (
              <p style={{ fontSize: 12, color: colors.textDim }}>
                The file contained no entities.
              </p>
            ) : (
              preview.rows.map((row, idx) => (
                <div
                  key={`${row.kind}:${row.id}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "4px 6px",
                    fontSize: 13,
                    borderBottom: `1px solid ${colors.border}`,
                  }}
                >
                  <span
                    style={{
                      minWidth: 80,
                      fontSize: 11,
                      color: colors.textDim,
                      fontFamily: "ui-monospace, monospace",
                    }}
                  >
                    {row.kind}
                  </span>
                  <span style={{ fontWeight: 600 }}>{row.label}</span>
                  <code style={{ fontSize: 10, color: colors.textDim }}>{row.id}</code>
                  <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
                    {row.conflict ? (
                      <>
                        <span style={{ color: colors.warn, fontSize: 11 }}>⚠ exists</span>
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
                      <span style={{ color: colors.green, fontSize: 11 }}>new</span>
                    )}
                  </span>
                </div>
              ))
            )}
          </div>
          {preview.assets.length > 0 && (
            <p style={{ fontSize: 12, color: colors.textDim, marginBottom: 8 }}>
              Bundle includes <strong>{preview.assets.length}</strong> binary asset(s) — they'll be restored to <code>data/assets/</code>.
            </p>
          )}
          <Button
            onClick={applyImport}
            disabled={(saveCount === 0 && preview.assets.length === 0) || busy}
            variant="primary"
            size="sm"
          >
            {busy
              ? "Importing…"
              : `Save ${saveCount} item(s)${skipCount > 0 ? `, skip ${skipCount}` : ""}${preview.assets.length > 0 ? ` + ${preview.assets.length} asset(s)` : ""}`}
          </Button>
        </>
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
          <Button onClick={dismissResult} variant="secondary" size="sm" style={{ marginTop: 8 }}>
            Close
          </Button>
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
            {result.ok ? "✓ Imported" : "Imported with errors"}: {result.counts.templates}{" "}
            template(s), {result.counts.songs} song(s), {result.counts.hotcards} hotcard(s),{" "}
            {result.counts.shows} show(s), {result.counts.assets} asset(s)
          </strong>
          {result.errors.length > 0 && (
            <ul style={{ margin: "4px 0 0", paddingLeft: 16, color: colors.errorText }}>
              {result.errors.map((e, i) => (
                <li key={i}>
                  <code>
                    {e.kind}:{e.id}
                  </code>{" "}
                  {e.message}
                </li>
              ))}
            </ul>
          )}
          <Button onClick={dismissResult} variant="secondary" size="sm" style={{ marginTop: 8 }}>
            Close
          </Button>
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
