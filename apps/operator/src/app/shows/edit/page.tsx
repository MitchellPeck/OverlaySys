"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { v4 as uuid } from "uuid";
import { produce } from "immer";
import type { Show, RundownRow, GraphicRow, SongRow, Song, SongMeta, Template, TemplateMeta } from "@overlaysys/core";
import { useWs, getClient } from "@/lib/useWs";
import { useStore } from "@/lib/store";
import { FieldInput } from "@/lib/FieldInput";
import { useDialog } from "@/lib/dialog";
import { AppHeader } from "@/app/components/AppHeader";

// Suspense wrapper required by Next.js static export when the page calls
// useSearchParams() — the inner page reads ?id= and renders.
export default function ShowEditPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24 }}>Loading…</div>}>
      <ShowEditPageInner />
    </Suspense>
  );
}

function ShowEditPageInner() {
  // Static-export-friendly: id comes from ?id=… query string.
  const searchParams = useSearchParams();
  const showId = decodeURIComponent(searchParams?.get("id") ?? "");
  const { send } = useWs();
  const router = useRouter();
  const conn = useStore((s) => s.conn);
  const templates = useStore((s) => s.templates);
  const songs = useStore((s) => s.songs);
  const songCache = useStore((s) => s.songCache);

  const templateCache = useStore((s) => s.templateCache);
  const [draft, setDraft] = useState<Show | null>(null);
  const [dirty, setDirty] = useState(false);
  const [dragRowId, setDragRowId] = useState<string | null>(null);
  const fetchedRef = useRef<string | null>(null);
  const { confirm, alert, dialog } = useDialog();

  // Listen for show messages.
  useEffect(() => {
    fetchedRef.current = null;
    setDraft(null);
    setDirty(false);
    const off = getClient().on((msg) => {
      if (msg.type === "show" && msg.show.id === showId) {
        if (!dirty) setDraft(msg.show);
      }
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showId]);

  // Fetch only when WS is open.
  useEffect(() => {
    if (conn !== "open") return;
    if (fetchedRef.current === showId) return;
    fetchedRef.current = showId;
    send({ type: "get_show", showId });
    send({ type: "list_templates" });
    send({ type: "list_songs" });
  }, [conn, showId, send]);

  // For each unique templateId in the rundown, request its full template
  // so the field inputs know what to display. Cached in the global store
  // so other panels (TakePanel, etc.) reuse what we fetch here. Songs use
  // a different mechanism (lyricTemplateId) so we ignore them here.
  useEffect(() => {
    if (!draft) return;
    const needed = new Set(
      draft.rows.flatMap((r) => (r.kind === "graphic" ? [r.templateId] : [])),
    );
    for (const id of needed) {
      if (!templateCache[id] && conn === "open") {
        send({ type: "get_template", templateId: id });
      }
    }
  }, [draft, templateCache, conn, send]);

  // For each song row, request the full Song if not yet cached.
  useEffect(() => {
    if (!draft) return;
    const needed = new Set(
      draft.rows.flatMap((r) => (r.kind === "song" ? [r.songId] : [])),
    );
    for (const id of needed) {
      if (!songCache[id] && conn === "open") {
        send({ type: "get_song", songId: id });
      }
    }
  }, [draft, songCache, conn, send]);

  function update(recipe: (s: Show) => void) {
    setDraft((cur) => {
      if (!cur) return cur;
      const next = produce(cur, recipe);
      if (next === cur) return cur;
      setDirty(true);
      return next;
    });
  }

  function save() {
    if (!draft) return;
    send({ type: "save_show", show: draft });
    setDirty(false);
  }

  function revert() {
    fetchedRef.current = null;
    setDraft(null);
    setDirty(false);
    send({ type: "get_show", showId });
  }

  async function remove() {
    if (!draft) return;
    const ok = await confirm({
      title: "Delete show",
      message: (
        <>
          Delete <strong>{draft.name}</strong>?
        </>
      ),
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    send({ type: "delete_show", showId: draft.id });
    setTimeout(() => router.push("/shows"), 150);
  }

  function addRow() {
    update((s) => {
      const firstTpl = templates[0]?.id ?? "";
      s.rows.push({ kind: "graphic", id: uuid(), templateId: firstTpl, data: {} });
    });
  }

  function addSongRow() {
    const firstSong = songs[0];
    if (!firstSong) {
      void alert({
        title: "No songs yet",
        message: "No songs in library yet. Create one in Songs first.",
      });
      return;
    }
    update((s) => {
      const cachedSong = songCache[firstSong.id];
      const lyricTemplateId =
        cachedSong?.defaultLyricTemplateId ??
        templates[0]?.id ??
        "";
      s.rows.push({
        kind: "song",
        id: uuid(),
        songId: firstSong.id,
        lyricTemplateId,
      });
    });
  }

  function deleteRow(rowId: string) {
    update((s) => {
      s.rows = s.rows.filter((r) => r.id !== rowId);
    });
  }

  function moveRow(sourceId: string, targetId: string, where: "before" | "after") {
    if (sourceId === targetId) return;
    update((s) => {
      const src = s.rows.findIndex((r) => r.id === sourceId);
      const tgt = s.rows.findIndex((r) => r.id === targetId);
      if (src === -1 || tgt === -1) return;
      const [row] = s.rows.splice(src, 1);
      const adjustedTgt = src < tgt ? tgt - 1 : tgt;
      const insertIdx = where === "before" ? adjustedTgt : adjustedTgt + 1;
      s.rows.splice(insertIdx, 0, row!);
    });
  }

  // Save on Cmd/Ctrl+S.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.code === "KeyS") {
        e.preventDefault();
        save();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  if (!draft) {
    return (
      <>
        <AppHeader />
        <main style={{ padding: 24 }}>
          <p style={{ color: "var(--text-dim)", marginTop: 12 }}>
            Loading show <code>{showId}</code>…
          </p>
        </main>
      </>
    );
  }

  return (
    <main
      style={{
        position: "fixed",
        inset: 0,
        display: "grid",
        gridTemplateRows: "auto minmax(0, 1fr)",
        overflow: "hidden",
      }}
    >
      <AppHeader
        context={
          <>
            <input
              value={draft.name}
              onChange={(e) => update((s) => { s.name = e.target.value; })}
              style={{
                background: "transparent",
                border: "1px solid transparent",
                color: "var(--text)",
                fontSize: 15,
                fontWeight: 600,
                padding: "2px 6px",
                borderRadius: 4,
                minWidth: 200,
              }}
            />
            <span style={{ color: "var(--text-dim)", fontSize: 11 }}>{draft.id}</span>
            <span style={{ color: "var(--text-dim)", fontSize: 11 }}>· {draft.rows.length} rows</span>
            {dirty && <span style={{ color: "var(--accent-2)", fontSize: 11, fontWeight: 600 }}>● unsaved</span>}
          </>
        }
        actions={
          <>
            <button onClick={remove} style={dangerBtn}>Delete</button>
            <button onClick={revert} style={ghostBtn} disabled={!dirty}>Revert</button>
            <button onClick={save} style={primaryBtn} disabled={!dirty || conn !== "open"}>
              Save (⌘S)
            </button>
          </>
        }
      />

      <div style={{ overflow: "auto", padding: "16px 24px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <RundownTable
            draft={draft}
            templates={templates}
            templateCache={templateCache}
            songs={songs}
            songCache={songCache}
            dragRowId={dragRowId}
            onDragRowId={setDragRowId}
            onMoveRow={moveRow}
            onUpdate={update}
            onDeleteRow={deleteRow}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={addRow} style={addRowBtn}>+ Add row</button>
            <button onClick={addSongRow} style={addRowBtn}>+ Add song</button>
          </div>
        </div>
      </div>
      {dialog}
    </main>
  );
}

function RundownTable({
  draft,
  templates,
  templateCache,
  songs,
  songCache,
  dragRowId,
  onDragRowId,
  onMoveRow,
  onUpdate,
  onDeleteRow,
}: {
  draft: Show;
  templates: TemplateMeta[];
  templateCache: Record<string, Template>;
  songs: SongMeta[];
  songCache: Record<string, Song>;
  dragRowId: string | null;
  onDragRowId: (id: string | null) => void;
  onMoveRow: (sourceId: string, targetId: string, where: "before" | "after") => void;
  onUpdate: (recipe: (s: Show) => void) => void;
  onDeleteRow: (id: string) => void;
}) {
  if (draft.rows.length === 0) {
    return (
      <p style={{ color: "var(--text-dim)", fontSize: 13, padding: 24, textAlign: "center" }}>
        No rows yet. Click <strong>+ Add row</strong> below to start building the rundown.
      </p>
    );
  }

  return (
    <table
      style={{
        width: "100%",
        borderCollapse: "separate",
        borderSpacing: 0,
        fontSize: 13,
      }}
    >
      <thead>
        <tr style={{ color: "var(--text-dim)", textAlign: "left" }}>
          <th style={th}>#</th>
          <th style={th}>Template</th>
          <th style={th}>Fields</th>
          <th style={th}>Channel</th>
          <th style={th}>Notes</th>
          <th style={th}></th>
        </tr>
      </thead>
      <tbody>
        {draft.rows.map((row, i) => {
          const dragProps = {
            index: i,
            isDragging: dragRowId === row.id,
            onDragStart: () => onDragRowId(row.id),
            onDragEnd: () => onDragRowId(null),
            onDropBefore: (sourceId: string) => onMoveRow(sourceId, row.id, "before"),
            onDropAfter: (sourceId: string) => onMoveRow(sourceId, row.id, "after"),
            onDelete: () => onDeleteRow(row.id),
          };
          if (row.kind === "song") {
            return (
              <SongRowEditor
                key={row.id}
                row={row}
                songs={songs}
                songCache={songCache}
                templates={templates}
                onUpdate={onUpdate}
                {...dragProps}
              />
            );
          }
          return (
            <RundownRowEditor
              key={row.id}
              row={row}
              templates={templates}
              template={templateCache[row.templateId] ?? null}
              onUpdate={onUpdate}
              {...dragProps}
            />
          );
        })}
      </tbody>
    </table>
  );
}

function RundownRowEditor({
  row,
  index,
  templates,
  template,
  isDragging,
  onDragStart,
  onDragEnd,
  onDropBefore,
  onDropAfter,
  onUpdate,
  onDelete,
}: {
  row: GraphicRow;
  index: number;
  templates: TemplateMeta[];
  template: Template | null;
  isDragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDropBefore: (sourceId: string) => void;
  onDropAfter: (sourceId: string) => void;
  onUpdate: (recipe: (s: Show) => void) => void;
  onDelete: () => void;
}) {
  const [dropZone, setDropZone] = useState<"before" | "after" | null>(null);

  function patchRow(patch: Partial<GraphicRow>) {
    onUpdate((s) => {
      const r = s.rows.find((r) => r.id === row.id);
      if (!r || r.kind !== "graphic") return;
      Object.assign(r, patch);
    });
  }
  function setData(key: string, value: string) {
    onUpdate((s) => {
      const r = s.rows.find((r) => r.id === row.id);
      if (!r || r.kind !== "graphic") return;
      r.data = { ...r.data, [key]: value };
    });
  }

  return (
    <tr
      draggable
      onDragStart={(e) => {
        onDragStart();
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", row.id);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setDropZone(e.clientY < r.top + r.height / 2 ? "before" : "after");
      }}
      onDragLeave={() => setDropZone(null)}
      onDrop={(e) => {
        e.preventDefault();
        const sourceId = e.dataTransfer.getData("text/plain");
        const z = dropZone;
        setDropZone(null);
        if (!sourceId || !z) return;
        if (z === "before") onDropBefore(sourceId);
        else onDropAfter(sourceId);
      }}
      onDragEnd={onDragEnd}
      style={{
        opacity: isDragging ? 0.5 : 1,
        borderTop: dropZone === "before" ? "2px solid #4ade80" : "1px solid transparent",
        borderBottom: dropZone === "after" ? "2px solid #4ade80" : "1px solid var(--border)",
      }}
    >
      <td style={{ ...td, width: 30, textAlign: "center", color: "var(--text-dim)", cursor: "grab" }}>
        {index + 1}
      </td>
      <td style={{ ...td, width: 220 }}>
        <select
          value={row.templateId}
          onChange={(e) => patchRow({ templateId: e.target.value })}
          style={input}
        >
          {!templates.some((t) => t.id === row.templateId) && (
            <option value={row.templateId}>{row.templateId} (missing)</option>
          )}
          {templates.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </td>
      <td style={{ ...td, minWidth: 320 }}>
        <FieldsEditor template={template} data={row.data} onChange={setData} />
      </td>
      <td style={{ ...td, width: 100 }}>
        <select
          value={row.channelHint ?? ""}
          onChange={(e) =>
            patchRow({ channelHint: e.target.value ? e.target.value : undefined })
          }
          style={input}
        >
          <option value="">(any)</option>
          <option value="program">program</option>
          <option value="preview">preview</option>
        </select>
      </td>
      <td style={{ ...td, width: 200 }}>
        <input
          value={row.notes ?? ""}
          onChange={(e) => patchRow({ notes: e.target.value || undefined })}
          placeholder="—"
          style={input}
        />
      </td>
      <td style={{ ...td, width: 36, textAlign: "center" }}>
        <button onClick={onDelete} title="Delete row" style={tinyDelBtn}>×</button>
      </td>
    </tr>
  );
}

function SongRowEditor({
  row,
  index,
  songs,
  songCache,
  templates,
  isDragging,
  onDragStart,
  onDragEnd,
  onDropBefore,
  onDropAfter,
  onUpdate,
  onDelete,
}: {
  row: SongRow;
  index: number;
  songs: SongMeta[];
  songCache: Record<string, Song>;
  templates: TemplateMeta[];
  isDragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDropBefore: (sourceId: string) => void;
  onDropAfter: (sourceId: string) => void;
  onUpdate: (recipe: (s: Show) => void) => void;
  onDelete: () => void;
}) {
  const [dropZone, setDropZone] = useState<"before" | "after" | null>(null);

  function patchRow(patch: Partial<SongRow>) {
    onUpdate((s) => {
      const r = s.rows.find((r) => r.id === row.id);
      if (!r || r.kind !== "song") return;
      Object.assign(r, patch);
    });
  }

  function pickSong(songId: string) {
    const cached = songCache[songId];
    const defaultTpl = cached?.defaultLyricTemplateId;
    onUpdate((s) => {
      const r = s.rows.find((r) => r.id === row.id);
      if (!r || r.kind !== "song") return;
      r.songId = songId;
      if (defaultTpl) r.lyricTemplateId = defaultTpl;
    });
  }

  const songMeta = songs.find((s) => s.id === row.songId);

  return (
    <tr
      draggable
      onDragStart={(e) => {
        onDragStart();
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", row.id);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setDropZone(e.clientY < r.top + r.height / 2 ? "before" : "after");
      }}
      onDragLeave={() => setDropZone(null)}
      onDrop={(e) => {
        e.preventDefault();
        const sourceId = e.dataTransfer.getData("text/plain");
        const z = dropZone;
        setDropZone(null);
        if (!sourceId || !z) return;
        if (z === "before") onDropBefore(sourceId);
        else onDropAfter(sourceId);
      }}
      onDragEnd={onDragEnd}
      style={{
        opacity: isDragging ? 0.5 : 1,
        borderTop: dropZone === "before" ? "2px solid #4ade80" : "1px solid transparent",
        borderBottom: dropZone === "after" ? "2px solid #4ade80" : "1px solid var(--border)",
        background: "rgba(255, 177, 58, 0.06)",
      }}
    >
      <td style={{ ...td, width: 30, textAlign: "center", color: "var(--text-dim)", cursor: "grab" }}>
        {index + 1}
      </td>
      <td style={{ ...td, width: 220 }}>
        <select value={row.songId} onChange={(e) => pickSong(e.target.value)} style={input}>
          {!songs.some((s) => s.id === row.songId) && (
            <option value={row.songId}>{row.songId} (missing)</option>
          )}
          {songs.map((s) => (
            <option key={s.id} value={s.id}>♪ {s.title}</option>
          ))}
        </select>
        {songMeta && (
          <div style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "ui-monospace, monospace", marginTop: 2 }}>
            {songMeta.id}
          </div>
        )}
      </td>
      <td style={{ ...td, minWidth: 320 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ width: 60, fontSize: 11, color: "var(--text-dim)", flexShrink: 0 }}>template</span>
          <select
            value={row.lyricTemplateId}
            onChange={(e) => patchRow({ lyricTemplateId: e.target.value })}
            style={{ ...input, flex: 1 }}
          >
            {!templates.some((t) => t.id === row.lyricTemplateId) && (
              <option value={row.lyricTemplateId}>{row.lyricTemplateId} (missing)</option>
            )}
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </div>
        {row.arrangement && row.arrangement.length > 0 && (
          <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4 }}>
            arrangement override: {row.arrangement.join(" → ")}
          </div>
        )}
      </td>
      <td style={{ ...td, width: 100 }}>
        <select
          value={row.channelHint ?? ""}
          onChange={(e) => patchRow({ channelHint: e.target.value ? e.target.value : undefined })}
          style={input}
        >
          <option value="">(any)</option>
          <option value="program">program</option>
          <option value="preview">preview</option>
        </select>
      </td>
      <td style={{ ...td, width: 200 }}>
        <input
          value={row.notes ?? ""}
          onChange={(e) => patchRow({ notes: e.target.value || undefined })}
          placeholder="—"
          style={input}
        />
      </td>
      <td style={{ ...td, width: 36, textAlign: "center" }}>
        <button onClick={onDelete} title="Delete row" style={tinyDelBtn}>×</button>
      </td>
    </tr>
  );
}

function FieldsEditor({
  template,
  data,
  onChange,
}: {
  template: Template | null;
  data: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  const declaredKeys = useMemo(
    () => template?.fields.map((f) => f.key) ?? [],
    [template],
  );
  const orphanKeys = Object.keys(data).filter((k) => !declaredKeys.includes(k));
  const fieldsToShow = template?.fields ?? [];

  if (!template) {
    return (
      <span style={{ color: "var(--text-dim)", fontSize: 11 }}>
        Loading template…
      </span>
    );
  }

  if (fieldsToShow.length === 0 && orphanKeys.length === 0) {
    return (
      <span style={{ color: "var(--text-dim)", fontSize: 11 }}>
        Template declares no fields.
      </span>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {fieldsToShow.map((f) => (
        <div key={f.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 90, fontSize: 11, color: "var(--text-dim)", flexShrink: 0 }}>
            {f.label}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <FieldInput field={f} value={data[f.key]} onChange={(v) => onChange(f.key, v)} />
          </div>
        </div>
      ))}
      {orphanKeys.map((k) => (
        <div key={k} style={{ display: "flex", alignItems: "center", gap: 6, opacity: 0.7 }}>
          <span
            style={{ width: 90, fontSize: 11, color: "var(--accent-2)", flexShrink: 0 }}
            title="Not declared by the template — will still be sent on take. Edit the template's Fields panel to declare it."
          >
            {k}*
          </span>
          <input
            value={data[k] ?? ""}
            onChange={(e) => onChange(k, e.target.value)}
            style={input}
          />
        </div>
      ))}
    </div>
  );
}

const th: React.CSSProperties = {
  padding: "8px 8px",
  borderBottom: "1px solid var(--border)",
  fontWeight: 500,
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: 1.2,
};
const td: React.CSSProperties = {
  padding: "8px",
  verticalAlign: "top",
};
const input: React.CSSProperties = {
  width: "100%",
  padding: "4px 8px",
  background: "var(--panel-2)",
  border: "1px solid var(--border)",
  borderRadius: 3,
  color: "var(--text)",
  fontSize: 12,
  outline: "none",
};
const primaryBtn: React.CSSProperties = {
  padding: "6px 14px",
  background: "var(--accent)",
  color: "#fff",
  border: "none",
  borderRadius: 4,
  fontWeight: 600,
  fontSize: 12,
  cursor: "pointer",
};
const ghostBtn: React.CSSProperties = {
  padding: "6px 12px",
  background: "transparent",
  color: "var(--text)",
  border: "1px solid var(--border)",
  borderRadius: 4,
  fontWeight: 600,
  fontSize: 12,
  cursor: "pointer",
};
const dangerBtn: React.CSSProperties = {
  ...ghostBtn,
  color: "var(--red)",
  borderColor: "var(--red)",
};
const addRowBtn: React.CSSProperties = {
  marginTop: 12,
  padding: "10px 16px",
  background: "var(--panel)",
  color: "var(--text)",
  border: "1px dashed var(--border)",
  borderRadius: 4,
  fontWeight: 600,
  fontSize: 12,
  cursor: "pointer",
  width: "100%",
};
const tinyDelBtn: React.CSSProperties = {
  width: 24,
  height: 24,
  background: "transparent",
  color: "var(--red)",
  border: "1px solid var(--border)",
  borderRadius: 3,
  cursor: "pointer",
  fontSize: 14,
};
