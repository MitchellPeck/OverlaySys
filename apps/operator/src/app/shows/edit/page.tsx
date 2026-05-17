"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { v4 as uuid } from "uuid";
import { produce } from "immer";
import type { ChannelConfig, Show, RundownRow, GraphicRow, ScriptureRow, SongRow, ShowSong, Song, SongMeta, Template, TemplateMeta } from "@overlaysys/core";
import { Button, IconButton, Input, Select, colors } from "@overlaysys/ui";
import { useWs, getClient } from "@/lib/useWs";
import { useStore } from "@/lib/store";
import { FieldInput } from "@/lib/FieldInput";
import { useDialog } from "@/lib/dialog";
import { AppHeader } from "@/app/components/AppHeader";
import { PageShell, PageBody } from "@/app/components/PageShell";
import { isCloudMode } from "@/lib/mode";
import { SongsInShowPanel } from "./SongsInShowPanel";
import { ScriptureRowModal, type SaveArgs as ScriptureSaveArgs } from "@/app/components/ScriptureRowModal";
import {
  deleteShowCloud,
  getShowCloud,
  getShowUpdatedAtCloud,
  getSongCloud,
  getTemplateCloud,
  refreshShowMetasCloud,
  refreshSongMetasCloud,
  refreshTemplateMetasCloud,
  saveShowCloud,
} from "@/lib/cloudData";

// Suspense wrapper required by Next.js static export when the page calls
// useSearchParams().
export default function ShowEditPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24 }}>Loading…</div>}>
      <ShowEditPageInner />
    </Suspense>
  );
}

