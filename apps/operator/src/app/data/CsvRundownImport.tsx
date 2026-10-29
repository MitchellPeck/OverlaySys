"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { v4 as uuid } from "uuid";
import type { Show } from "@overlaysys/core";
import { Button, Field, FileDrop, Input, Panel, colors, useToast } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";
import { isCloudMode } from "@/lib/mode";
import { httpBase } from "@/lib/pcoClient";
import { applyBundleCloud, getTemplateCloud, refreshShowMetasCloud } from "@/lib/cloudData";
import { EXAMPLE_CSV, parseCsvText, recordsToRows, type CsvParseError } from "@/lib/csv";
import { downloadText } from "@/lib/download";

/**
 * CSV → new show of graphic rows. The first row is a header: a `template`
 * column (template name or id), optional `notes`, and one column per
 * template field (field key or label). Rows that can't be imported are
 * listed with the reason before anything is saved.
 */
export function CsvRundownImport() {
  const router = useRouter();
  const { send } = useWs();
  const templates = useStore((s) => s.templates);
  const templateCache = useStore((s) => s.templateCache);
  const setTemplate = useStore((s) => s.setTemplate);
  const currentProjectId = useStore((s) => s.currentProjectId);
  const conn = useStore((s) => s.conn);
  const projects = useStore((s) => s.projects);
  const toast = useToast();
  const cloud = isCloudMode();

  const [file, setFile] = useState<File | null>(null);
  const [lines, setLines] = useState<number[]>([]);
  const [records, setRecords] = useState<Record<string, string>[] | null>(null);
  const [parseErrors, setParseErrors] = useState<CsvParseError[]>([]);
  const [showName, setShowName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdShowId, setCreatedShowId] = useState<string | null>(null);

  const preview = useMemo(
    () => (records ? recordsToRows(records, templates, (id) => templateCache[id]?.fields, undefined, lines) : null),
    [records, lines, templates, templateCache],
  );

  // Fetch full templates used by the CSV so field labels can be matched.
  useEffect(() => {
    if (!preview) return;
    const ids = new Set(preview.rows.map((r) => r.templateId));
    for (const id of ids) {
      if (templateCache[id]) continue;
      if (cloud) {
        void getTemplateCloud(id)
          .then((t) => t && setTemplate(t))
          .catch(() => undefined);
      } else if (conn === "open") {
        send({ type: "get_template", templateId: id });
      }
    }
  }, [preview, templateCache, cloud, conn, send, setTemplate]);

  async function readFile(f: File) {
    setFile(f);
    setError(null);
    setCreatedShowId(null);
    const parsed = parseCsvText(await f.text(), { required: ["template"] });
    setRecords(parsed.records);
    setLines(parsed.lines);
    setParseErrors([...parsed.errors, ...parsed.warnings]);
    setShowName(f.name.replace(/\.[^.]+$/, ""));
  }

  function clearFile() {
    setFile(null);
    setRecords(null);
    setLines([]);
    setParseErrors([]);
    setCreatedShowId(null);
    setError(null);
  }

  async function createShow() {
    if (!preview || preview.rows.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    const show: Show = {
      id: `show-${uuid().slice(0, 8)}`,
      name: showName.trim() || "Imported rundown",
      projectId: currentProjectId,
      rows: preview.rows,
      songs: [],
    };
    try {
      if (cloud) {
        const res = await applyBundleCloud({
          format: "overlaysys-bundle",
          version: 1,
          exportedAt: new Date().toISOString(),
          templates: [],
          songs: [],
          hotcards: [],
          shows: [show],
          channels: [],
          channelOverrides: [],
          assets: [],
        });
        if (res.errors.length) throw new Error(res.errors.map((e) => e.message).join("; "));
        await refreshShowMetasCloud();
      } else {
        const res = await fetch(`${httpBase()}/api/import`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ shows: [show] }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => res.statusText)}`);
        const body = (await res.json()) as { errors?: { message: string }[] };
        if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join("; "));
      }
      setCreatedShowId(show.id);
      toast({ tone: "ok", message: `Created ${show.name}` });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const templateName = (id: string) => templates.find((t) => t.id === id)?.name ?? "Unknown template";
  const projectLabel = projects.find((p) => p.id === currentProjectId)?.name ?? "the current project";

  return (
    <Panel title="Import rundown from CSV" padding="md" style={{ marginBottom: 24 }}>
      <FileDrop
        accept=".csv,text/csv"
        hint={
          <>
            Creates a show in {projectLabel}. One row per graphic: a <code>template</code> column (design name),
            optional <code>notes</code>, and one column per field.{" "}
            <Button size="sm" variant="ghost" onClick={() => downloadText("example-rundown.csv", EXAMPLE_CSV, "text/csv")}>
              Download example
            </Button>
          </>
        }
        file={file}
        onFile={(f) => void readFile(f)}
        onClear={clearFile}
      />

      {parseErrors.length > 0 && (
        <ul role="alert" style={{ fontSize: 12, color: colors.warn, margin: "8px 0", paddingLeft: 16 }}>
          {parseErrors.slice(0, 8).map((e, i) => (
            <li key={i}>Line {e.line}: {e.message}</li>
          ))}
          {parseErrors.length > 8 && <li>…and {parseErrors.length - 8} more</li>}
        </ul>
      )}

      {preview && !createdShowId && (
        <>
          <div
            style={{
              margin: "8px 0",
              maxHeight: 280,
              overflow: "auto",
              border: `1px solid ${colors.border}`,
              borderRadius: 4,
              fontSize: 12,
            }}
          >
            {preview.rows.length === 0 ? (
              <p style={{ padding: 8, margin: 0, color: colors.textDim }}>No importable rows.</p>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ textAlign: "left", color: colors.textDim }}>
                    <th style={{ padding: "4px 6px" }}>#</th>
                    <th style={{ padding: "4px 6px" }}>Template</th>
                    <th style={{ padding: "4px 6px" }}>Fields</th>
                    <th style={{ padding: "4px 6px" }}>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((r, i) => (
                    <tr key={r.id} style={{ borderTop: `1px solid ${colors.border}` }}>
                      <td style={{ padding: "4px 6px", color: colors.textDim }}>{i + 1}</td>
                      <td style={{ padding: "4px 6px" }}>{templateName(r.templateId)}</td>
                      <td style={{ padding: "4px 6px" }}>
                        {Object.entries(r.data).map(([k, v]) => `${k}: ${v}`).join(" · ") || "—"}
                      </td>
                      <td style={{ padding: "4px 6px", color: colors.textDim }}>{r.notes ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {preview.skipped.length > 0 && (
            <div style={{ fontSize: 12, color: colors.warn, marginBottom: 8 }}>
              Skipping {preview.skipped.length} row{preview.skipped.length === 1 ? "" : "s"}:
              <ul style={{ margin: "4px 0 0", paddingLeft: 16 }}>
                {preview.skipped.slice(0, 10).map((s) => (
                  <li key={s.line}>Line {s.line}: {s.reason}</li>
                ))}
                {preview.skipped.length > 10 && <li>…and {preview.skipped.length - 10} more</li>}
              </ul>
            </div>
          )}
          {Object.entries(preview.unmatchedColumns).map(([id, cols]) => (
            <p key={id} style={{ fontSize: 12, color: colors.textDim, margin: "0 0 8px" }}>
              {templateName(id)} has no field named {cols.map((c) => `“${c}”`).join(", ")} — kept as-is.
            </p>
          ))}
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <Field label="New show name">
              <Input value={showName} onChange={(e) => setShowName(e.target.value)} />
            </Field>
            <Button
              variant="primary"
              size="sm"
              disabled={busy || preview.rows.length === 0 || (!cloud && conn !== "open")}
              onClick={() => void createShow()}
            >
              {busy ? "Creating…" : `Create show with ${preview.rows.length} row${preview.rows.length === 1 ? "" : "s"}`}
            </Button>
          </div>
        </>
      )}

      {error && <p role="alert" style={{ color: colors.errorText, fontSize: 12 }}>{error}</p>}
      {createdShowId && (
        <p style={{ fontSize: 12 }}>
          Show created.{" "}
          <Button
            size="sm"
            onClick={() => router.push(`/shows/edit?id=${encodeURIComponent(createdShowId)}`)}
          >
            Open show
          </Button>
        </p>
      )}
    </Panel>
  );
}
