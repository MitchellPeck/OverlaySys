"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Button,
  Modal,
  Select,
  colors,
} from "@overlaysys/ui";
import type {
  Bundle,
  Hotcard,
  Project,
  Show,
  Song,
  Template,
} from "@overlaysys/core";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";
import {
  buildCloudProjectBundle,
  listCloudProjects,
} from "@/lib/projectSync";
import { defaultServerUrl } from "@/lib/wsClient";
import { diffEntity, type FieldDiff } from "@/lib/diffEntity";

/**
 * Pull-from-cloud picker + per-entity review.
 *
 * Two-step flow:
 *   1. Pick a cloud project from a dropdown.
 *   2. We build the bundle for that project from Supabase, then list its
 *      entities side-by-side with local state. Each row gets a `skip` or
 *      `save` decision; existing local items default to `skip`, missing
 *      ones to `save`. Same mental model as the file-based /data import.
 *   3. On Pull, the filtered bundle is POSTed to the local server's
 *      /api/import endpoint, which lifts assets and writes everything to
 *      disk.
 */

type Decision = "save" | "skip";
type ItemKind = "song" | "template" | "show" | "hotcard";

interface ItemRow {
  kind: ItemKind;
  id: string;
  label: string;
  conflict: boolean;
  decision: Decision;
  /**
   * Set once local payload + cloud payload are both available. `null`
   * means "still fetching local for diff"; empty array means "no
   * differences" (id matches, content matches); non-empty means the
   * specific top-level fields that differ. Always undefined for
   * non-conflict rows.
   */
  diff?: FieldDiff[] | null;
  expanded?: boolean;
}

interface PreviewState {
  bundle: Bundle;
  rows: ItemRow[];
}