function ShowEditPageInner() {
  const searchParams = useSearchParams();
  const showId = decodeURIComponent(searchParams?.get("id") ?? "");
  const { send } = useWs();
  const router = useRouter();
  const conn = useStore((s) => s.conn);
  const templates = useStore((s) => s.templates);
  const songs = useStore((s) => s.songs);
  const songCache = useStore((s) => s.songCache);
  const channelConfigs = useStore((s) => s.channelConfigs);
  // Mirror channels reflect another channel's state; targeting one would be
  // a no-op, so they're hidden from row-level channel hints.
  const takeableChannels = useMemo(
    () => channelConfigs.filter((c) => !c.mirrorOf),
    [channelConfigs],
  );

  const templateCache = useStore((s) => s.templateCache);
  const setTemplate = useStore((s) => s.setTemplate);
  const setSong = useStore((s) => s.setSong);
  const [draft, setDraft] = useState<Show | null>(null);
  const [dirty, setDirty] = useState(false);
  const [dragRowId, setDragRowId] = useState<string | null>(null);
  const [scriptureModalOpen, setScriptureModalOpen] = useState(false);
  // Cloud `updated_at` value at the moment the editor loaded the draft.
  // Used by save() in cloud mode to detect concurrent writes — a newer
  // value in Supabase means another tab/user saved while we were editing.
  const loadedAtRef = useRef<string | null>(null);
  const fetchedRef = useRef<string | null>(null);
  const { confirm, alert, dialog } = useDialog();
  const cloud = isCloudMode();

  async function showCloudError(action: string, err: unknown) {
    const message = err instanceof Error ? err.message : JSON.stringify(err);
    console.warn(`[shows/edit] cloud ${action} failed`, err);
    await alert({
      title: `Cloud ${action} failed`,
      message: (
        <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12, margin: 0 }}>
          {message}
        </pre>
      ),
    });
  }

  useEffect(() => {
    fetchedRef.current = null;
    setDraft(null);
    setDirty(false);
    if (cloud) return; // no WS subscription in cloud mode — see effect below
    const off = getClient().on((msg) => {
      if (msg.type === "show" && msg.show.id === showId) {
        if (!dirty) setDraft(msg.show);
      }
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showId, cloud]);

  useEffect(() => {
    if (cloud) {
      if (fetchedRef.current === showId) return;
      fetchedRef.current = showId;
      // Pull the show + template + song metadata from Supabase. Show
      // payload populates `draft` directly; template/song meta feeds the
      // same store slices the WS path populates so downstream readers
      // don't care which mode we're in.
      Promise.all([
        getShowCloud(showId),
        getShowUpdatedAtCloud(showId),
        refreshTemplateMetasCloud(),
        refreshSongMetasCloud(),
      ])
        .then(([show, updatedAt]) => {
          if (show) setDraft(show);
          loadedAtRef.current = updatedAt;
        })
        .catch((err) => console.warn("[shows/edit] cloud load failed", err));
      return;
    }
    if (conn !== "open") return;
    if (fetchedRef.current === showId) return;
    fetchedRef.current = showId;
    send({ type: "get_show", showId });
    send({ type: "list_templates" });
    send({ type: "list_songs" });
  }, [cloud, conn, showId, send]);

  useEffect(() => {
    if (!draft) return;
    // Hydrate template bodies for: rows that already reference them PLUS
    // every other template in the library. The "every other" pass is what
    // makes addRow's defaultChannel prefill work — without it, Add row
    // picks templates[0] but its body hasn't been fetched, so the
    // defaultChannel hint is silently dropped.
    const needed = new Set<string>(
      draft.rows.flatMap((r) => (r.kind === "graphic" ? [r.templateId] : [])),
    );
    for (const meta of templates) needed.add(meta.id);
    for (const id of needed) {
      if (!id) continue;
      if (templateCache[id]) continue;
      if (cloud) {
        getTemplateCloud(id)
          .then((t) => {
            if (t) setTemplate(t);
          })
          .catch((err) => console.warn(`[shows/edit] template ${id}`, err));
      } else if (conn === "open") {
        send({ type: "get_template", templateId: id });
      }
    }
  }, [draft, templates, templateCache, cloud, conn, send, setTemplate]);

  useEffect(() => {
    if (!draft) return;
    const needed = new Set(
      draft.rows.flatMap((r) => (r.kind === "song" ? [r.songId] : [])),
    );
    for (const id of needed) {
      if (songCache[id]) continue;
      if (cloud) {
        getSongCloud(id)
          .then((s) => {
            if (s) setSong(s);
          })
          .catch((err) => console.warn(`[shows/edit] song ${id}`, err));
      } else if (conn === "open") {
        send({ type: "get_song", songId: id });
      }
    }
  }, [draft, songCache, cloud, conn, send, setSong]);

  function update(recipe: (s: Show) => void) {
    setDraft((cur) => {
      if (!cur) return cur;
      const next = produce(cur, recipe);
      if (next === cur) return cur;
      setDirty(true);
      return next;
    });
  }

  async function save() {
    if (!draft) return;
    if (cloud) {
      try {
        // Conflict detection: compare cloud's current updated_at against
        // the snapshot we loaded with. Newer means somebody else saved
        // in the meantime. Confirm before overwriting.
        if (loadedAtRef.current) {
          const cur = await getShowUpdatedAtCloud(draft.id);
          if (cur && cur > loadedAtRef.current) {
            const ok = await confirm({
              title: "Cloud has newer changes",
              message: (
                <>
                  This show was updated in the cloud after you loaded it. Save
                  anyway and overwrite their changes?
                </>
              ),
              confirmLabel: "Overwrite",
              destructive: true,
            });
            if (!ok) return;
          }
        }
        await saveShowCloud(draft);
        await refreshShowMetasCloud();
        // Refresh the loaded timestamp so subsequent saves don't re-prompt.
        loadedAtRef.current = await getShowUpdatedAtCloud(draft.id);
        setDirty(false);
      } catch (err) {
        await showCloudError("save", err);
      }
      return;
    }
    send({ type: "save_show", show: draft });
    setDirty(false);
  }

  async function revert() {
    fetchedRef.current = null;
    setDraft(null);
    setDirty(false);
    if (cloud) {
      try {
        const show = await getShowCloud(showId);
        if (show) setDraft(show);
      } catch (err) {
        await showCloudError("revert", err);
      }
      return;
    }
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
    if (cloud) {
      try {
        await deleteShowCloud(draft.id);
        await refreshShowMetasCloud();
        router.push("/shows");
      } catch (err) {
        await showCloudError("delete", err);
      }
      return;
    }
    send({ type: "delete_show", showId: draft.id });
    setTimeout(() => router.push("/shows"), 150);
  }

  function addRow() {
    update((s) => {
      const firstMeta = templates[0];
      const firstTpl = firstMeta?.id ?? "";
      // Prefer the meta's defaultChannel (always available from list_templates)
      // and fall back to the cached body. Reading from the meta avoids the
      // race where the operator clicks Add row before the body has loaded.
      const channelHint =
        firstMeta?.defaultChannel || templateCache[firstTpl]?.defaultChannel || undefined;
      s.rows.push({
        kind: "graphic",
        id: uuid(),
        templateId: firstTpl,
        data: {},
        ...(channelHint ? { channelHint } : {}),
      });
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
      // Lyric template cascade: ShowSong override → song default → first template.
      const showSong = s.songs.find((e) => e.songId === firstSong.id);
      const lyricTemplateId =
        showSong?.lyricTemplateId ??
        cachedSong?.defaultLyricTemplateId ??
        templates[0]?.id ??
        "";
      // Auto-add to the Songs panel so the operator can layer show-level
      // overrides without an extra click. Silent — matches the UX agreed in
      // plan review.
      if (!showSong) {
        s.songs.push({ songId: firstSong.id });
      }
      s.rows.push({
        kind: "song",
        id: uuid(),
        songId: firstSong.id,
        lyricTemplateId,
      });
    });
  }

  function addScriptureRow(args: ScriptureSaveArgs) {
    const row: ScriptureRow = {
      kind: "scripture",
      id: uuid(),
      reference: args.reference,
      translation: args.translation,
      attribution: args.attribution,
      slides: args.slides.map((s) => ({ id: s.id, verses: s.verses })),
      templateId: args.templateId,
    };
    update((s) => {
      s.rows.push(row);
    });
    setScriptureModalOpen(false);
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
      <PageShell>
        <AppHeader />
        <PageBody>
          <p style={{ color: colors.textDim, marginTop: 12 }}>
            Loading show <code>{showId}</code>…
          </p>
        </PageBody>
      </PageShell>
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
                color: colors.text,
                fontSize: 15,
                fontWeight: 600,
                padding: "2px 6px",
                borderRadius: 4,
                minWidth: 200,
              }}
            />
            <span style={{ color: colors.textDim, fontSize: 11 }}>{draft.id}</span>
            <span style={{ color: colors.textDim, fontSize: 11 }}>· {draft.rows.length} rows</span>
            {dirty && <span style={{ color: colors.accent2, fontSize: 11, fontWeight: 600 }}>● unsaved</span>}
          </>
        }
        actions={
          <>
            <Button onClick={remove} variant="danger" size="sm">Delete</Button>
            <Button onClick={revert} variant="ghost" size="sm" disabled={!dirty}>Revert</Button>
            <Button
              onClick={save}
              variant="primary"
              size="sm"
              disabled={!dirty || (!cloud && conn !== "open")}
            >
              Save (⌘S)
            </Button>
          </>
        }
      />

      <div style={{ overflow: "auto", padding: "16px 24px" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <SongsInShowPanel
            draft={draft}
            songs={songs}
            songCache={songCache}
            templates={templates}
            templateCache={templateCache}
            channels={takeableChannels}
            onUpdate={update}
          />
          <RundownTable
            draft={draft}
            templates={templates}
            templateCache={templateCache}
            songs={songs}
            songCache={songCache}
            channels={takeableChannels}
            dragRowId={dragRowId}
            onDragRowId={setDragRowId}
            onMoveRow={moveRow}
            onUpdate={update}
            onDeleteRow={deleteRow}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={addRow} style={addRowBtn}>+ Add row</button>
            <button onClick={addSongRow} style={addRowBtn}>+ Add song</button>
            <button onClick={() => setScriptureModalOpen(true)} style={addRowBtn}>+ Scripture</button>
          </div>
        </div>
      </div>
      <ScriptureRowModal
        open={scriptureModalOpen}
        onClose={() => setScriptureModalOpen(false)}
        onSave={addScriptureRow}
      />
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
  channels,
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
  channels: ChannelConfig[];
  dragRowId: string | null;
  onDragRowId: (id: string | null) => void;
  onMoveRow: (sourceId: string, targetId: string, where: "before" | "after") => void;
  onUpdate: (recipe: (s: Show) => void) => void;
  onDeleteRow: (id: string) => void;
}) {
  if (draft.rows.length === 0) {
    return (
      <p style={{ color: colors.textDim, fontSize: 13, padding: 24, textAlign: "center" }}>
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
        <tr style={{ color: colors.textDim, textAlign: "left" }}>
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
            const showSong = draft.songs.find((e) => e.songId === row.songId);
            return (
              <SongRowEditor
                key={row.id}
                row={row}
                showSong={showSong}
                songs={songs}
                songCache={songCache}
                templates={templates}
                channels={channels}
                onUpdate={onUpdate}
                {...dragProps}
              />
            );
          }
          if (row.kind === "scripture") {
            // TODO: wire scripture row in Task E4 / D1 — placeholder for exhaustive switch
            return (
              <tr key={row.id}>
                <td colSpan={10} style={{ padding: "6px 8px", opacity: 0.6 }}>
                  📖 {row.reference} ({row.translation}) — scripture row (editor coming in Task E3)
                </td>
              </tr>
            );
          }
          return (
            <RundownRowEditor
              key={row.id}
              row={row}
              templates={templates}
              template={templateCache[row.templateId] ?? null}
              channels={channels}
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
  channels,
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
  channels: ChannelConfig[];
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
        // 2px borders here are intentional drag indicators, not the standard token.
        borderTop: dropZone === "before" ? `2px solid ${colors.green}` : "1px solid transparent",
        borderBottom: dropZone === "after" ? `2px solid ${colors.green}` : `1px solid ${colors.border}`,
      }}
    >
      <td style={{ ...td, width: 30, textAlign: "center", color: colors.textDim, cursor: "grab" }}>
        {index + 1}
      </td>
      <td style={{ ...td, width: 220 }}>
        <Select
          value={row.templateId}
          onChange={(e) => {
            const nextId = e.target.value;
            // Prefill channelHint from the new template's defaultChannel
            // only when the row has no hint yet — don't clobber a hint the
            // operator deliberately picked.
            const nextMeta = templates.find((t) => t.id === nextId);
            const nextHint =
              row.channelHint ??
              nextMeta?.defaultChannel ??
              undefined;
            patchRow({ templateId: nextId, channelHint: nextHint });
          }}
        >
          {!templates.some((t) => t.id === row.templateId) && (
            <option value={row.templateId}>{row.templateId} (missing)</option>
          )}
          {templates.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </Select>
      </td>
      <td style={{ ...td, minWidth: 320 }}>
        <FieldsEditor template={template} data={row.data} onChange={setData} />
      </td>
      <td style={{ ...td, width: 100 }}>
        <ChannelHintSelect
          value={row.channelHint}
          onChange={(v) => patchRow({ channelHint: v })}
          channels={channels}
        />
      </td>
      <td style={{ ...td, width: 200 }}>
        <Input
          value={row.notes ?? ""}
          onChange={(e) => patchRow({ notes: e.target.value || undefined })}
          placeholder="—"
        />
      </td>
      <td style={{ ...td, width: 36, textAlign: "center" }}>
        <IconButton onClick={onDelete} title="Delete row" size={24} style={{ color: colors.red, fontSize: 14 }}>
          ×
        </IconButton>
      </td>
    </tr>
  );
}

function SongRowEditor({
  row,
  showSong,
  index,
  songs,
  songCache,
  templates,
  channels,
  isDragging,
  onDragStart,
  onDragEnd,
  onDropBefore,
  onDropAfter,
  onUpdate,
  onDelete,
}: {
  row: SongRow;
  showSong: ShowSong | undefined;
  index: number;
  songs: SongMeta[];
  songCache: Record<string, Song>;
  templates: TemplateMeta[];
  channels: ChannelConfig[];
  isDragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDropBefore: (sourceId: string) => void;
  onDropAfter: (sourceId: string) => void;
  onUpdate: (recipe: (s: Show) => void) => void;
  onDelete: () => void;
}) {
  const [dropZone, setDropZone] = useState<"before" | "after" | null>(null);
  // Per-row overrides are collapsed by default — most users won't need them
  // and the row stays compact. Local state per editor instance.
  const [overridesOpen, setOverridesOpen] = useState(false);

  function patchRow(patch: Partial<SongRow>) {
    onUpdate((s) => {
      const r = s.rows.find((r) => r.id === row.id);
      if (!r || r.kind !== "song") return;
      // Build the patched row by applying each entry — explicit `undefined`
      // values clear keys rather than persisting as undefined-in-object, since
      // the schema treats these fields as `.optional()`.
      for (const [key, value] of Object.entries(patch) as Array<
        [keyof SongRow, SongRow[keyof SongRow]]
      >) {
        if (value === undefined) {
          delete (r as Record<string, unknown>)[key as string];
        } else {
          (r as Record<string, unknown>)[key as string] = value;
        }
      }
    });
  }

  function pickSong(songId: string) {
    const cached = songCache[songId];
    onUpdate((s) => {
      const r = s.rows.find((r) => r.id === row.id);
      if (!r || r.kind !== "song") return;
      const changed = r.songId !== songId;
      r.songId = songId;
      // Lyric template cascade mirrors addSongRow:
      // ShowSong.lyricTemplateId → Song.defaultLyricTemplateId → first template.
      const targetShowSong = s.songs.find((e) => e.songId === songId);
      const nextLyricTpl =
        targetShowSong?.lyricTemplateId ??
        cached?.defaultLyricTemplateId ??
        templates[0]?.id;
      if (nextLyricTpl) r.lyricTemplateId = nextLyricTpl;
      // When the songId actually changes, the per-row intro/outro overrides
      // (template ids + field maps + skip flags) belonged to the old song and
      // are almost certainly wrong for the new one (field maps are template-
      // shape-specific). Clear them; the operator can reapply if desired.
      if (changed) {
        delete (r as Record<string, unknown>).introTemplateId;
        delete (r as Record<string, unknown>).introFieldMap;
        delete (r as Record<string, unknown>).outroTemplateId;
        delete (r as Record<string, unknown>).outroFieldMap;
        delete (r as Record<string, unknown>).skipIntro;
        delete (r as Record<string, unknown>).skipOutro;
      }
      // Mirror addSongRow's auto-add behavior — picking a different library
      // song from this row should also register it on the Songs panel so
      // show-level overrides have a place to live.
      if (!s.songs.some((e) => e.songId === songId)) {
        s.songs.push({ songId });
      }
    });
  }

  const songMeta = songs.find((s) => s.id === row.songId);
  // Resolve inherited values for the override visualization. Cascade:
  // row → ShowSong → Song. The label uses the template `name` when known,
  // falling back to the raw id for missing/unloaded entries.
  const cachedSong = songCache[row.songId];
  const inheritedLyricTplId =
    showSong?.lyricTemplateId ?? cachedSong?.defaultLyricTemplateId;
  const inheritedIntroTplId =
    showSong?.introTemplateId ?? cachedSong?.defaultIntroTemplateId;
  const inheritedOutroTplId =
    showSong?.outroTemplateId ?? cachedSong?.defaultOutroTemplateId;
  const inheritedChannel =
    showSong?.channelOverride ?? cachedSong?.defaultChannel;
  function tplName(id: string | undefined): string {
    if (!id) return "(none)";
    return templates.find((t) => t.id === id)?.name ?? id;
  }
  function chanName(id: string | undefined): string {
    if (!id) return "(any)";
    return channels.find((c) => c.id === id)?.name ?? id;
  }

  return (
    <>
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
        borderTop: dropZone === "before" ? `2px solid ${colors.green}` : "1px solid transparent",
        borderBottom: dropZone === "after" ? `2px solid ${colors.green}` : `1px solid ${colors.border}`,
        background: "rgba(255, 177, 58, 0.06)",
      }}
    >
      <td style={{ ...td, width: 30, textAlign: "center", color: colors.textDim, cursor: "grab" }}>
        {index + 1}
      </td>
      <td style={{ ...td, width: 220 }}>
        <Select value={row.songId} onChange={(e) => pickSong(e.target.value)}>
          {!songs.some((s) => s.id === row.songId) && (
            <option value={row.songId}>{row.songId} (missing)</option>
          )}
          {songs.map((s) => (
            <option key={s.id} value={s.id}>♪ {s.title}</option>
          ))}
        </Select>
        {songMeta && (
          <div style={{ fontSize: 10, color: colors.textDim, fontFamily: "ui-monospace, monospace", marginTop: 2 }}>
            {songMeta.id}
          </div>
        )}
      </td>
      <td style={{ ...td, minWidth: 320 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ width: 60, fontSize: 11, color: colors.textDim, flexShrink: 0 }}>template</span>
          <Select
            value={row.lyricTemplateId}
            onChange={(e) => patchRow({ lyricTemplateId: e.target.value })}
            style={{ flex: 1 }}
          >
            {!templates.some((t) => t.id === row.lyricTemplateId) && (
              <option value={row.lyricTemplateId}>{row.lyricTemplateId} (missing)</option>
            )}
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </Select>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 6, fontSize: 11 }}>
          <label style={{ display: "inline-flex", gap: 4, alignItems: "center", cursor: "pointer", color: colors.textDim }}>
            <input
              type="checkbox"
              checked={!!row.skipIntro}
              onChange={(e) => patchRow({ skipIntro: e.target.checked || undefined })}
            />
            Skip intro
          </label>
          <label style={{ display: "inline-flex", gap: 4, alignItems: "center", cursor: "pointer", color: colors.textDim }}>
            <input
              type="checkbox"
              checked={!!row.skipOutro}
              onChange={(e) => patchRow({ skipOutro: e.target.checked || undefined })}
            />
            Skip outro
          </label>
          <button
            type="button"
            onClick={() => setOverridesOpen((v) => !v)}
            style={{
              background: "transparent",
              border: "none",
              color: colors.accent,
              cursor: "pointer",
              padding: 0,
              fontSize: 11,
              textDecoration: "underline",
              marginLeft: "auto",
            }}
            aria-expanded={overridesOpen}
          >
            {overridesOpen ? "▾ Hide overrides" : "▸ Per-row overrides"}
          </button>
        </div>
        {row.arrangement && row.arrangement.length > 0 && (
          <div style={{ fontSize: 11, color: colors.textDim, marginTop: 4 }}>
            arrangement override: {row.arrangement.join(" → ")}
          </div>
        )}
      </td>
      <td style={{ ...td, width: 100 }}>
        <ChannelHintSelect
          value={row.channelHint}
          onChange={(v) => patchRow({ channelHint: v })}
          channels={channels}
          inheritedValue={inheritedChannel}
        />
      </td>
      <td style={{ ...td, width: 200 }}>
        <Input
          value={row.notes ?? ""}
          onChange={(e) => patchRow({ notes: e.target.value || undefined })}
          placeholder="—"
        />
      </td>
      <td style={{ ...td, width: 36, textAlign: "center" }}>
        <IconButton onClick={onDelete} title="Delete row" size={24} style={{ color: colors.red, fontSize: 14 }}>
          ×
        </IconButton>
      </td>
    </tr>
    {overridesOpen && (
      <tr style={{ background: "rgba(255, 177, 58, 0.04)" }}>
        <td colSpan={6} style={{ padding: "8px 16px 12px 48px" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 11 }}>
            <div style={{ color: colors.textDim, marginBottom: 4 }}>
              Per-row overrides — sit on top of any show-level overrides.
            </div>
            <RowOverrideField
              label="Intro template"
              isOverridden={row.introTemplateId !== undefined}
              inheritedLabel={inheritedIntroTplId ? tplName(inheritedIntroTplId) : "(none — skip)"}
              onRevert={() => patchRow({ introTemplateId: undefined, introFieldMap: undefined })}
              onOverride={() =>
                patchRow({
                  introTemplateId: inheritedIntroTplId ?? templates[0]?.id ?? "",
                })
              }
            >
              <RowTemplateSelect
                value={row.introTemplateId}
                templates={templates}
                onChange={(v) => patchRow({ introTemplateId: v })}
                allowEmpty
              />
            </RowOverrideField>
            <RowOverrideField
              label="Outro template"
              isOverridden={row.outroTemplateId !== undefined}
              inheritedLabel={inheritedOutroTplId ? tplName(inheritedOutroTplId) : "(none — skip)"}
              onRevert={() => patchRow({ outroTemplateId: undefined, outroFieldMap: undefined })}
              onOverride={() =>
                patchRow({
                  outroTemplateId: inheritedOutroTplId ?? templates[0]?.id ?? "",
                })
              }
            >
              <RowTemplateSelect
                value={row.outroTemplateId}
                templates={templates}
                onChange={(v) => patchRow({ outroTemplateId: v })}
                allowEmpty
              />
            </RowOverrideField>
            <div style={{ display: "flex", gap: 8, alignItems: "center", color: colors.textDim }}>
              <span style={{ width: 100, flexShrink: 0 }}>Lyric template</span>
              <span style={{ flex: 1, fontStyle: "italic" }}>
                Set above — currently {tplName(row.lyricTemplateId)}
                {inheritedLyricTplId && row.lyricTemplateId !== inheritedLyricTplId && (
                  <> (show default: {tplName(inheritedLyricTplId)})</>
                )}
              </span>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", color: colors.textDim }}>
              <span style={{ width: 100, flexShrink: 0 }}>Channel</span>
              <span style={{ flex: 1, fontStyle: "italic" }}>
                Set in the Channel column — inherits from {chanName(inheritedChannel)} if blank.
              </span>
            </div>
          </div>
        </td>
      </tr>
    )}
    </>
  );
}