export function CloudPullModal({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { send } = useWs();
  const localSongs = useStore((s) => s.songs);
  const localTemplates = useStore((s) => s.templates);
  const localShows = useStore((s) => s.showMetas);
  const localHotcards = useStore((s) => s.hotcards);
  const localProjects = useStore((s) => s.projects);
  const songCache = useStore((s) => s.songCache);
  const templateCache = useStore((s) => s.templateCache);
  const showCache = useStore((s) => s.showCache);
  const hotcardCache = useStore((s) => s.hotcardCache);

  const [cloudProjects, setCloudProjects] = useState<Project[] | null>(null);
  const [picked, setPicked] = useState<string>("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Load the project list once on mount.
  useEffect(() => {
    let cancelled = false;
    listCloudProjects()
      .then((list) => {
        if (cancelled) return;
        setCloudProjects(list);
        // Auto-pick the first project so the user lands on something
        // sensible instead of an empty dropdown.
        if (list[0]) setPicked(list[0].id);
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function loadPreview() {
    if (!picked) return;
    setLoading(true);
    setProgress("");
    try {
      const bundle = await buildCloudProjectBundle(picked, (p) =>
        setProgress(p.message),
      );
      setPreview(buildPreview(bundle, {
        songs: localSongs.map((s) => s.id),
        templates: localTemplates.map((t) => t.id),
        shows: localShows.map((s) => s.id),
        hotcards: localHotcards.map((h) => h.id),
        projects: localProjects.map((p) => p.id),
      }));
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
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

  function toggleExpand(idx: number) {
    setPreview((p) => {
      if (!p) return p;
      const rows = p.rows.slice();
      const row = rows[idx];
      if (!row) return p;
      rows[idx] = { ...row, expanded: !row.expanded };
      return { ...p, rows };
    });
  }

  // For every conflicting row, request the local payload via WS so we can
  // compute a field diff against the cloud version. Caches fill async; an
  // effect below re-runs when caches change and stamps diff results.
  useEffect(() => {
    if (!preview) return;
    for (const row of preview.rows) {
      if (!row.conflict) continue;
      if (cacheHas(row, songCache, templateCache, showCache, hotcardCache)) continue;
      sendGet(send, row);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview?.bundle.project?.id]);

  // Recompute diffs whenever the local caches change. This runs even
  // before all fetches complete — diff rows show "computing…" until
  // both sides are available.
  useEffect(() => {
    if (!preview) return;
    let mutated = false;
    const rows = preview.rows.map<ItemRow>((row) => {
      if (!row.conflict) return row;
      const local = lookupLocal(row, songCache, templateCache, showCache, hotcardCache);
      if (!local) {
        if (row.diff === undefined) {
          mutated = true;
          return { ...row, diff: null };
        }
        return row;
      }
      const cloud = lookupCloud(row, preview.bundle);
      if (!cloud) return row;
      const next = diffEntity(local, cloud);
      // Only mark as changed if the diff result actually differs from
      // what we last set. Otherwise React rerenders thrash this effect.
      if (
        row.diff === undefined ||
        row.diff === null ||
        !sameDiff(row.diff, next)
      ) {
        mutated = true;
        return { ...row, diff: next };
      }
      return row;
    });
    if (mutated) setPreview({ ...preview, rows });
  }, [preview, songCache, templateCache, showCache, hotcardCache]);

  function setAll(decision: Decision) {
    setPreview((p) => {
      if (!p) return p;
      return { ...p, rows: p.rows.map((r) => ({ ...r, decision })) };
    });
  }

  async function submit() {
    if (!preview) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const filtered = filterBundleByDecisions(preview.bundle, preview.rows);
      // POST to the local server. Same body shape importRoute accepts.
      const res = await fetch(`${httpBase()}/api/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templates: filtered.templates,
          songs: filtered.songs,
          hotcards: filtered.hotcards,
          shows: filtered.shows,
          project: preview.bundle.project,
          assets: preview.bundle.assets,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
      }
      setDone(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const summary = useMemo(() => {
    if (!preview) return null;
    const saved = preview.rows.filter((r) => r.decision === "save");
    return {
      total: preview.rows.length,
      save: saved.length,
      conflicts: preview.rows.filter((r) => r.conflict).length,
    };
  }, [preview]);

  // ── State 1: project picker ───────────────────────────────────────────
  if (!preview) {
    return (
      <Modal
        open
        size="md"
        title="Pull from cloud"
        onClose={onClose}
        footer={
          <>
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={loadPreview}
              disabled={!picked || loading}
            >
              {loading ? "Loading…" : "Review"}
            </Button>
          </>
        }
      >
        {loadError && (
          <p style={{ color: colors.red, fontSize: 13 }}>
            Failed to list cloud projects: {loadError}
          </p>
        )}
        {!loadError && cloudProjects === null && (
          <p style={{ color: colors.textDim, fontSize: 13 }}>
            Loading cloud projects…
          </p>
        )}
        {cloudProjects !== null && cloudProjects.length === 0 && (
          <p style={{ color: colors.textDim, fontSize: 13 }}>
            No projects in the cloud yet.
          </p>
        )}
        {cloudProjects && cloudProjects.length > 0 && (
          <>
            <label
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                fontSize: 12,
                color: colors.textDim,
              }}
            >
              <span>Cloud project</span>
              <Select value={picked} onChange={(e) => setPicked(e.target.value)}>
                {cloudProjects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.id})
                    {localProjects.some((lp) => lp.id === p.id)
                      ? " — already local"
                      : ""}
                  </option>
                ))}
              </Select>
            </label>
            {loading && (
              <p
                style={{
                  marginTop: 12,
                  fontSize: 12,
                  color: colors.textDim,
                }}
              >
                {progress || "Loading bundle…"}
              </p>
            )}
          </>
        )}
      </Modal>
    );
  }

  // ── State 2: bundle review ────────────────────────────────────────────
  if (done) {
    return (
      <Modal
        open
        size="md"
        title="Pulled from cloud"
        onClose={() => {
          onClose();
          onSuccess();
        }}
        footer={
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              onClose();
              onSuccess();
            }}
          >
            Done
          </Button>
        }
      >
        <p style={{ fontSize: 13 }}>
          Wrote {summary?.save ?? 0} item(s) to local data.
        </p>
      </Modal>
    );
  }

  return (
    <Modal
      open
      size="lg"
      title={`Review pull: ${preview.bundle.project?.name ?? picked}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={submit}
            disabled={submitting || (summary?.save ?? 0) === 0}
          >
            {submitting
              ? "Pulling…"
              : `Pull ${summary?.save ?? 0} item${summary?.save === 1 ? "" : "s"}`}
          </Button>
        </>
      }
    >
      {summary && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 12,
            paddingBottom: 8,
            borderBottom: "1px solid var(--border)",
            fontSize: 12,
            color: colors.textDim,
          }}
        >
          <span>
            {summary.save} of {summary.total} selected
            {summary.conflicts > 0 && (
              <>
                {" · "}
                <strong style={{ color: colors.accent2 }}>
                  {summary.conflicts} conflict{summary.conflicts === 1 ? "" : "s"}
                </strong>
              </>
            )}
            {preview.bundle.assets && preview.bundle.assets.length > 0 && (
              <> · {preview.bundle.assets.length} assets (always copied)</>
            )}
          </span>
          <span style={{ display: "flex", gap: 6 }}>
            <Button size="sm" variant="ghost" onClick={() => setAll("save")}>
              Replace all
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAll("skip")}>
              Skip all
            </Button>
          </span>
        </div>
      )}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          maxHeight: 360,
          overflowY: "auto",
        }}
      >
        {preview.rows.map((row, i) => (
          <div
            key={`${row.kind}:${row.id}`}
            style={{
              border: "1px solid var(--border)",
              borderRadius: 4,
              fontSize: 12,
              background: row.conflict ? "var(--panel-2)" : "transparent",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 8px",
              }}
            >
              <span
                style={{
                  width: 70,
                  color: colors.textDim,
                  textTransform: "uppercase",
                  fontSize: 10,
                  letterSpacing: 0.5,
                }}
              >
                {row.kind}
              </span>
              <span style={{ flex: 1, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                {row.label}
                {row.conflict && <ConflictBadge diff={row.diff} />}
                {row.conflict && Array.isArray(row.diff) && row.diff.length > 0 && (
                  <button
                    type="button"
                    onClick={() => toggleExpand(i)}
                    style={{
                      background: "transparent",
                      border: "none",
                      color: colors.textDim,
                      cursor: "pointer",
                      fontSize: 11,
                      padding: 0,
                    }}
                  >
                    {row.expanded ? "▼ hide" : "▶ show diff"}
                  </button>
                )}
              </span>
              <span style={{ display: "flex", gap: 4 }}>
                <Button
                  size="sm"
                  variant={row.decision === "skip" ? "primary" : "ghost"}
                  onClick={() => setDecision(i, "skip")}
                  style={{ width: 56 }}
                >
                  Skip
                </Button>
                <Button
                  size="sm"
                  variant={row.decision === "save" ? "primary" : "ghost"}
                  onClick={() => setDecision(i, "save")}
                  style={{ width: 70 }}
                >
                  {row.conflict ? "Replace" : "Save"}
                </Button>
              </span>
            </div>
            {row.expanded && Array.isArray(row.diff) && row.diff.length > 0 && (
              <div
                style={{
                  borderTop: "1px solid var(--border)",
                  padding: "6px 8px 8px",
                  fontFamily: "monospace",
                  fontSize: 11,
                  display: "flex",
                  flexDirection: "column",
                  gap: 4,
                }}
              >
                {row.diff.map((d) => (
                  <div key={d.key} style={{ display: "flex", gap: 6 }}>
                    <span style={{ width: 100, color: colors.textDim }}>{d.key}</span>
                    <span style={{ flex: 1, color: colors.red }}>{d.beforeSummary}</span>
                    <span style={{ color: colors.textDim }}>→</span>
                    <span style={{ flex: 1, color: colors.green ?? colors.accent2 }}>{d.afterSummary}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {submitError && (
        <p style={{ color: colors.red, fontSize: 12, marginTop: 10 }}>
          {submitError}
        </p>
      )}
    </Modal>
  );
}

// ─── helpers ──────────────────────────────────────────────────────────────

function buildPreview(
  bundle: Bundle,
  existing: {
    songs: string[];
    templates: string[];
    shows: string[];
    hotcards: string[];
    projects: string[];
  },
): PreviewState {
  const songSet = new Set(existing.songs);
  const tplSet = new Set(existing.templates);
  const showSet = new Set(existing.shows);
  const hotSet = new Set(existing.hotcards);
  const rows: ItemRow[] = [
    ...bundle.songs.map<ItemRow>((s) => rowFor("song", s, s.title, songSet)),
    ...bundle.templates.map<ItemRow>((t) =>
      rowFor("template", t, t.name, tplSet),
    ),
    ...bundle.hotcards.map<ItemRow>((h) =>
      rowFor("hotcard", h, h.name, hotSet),
    ),
    ...bundle.shows.map<ItemRow>((s) => rowFor("show", s, s.name, showSet)),
  ];
  return { bundle, rows };
}

function rowFor(
  kind: ItemKind,
  item: { id: string },
  label: string,
  existing: Set<string>,
): ItemRow {
  const conflict = existing.has(item.id);
  return {
    kind,
    id: item.id,
    label: label || item.id,
    conflict,
    decision: conflict ? "skip" : "save",
  };
}

function filterBundleByDecisions(bundle: Bundle, rows: ItemRow[]): {
  songs: Song[];
  templates: Template[];
  shows: Show[];
  hotcards: Hotcard[];
} {
  const savedIds = (kind: ItemKind) =>
    new Set(rows.filter((r) => r.kind === kind && r.decision === "save").map((r) => r.id));
  const songIds = savedIds("song");
  const tplIds = savedIds("template");
  const showIds = savedIds("show");
  const hotIds = savedIds("hotcard");
  return {
    songs: bundle.songs.filter((s) => songIds.has(s.id)),
    templates: bundle.templates.filter((t) => tplIds.has(t.id)),
    shows: bundle.shows.filter((s) => showIds.has(s.id)),
    hotcards: bundle.hotcards.filter((h) => hotIds.has(h.id)),
  };
}

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

// ─── conflict resolution helpers ──────────────────────────────────────────

function ConflictBadge({ diff }: { diff: FieldDiff[] | null | undefined }) {
  if (diff === undefined) {
    return (
      <span
        style={{
          color: colors.accent2,
          fontSize: 10,
          fontWeight: 600,
        }}
      >
        ⚠ already local
      </span>
    );
  }
  if (diff === null) {
    return (
      <span
        style={{ color: colors.textDim, fontSize: 10 }}
      >
        comparing…
      </span>
    );
  }
  if (diff.length === 0) {
    return (
      <span
        style={{ color: colors.textDim, fontSize: 10, fontWeight: 600 }}
      >
        ✓ identical
      </span>
    );
  }
  return (
    <span
      style={{ color: colors.accent2, fontSize: 10, fontWeight: 600 }}
    >
      ⚠ {diff.length} field{diff.length === 1 ? "" : "s"} differ
    </span>
  );
}

function sameDiff(a: FieldDiff[] | null, b: FieldDiff[]): boolean {
  if (!Array.isArray(a)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    if (x.key !== y.key || x.beforeSummary !== y.beforeSummary || x.afterSummary !== y.afterSummary) {
      return false;
    }
  }
  return true;
}

function cacheHas(
  row: ItemRow,
  songCache: Record<string, Song>,
  templateCache: Record<string, Template>,
  showCache: Record<string, Show>,
  hotcardCache: Record<string, Hotcard>,
): boolean {
  switch (row.kind) {
    case "song":
      return !!songCache[row.id];
    case "template":
      return !!templateCache[row.id];
    case "show":
      return !!showCache[row.id];
    case "hotcard":
      return !!hotcardCache[row.id];
  }
}

function lookupLocal(
  row: ItemRow,
  songCache: Record<string, Song>,
  templateCache: Record<string, Template>,
  showCache: Record<string, Show>,
  hotcardCache: Record<string, Hotcard>,
): unknown {
  switch (row.kind) {
    case "song":
      return songCache[row.id];
    case "template":
      return templateCache[row.id];
    case "show":
      return showCache[row.id];
    case "hotcard":
      return hotcardCache[row.id];
  }
}

function lookupCloud(row: ItemRow, bundle: Bundle): unknown {
  switch (row.kind) {
    case "song":
      return bundle.songs.find((s) => s.id === row.id);
    case "template":
      return bundle.templates.find((t) => t.id === row.id);
    case "show":
      return bundle.shows.find((s) => s.id === row.id);
    case "hotcard":
      return bundle.hotcards.find((h) => h.id === row.id);
  }
}

function sendGet(
  send: (msg: import("@overlaysys/ws-protocol").ClientMessage) => void,
  row: ItemRow,
): void {
  switch (row.kind) {
    case "song":
      return send({ type: "get_song", songId: row.id });
    case "template":
      return send({ type: "get_template", templateId: row.id });
    case "show":
      return send({ type: "get_show", showId: row.id });
    case "hotcard":
      return send({ type: "get_hotcard", hotcardId: row.id });
  }
}