/**
 * Inline row used in {@link SongRowEditor}'s expanded override panel. Mirrors
 * `OverrideRow` from `SongsInShowPanel` but compact and inline-styled to fit
 * inside the rundown table's row spacing.
 */
function RowOverrideField({
  label,
  isOverridden,
  inheritedLabel,
  onRevert,
  onOverride,
  children,
}: {
  label: string;
  isOverridden: boolean;
  inheritedLabel: string;
  onRevert: () => void;
  onOverride: () => void;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ width: 100, flexShrink: 0, color: colors.textDim }}>{label}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        {isOverridden ? (
          children
        ) : (
          <span
            style={{
              display: "inline-block",
              padding: "2px 8px",
              border: `1px dashed ${colors.border}`,
              borderRadius: 4,
              color: colors.textDim,
              fontStyle: "italic",
            }}
            title="Inherited from show value"
          >
            {inheritedLabel}
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={isOverridden ? onRevert : onOverride}
        style={{
          background: "transparent",
          border: "none",
          color: colors.accent,
          cursor: "pointer",
          fontSize: 11,
          padding: 0,
          textDecoration: "underline",
        }}
      >
        {isOverridden ? "Use show value" : "Override"}
      </button>
    </div>
  );
}

function RowTemplateSelect({
  value,
  templates,
  onChange,
  allowEmpty,
}: {
  value: string | undefined;
  templates: TemplateMeta[];
  onChange: (v: string | undefined) => void;
  allowEmpty?: boolean;
}) {
  const current = value ?? "";
  const known = current && templates.some((t) => t.id === current);
  return (
    <Select
      value={current}
      onChange={(e) => onChange(e.target.value || undefined)}
    >
      {allowEmpty && <option value="">(none — skip)</option>}
      {!known && current && (
        <option value={current}>{current} (missing)</option>
      )}
      {templates.map((t) => (
        <option key={t.id} value={t.id}>{t.name}</option>
      ))}
    </Select>
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
      <span style={{ color: colors.textDim, fontSize: 11 }}>
        Loading template…
      </span>
    );
  }

  if (fieldsToShow.length === 0 && orphanKeys.length === 0) {
    return (
      <span style={{ color: colors.textDim, fontSize: 11 }}>
        Template declares no fields.
      </span>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {fieldsToShow.map((f) => (
        <div key={f.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 90, fontSize: 11, color: colors.textDim, flexShrink: 0 }}>
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
            style={{ width: 90, fontSize: 11, color: colors.accent2, flexShrink: 0 }}
            title="Not declared by the template — will still be sent on take. Edit the template's Fields panel to declare it."
          >
            {k}*
          </span>
          <Input
            value={data[k] ?? ""}
            onChange={(e) => onChange(k, e.target.value)}
          />
        </div>
      ))}
    </div>
  );
}

function ChannelHintSelect({
  value,
  onChange,
  channels,
  inheritedValue,
}: {
  value: string | undefined;
  onChange: (v: string | undefined) => void;
  channels: ChannelConfig[];
  /**
   * Cascade-resolved channel that applies when `value` is undefined. Used to
   * label the empty option so the operator sees the actual at-take channel
   * (e.g. "(inherited: Program)") instead of a bare "(any)" that hides where
   * the song's defaultChannel is winding up.
   */
  inheritedValue?: string;
}) {
  const current = value ?? "";
  const knownChannel = current && channels.some((c) => c.id === current);
  const inheritedLabel = inheritedValue
    ? channels.find((c) => c.id === inheritedValue)?.name ?? inheritedValue
    : null;
  const emptyLabel = inheritedLabel
    ? `(inherited: ${inheritedLabel})`
    : "(any)";
  // Preserve out-of-list values rather than silently dropping them — a row
  // might reference a channel that's been removed or is now a mirror, and we
  // don't want a save to quietly overwrite that hint.
  return (
    <Select
      value={current}
      onChange={(e) => onChange(e.target.value ? e.target.value : undefined)}
    >
      <option value="">{emptyLabel}</option>
      {!knownChannel && current && (
        <option value={current}>{current} (missing)</option>
      )}
      {channels.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </Select>
  );
}

const th: React.CSSProperties = {
  padding: "8px 8px",
  borderBottom: `1px solid ${colors.border}`,
  fontWeight: 500,
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: 1.2,
};
const td: React.CSSProperties = {
  padding: "8px",
  verticalAlign: "top",
};
const addRowBtn: React.CSSProperties = {
  marginTop: 12,
  padding: "10px 16px",
  background: colors.panel,
  color: colors.text,
  border: `1px dashed ${colors.border}`,
  borderRadius: 4,
  fontWeight: 600,
  fontSize: 12,
  cursor: "pointer",
  width: "100%",
};
