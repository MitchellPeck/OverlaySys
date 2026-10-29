"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { v4 as uuid } from "uuid";
import { produce } from "immer";
import type { Show, RundownRow, ScriptureRow, VideoRow, SongRow } from "@overlaysys/core";
import { addSection, deleteSection, moveRow, renameSection } from "@overlaysys/core";
import { BookOpen, ChevronDown, Copy, Film, FolderInput, Music, Plus, Presentation, Rows3, Trash2, Type } from "lucide-react";
import {
  Button,
  Field,
  Modal,
  alertDialog,
  colors,
  fontSize,
  useConfirm,
  useContextMenu,
  useToast,
  type MenuItem,
} from "@overlaysys/ui";
import { useWs, getClient } from "@/lib/useWs";
import { useStore } from "@/lib/store";
import { useUnsavedGuard } from "@/lib/useUnsavedGuard";
import { useResolvedChannelConfigs } from "@/lib/useResolvedChannels";
import { useConnection } from "@/lib/useConnection";
import { AckError, ackErrorText, requestOne, sendAndAwaitAck } from "@/lib/awaitAck";
import { slidesAddItemEnabled } from "@/lib/slidesRowView";
import { PageBody } from "@/app/components/PageShell";
import { PageChrome } from "@/app/shell/PageChrome";
import { RundownList } from "@/app/components/rundown/RundownList";
import { rowDomId } from "@/app/components/rundown/RundownRow";
import { isCloudMode } from "@/lib/mode";
import type { RowLike } from "@/lib/rowLike";
import { VideoRowModal, type VideoRowSaveArgs } from "@/app/components/VideoRowModal";
import { ScriptureRowModal, type SaveArgs as ScriptureSaveArgs } from "@/app/components/ScriptureRowModal";
import { canSave, removeRowAt } from "./showEditOps";
import {
  duplicateRowIn,
  insertNewRows,
  moveRowToSection,
  moveToSectionChoices,
  savedSettles,
  sectionIdOf,
  sectionRowCount,
  showForSave,
  undoRowDelete,
  undoSectionDelete,
  isBareUnusedSongDefault,
} from "./showEditorModel";
import { ShowHeader } from "./ShowHeader";
import { ShowDetailsPane } from "./ShowDetailsPane";
import { SlidesAddFlow, SlidesItemForm, slidesAddFlowReady } from "./forms/SlidesItemForm";
import { GraphicItemForm } from "./forms/GraphicItemForm";
import { SongItemForm } from "./forms/SongItemForm";
import { ScriptureItemForm } from "./forms/ScriptureItemForm";
import { VideoItemForm } from "./forms/VideoItemForm";
import {
  applyPassage,
  lastUsedGraphicTemplate,
  newSongRows,
  recentSongIds,
  recentTemplateIds,
  withSongDefaults,
  withVideoLengthPrefill,
} from "./forms/itemFormModel";
import { SongPickerDialog } from "./SongPickerDialog";
import { TemplateSelect } from "./TemplateSelect";
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

type Update = (recipe: (s: Show) => void) => void;

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
  const { connected } = useConnection();
  const conn = useStore((s) => s.conn);
  const templates = useStore((s) => s.templates);
  const songs = useStore((s) => s.songs);
  const songCache = useStore((s) => s.songCache);
  const channelConfigs = useResolvedChannelConfigs();
  // Mirror channels reflect another channel's state; targeting one would be
  // a no-op, so they're hidden from item output pickers.
  const takeableChannels = useMemo(() => channelConfigs.filter((c) => !c.mirrorOf), [channelConfigs]);

  const templateCache = useStore((s) => s.templateCache);
  const setTemplate = useStore((s) => s.setTemplate);
  const setSong = useStore((s) => s.setSong);
  const [draft, setDraftState] = useState<Show | null>(null);
  // The latest draft for event handlers: edits compose on it synchronously.
  const draftRef = useRef<Show | null>(null);
  draftRef.current = draft;
  // Last loaded or saved version. Revert returns here; it moves only on a confirmed save.
  const baselineRef = useRef<Show | null>(null);
  const [dirty, setDirtyState] = useState(false);
  // Live `dirty` for the WS `show` listener (its closure is from subscribe
  // time): an echo broadcast must never clobber in-flight edits.
  const dirtyRef = useRef(false);
  const setDirty = (v: boolean) => {
    dirtyRef.current = v;
    setDirtyState(v);
  };
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  // A counter per request, so asking to rename the same section again re-opens it.
  const [renameRequest, setRenameRequest] = useState<{ id: string; n: number } | null>(null);
  const requestRename = (id: string) => setRenameRequest((r) => ({ id, n: (r?.n ?? 0) + 1 }));
  // Add flows only: existing items are edited in their form (forms/*).
  const [scriptureModalOpen, setScriptureModalOpen] = useState(false);
  const [videoModalOpen, setVideoModalOpen] = useState(false);
  const [songPickerOpen, setSongPickerOpen] = useState(false);
  const [graphicAddOpen, setGraphicAddOpen] = useState(false);
  const [slidesAddOpen, setSlidesAddOpen] = useState(false);
  // Cloud `updated_at` value at the moment the editor loaded the draft.
  // Used by save() in cloud mode to detect concurrent writes — a newer
  // value in Supabase means another tab/user saved while we were editing.
  const loadedAtRef = useRef<string | null>(null);
  const fetchedRef = useRef<string | null>(null);
  const confirm = useConfirm();
  const toast = useToast();
  const menu = useContextMenu();
  const cloud = isCloudMode();

  // Ask before leaving with unsaved edits: reload/close, in-app links and
  // browser Back/Forward. Must run before the `!draft` early return below.
  useUnsavedGuard(dirty, {
    resetKey: showId,
    canArm: draft?.id === showId,
    getDirty: () => dirtyRef.current,
    onSave: save,
  });

  function load(show: Show) {
    draftRef.current = show;
    baselineRef.current = show;
    setDraftState(show);
    setDirty(false);
  }

  /** Replace the draft with an edited copy (no-op when unchanged). */
  function commit(next: Show) {
    if (next === draftRef.current) return;
    draftRef.current = next;
    setDraftState(next);
    setDirty(true);
  }

  const update: Update = (recipe) => {
    const cur = draftRef.current;
    if (cur) commit(produce(cur, recipe));
  };

  async function showCloudError(action: string, err: unknown) {
    const message = err instanceof Error ? err.message : JSON.stringify(err);
    console.warn(`[shows/edit] cloud ${action} failed`, err);
    await alertDialog({
      title: `Cloud ${action} failed`,
      message: <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12, margin: 0 }}>{message}</pre>,
    });
  }

  useEffect(() => {
    fetchedRef.current = null;
    draftRef.current = null;
    baselineRef.current = null;
    setDraftState(null);
    setDirty(false);
    setSelectedRowId(null);
    if (cloud) return; // no WS subscription in cloud mode — see effect below
    const off = getClient().on((msg) => {
      if (msg.type === "show" && msg.show.id === showId) {
        if (!dirtyRef.current) load(msg.show);
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
      Promise.all([getShowCloud(showId), getShowUpdatedAtCloud(showId), refreshTemplateMetasCloud(), refreshSongMetasCloud()])
        .then(([show, updatedAt]) => {
          if (show) load(show);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloud, conn, showId, send]);

  useEffect(() => {
    if (!draft) return;
    // Hydrate template bodies for: rows that already reference them PLUS
    // every other template in the library, so a new graphic item's
    // defaultChannel prefill works.
    const needed = new Set<string>(draft.rows.flatMap((r) => (r.kind === "graphic" ? [r.templateId] : [])));
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
    const needed = new Set(draft.rows.flatMap((r) => (r.kind === "song" ? [r.songId] : [])));
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

  /** Save; resolves true once the server (or cloud) confirmed. The baseline moves only then. */
  async function save(): Promise<boolean> {
    const sent = draftRef.current;
    if (!sent || savingRef.current || !dirtyRef.current) return false;
    const payload = showForSave(sent);
    savingRef.current = true;
    setSaving(true);
    try {
      if (cloud) {
        // Conflict detection: compare cloud's current updated_at against
        // the snapshot we loaded with. Newer means somebody else saved.
        if (loadedAtRef.current) {
          const cur = await getShowUpdatedAtCloud(payload.id);
          if (cur && cur > loadedAtRef.current) {
            const ok = await confirm({
              title: "Cloud has newer changes",
              message: "This show was updated in the cloud after you loaded it. Save anyway and overwrite their changes?",
              confirmLabel: "Overwrite",
              danger: true,
            });
            if (!ok) return false;
          }
        }
        try {
          await saveShowCloud(payload);
          await refreshShowMetasCloud();
          loadedAtRef.current = await getShowUpdatedAtCloud(payload.id);
        } catch (err) {
          await showCloudError("save", err);
          return false;
        }
      } else {
        await sendAndAwaitAck(getClient(), { type: "save_show", show: payload }, { op: "save_show", id: payload.id });
      }
      baselineRef.current = payload;
      if (savedSettles(sent, draftRef.current)) {
        draftRef.current = payload;
        setDraftState(payload);
        setDirty(false);
      }
      return true;
    } catch (e) {
      toast({ tone: "error", message: `Not saved: ${ackErrorText(e)}` });
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  // SaveBar binds ⌘S and runs it only when Save is enabled (canSave ok). When
  // it's disabled because the server is unreachable, say why instead of
  // ignoring the keystroke.
  const offlineRef = useRef({ connected, cloud, dirty, saving });
  offlineRef.current = { connected, cloud, dirty, saving };
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "s") return;
      const gate = canSave(offlineRef.current);
      if (!gate.ok && gate.reason === "Not connected") {
        toast({ tone: "error", message: `Not saved: ${ackErrorText(new AckError("not_connected"))}` });
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [toast]);

  function revert() {
    // SaveBar has already asked "Discard unsaved changes to this show?".
    const b = baselineRef.current;
    if (!b) return;
    draftRef.current = b;
    setDraftState(b);
    setDirty(false);
  }

  async function removeShow() {
    const cur = draftRef.current;
    if (!cur) return;
    if (cloud) {
      try {
        await deleteShowCloud(cur.id);
        await refreshShowMetasCloud();
        router.push("/shows");
      } catch (err) {
        await showCloudError("delete", err);
      }
      return;
    }
    try {
      await sendAndAwaitAck(getClient(), { type: "delete_show", showId: cur.id }, { op: "delete_show", id: cur.id });
      router.push("/shows");
    } catch (e) {
      toast({ tone: "error", message: `Not deleted: ${ackErrorText(e)}` });
    }
  }

  async function duplicateShow() {
    const cur = draftRef.current;
    if (!cur) return;
    try {
      let copyId: string;
      if (cloud) {
        // No server-side duplicate_show in cloud mode — copy locally.
        copyId = `show-${uuid().slice(0, 8)}`;
        await saveShowCloud({ ...cur, id: copyId, name: `${cur.name} (copy)`, rows: cur.rows.map((r) => ({ ...r, id: uuid() })) });
        await refreshShowMetasCloud();
      } else {
        copyId = await requestOne(getClient(), { type: "duplicate_show", showId: cur.id }, (m) =>
          m.type === "ack" && m.op === "duplicate_show" && m.id ? m.id : undefined,
        );
      }
      router.push(`/shows/edit?id=${encodeURIComponent(copyId)}`);
    } catch (e) {
      toast({ tone: "error", message: `Not duplicated: ${ackErrorText(e)}` });
    }
  }

  /** Insert new items after the selection (in its section) and select the last one. */
  function addRows(rows: RundownRow[], songId?: string) {
    const cur = draftRef.current;
    if (!cur || rows.length === 0) return;
    let next = insertNewRows(cur, selectedRowId, rows);
    // Register a song in the show-wide defaults so overrides have a home.
    if (songId && !next.songs.some((e) => e.songId === songId)) next = { ...next, songs: [...next.songs, { songId }] };
    commit(next);
    setSelectedRowId(rows[rows.length - 1]!.id);
  }

  function addGraphic(templateId: string) {
    setGraphicAddOpen(false);
    // Prefer the meta's defaultChannel (always available from list_templates).
    const channelHint = templates.find((t) => t.id === templateId)?.defaultChannel || templateCache[templateId]?.defaultChannel || undefined;
    addRows([{ kind: "graphic", id: uuid(), templateId, data: {}, ...(channelHint ? { channelHint } : {}) }]);
  }

  function openAddSong() {
    if (songs.length === 0) {
      toast({ tone: "warn", message: "No songs in the library yet. Create one in Songs first." });
      return;
    }
    setSongPickerOpen(true);
  }

  /** Insert the picked songs, in the picked order, after the selection. */
  function addSongs(songIds: string[]) {
    setSongPickerOpen(false);
    const cur = draftRef.current;
    if (!cur || songIds.length === 0) return;
    const rows = newSongRows(songIds, cur, songCache, templates, uuid);
    commit(insertNewRows(withSongDefaults(cur, songIds), selectedRowId, rows));
    setSelectedRowId(rows[rows.length - 1]!.id);
  }

  /**
   * Replace one row from its form (same id). A song item that switched songs
   * also keeps the show-wide song defaults in step: the new song gets an
   * entry, the old one's bare unused entry goes.
   */
  function replaceRow(next: RowLike) {
    const cur = draftRef.current;
    if (!cur) return;
    const i = cur.rows.findIndex((r) => r.id === next.id);
    if (i < 0) return;
    const prev = cur.rows[i]!;
    const rows = [...cur.rows];
    rows[i] = next as RundownRow;
    let out: Show = { ...cur, rows };
    if (prev.kind === "song" && next.kind === "song") {
      const newSongId = (next as SongRow).songId;
      if (newSongId !== prev.songId) {
        out = withSongDefaults(out, [newSongId]);
        if (isBareUnusedSongDefault(out, prev.songId)) out = { ...out, songs: out.songs.filter((e) => e.songId !== prev.songId) };
      }
    }
    commit(out);
  }

  function saveScriptureRow(args: ScriptureSaveArgs) {
    const blank = { kind: "scripture", id: uuid(), reference: "", translation: "", slides: [], templateId: "" } as unknown as ScriptureRow;
    addRows([
      applyPassage(blank, {
        reference: args.reference,
        translation: args.translation,
        translationAbbreviation: args.translationAbbreviation,
        attribution: args.attribution,
        source: args.passage.source as ScriptureRow["source"],
        slides: args.slides,
        templateId: args.templateId,
        intro: args.intro,
      }),
    ]);
    setScriptureModalOpen(false);
  }

  function saveVideoRow(args: VideoRowSaveArgs) {
    const row: VideoRow = {
      kind: "video",
      id: uuid(),
      assetUrl: args.assetUrl,
      ...(args.label ? { label: args.label } : {}),
      ...(args.durationSec !== undefined ? { durationSec: args.durationSec } : {}),
      volume: args.volume,
      endAction: args.endAction,
      transitionIn: args.transitionIn,
      transitionOut: args.transitionOut,
      channelHint: args.channelHint,
    };
    addRows([withVideoLengthPrefill(row)]);
    setVideoModalOpen(false);
  }

  function addSectionHere() {
    const cur = draftRef.current;
    if (!cur) return;
    const { show, section } = addSection(cur, "", sectionIdOf(cur, selectedRowId));
    commit(show);
    requestRename(section.id);
  }

  function deleteRow(rowId: string) {
    const cur = draftRef.current;
    if (!cur) return;
    const { show, removed } = removeRowAt(cur, rowId);
    if (!removed) return;
    commit(show);
    if (selectedRowId === rowId) setSelectedRowId(null);
    toast({
      message: "Item deleted",
      action: {
        label: "Undo",
        onClick: () => {
          // Never into another show (the page stays mounted across ?id changes).
          const now = draftRef.current;
          if (!now || now.id !== cur.id) return;
          commit(undoRowDelete(now, cur.id, removed));
          setSelectedRowId(removed.row.id);
        },
      },
    });
  }

  function deleteSectionAs(sectionId: string, mode: "keep-rows" | "delete-rows") {
    const prev = draftRef.current;
    if (!prev) return;
    const next = deleteSection(prev, sectionId, mode);
    commit(next);
    if (selectedRowId && !next.rows.some((r) => r.id === selectedRowId)) setSelectedRowId(null);
    toast({
      message: "Section deleted",
      action: {
        label: "Undo",
        onClick: () => {
          // Same show only; later edits are kept (see undoSectionDelete).
          const now = draftRef.current;
          if (now) commit(undoSectionDelete(now, prev, next, sectionId));
        },
      },
    });
  }

  function openSectionMenu(sectionId: string, e: React.MouseEvent | HTMLElement) {
    const cur = draftRef.current;
    if (!cur) return;
    const section = (cur.sections ?? []).find((s) => s.id === sectionId);
    if (!section) return;
    const n = sectionRowCount(cur, sectionId);
    const items: MenuItem[] = [
      { id: "rename", label: "Rename", onSelect: () => requestRename(sectionId) },
      { separator: true },
      {
        id: "delete-keep",
        label: n > 0 ? "Delete section (keep its items)" : "Delete section",
        icon: <Trash2 size={14} />,
        onSelect: () => deleteSectionAs(sectionId, "keep-rows"),
      },
    ];
    if (n > 0) {
      items.push({
        id: "delete-all",
        label: `Delete section and its ${n} ${n === 1 ? "item" : "items"}`,
        icon: <Trash2 size={14} />,
        danger: true,
        onSelect: () =>
          void confirm({
            title: "Delete section and its items?",
            message: `Delete "${section.name}" and its ${n} ${n === 1 ? "item" : "items"}?`,
            confirmLabel: "Delete",
            danger: true,
          }).then((ok) => {
            if (ok) deleteSectionAs(sectionId, "delete-rows");
          }),
      });
    }
    menu.open(e, items);
  }

  function openRowMenu(rowId: string, e: React.MouseEvent | HTMLElement) {
    const cur = draftRef.current;
    if (!cur) return;
    const choices = moveToSectionChoices(cur, rowId);
    const items: MenuItem[] = [
      {
        id: "duplicate",
        label: "Duplicate",
        icon: <Copy size={14} />,
        onSelect: () => {
          const now = draftRef.current;
          if (!now) return;
          const id = uuid();
          commit(duplicateRowIn(now, rowId, id));
          setSelectedRowId(id);
        },
      },
      {
        id: "move",
        label: "Move to section…",
        icon: <FolderInput size={14} />,
        disabled: choices.length === 0 ? "No other sections" : false,
        onSelect: () => {
          const el = document.getElementById(rowDomId(rowId));
          if (!el) return;
          // Next tick: the first menu closes and a fresh one mounts (no carried-over highlight).
          setTimeout(() => menu.open(
            el,
            choices.map((c) => ({
              id: `to-${c.id ?? "none"}`,
              label: c.label,
              onSelect: () => {
                const now = draftRef.current;
                if (now) commit(moveRowToSection(now, rowId, c.id));
              },
            })),
          ), 0);
        },
      },
      { separator: true },
      { id: "delete", label: "Delete", icon: <Trash2 size={14} />, danger: true, onSelect: () => deleteRow(rowId) },
    ];
    menu.open(e, items);
  }

  function openAddMenu(e: React.MouseEvent) {
    menu.open(e, [
      { id: "graphic", label: "Graphic", icon: <Type size={14} />, onSelect: () => setGraphicAddOpen(true) },
      { id: "song", label: "Song", icon: <Music size={14} />, onSelect: openAddSong },
      {
        id: "scripture",
        label: "Scripture",
        icon: <BookOpen size={14} />,
        onSelect: () => setScriptureModalOpen(true),
      },
      {
        id: "video",
        label: "Video",
        icon: <Film size={14} />,
        onSelect: () => setVideoModalOpen(true),
      },
      {
        id: "slides",
        label: "Slides",
        icon: <Presentation size={14} />,
        disabled: !slidesAddItemEnabled ? "Needs Slides decks" : !slidesAddFlowReady ? "Coming soon" : false,
        onSelect: () => setSlidesAddOpen(true),
      },
    ]);
  }

  // Stable per draft, so the picker's ranking memo and the Add graphic dialog's reset don't churn.
  const addPickers = useMemo(
    () =>
      draft
        ? {
            recentSongs: recentSongIds(draft),
            recentGraphic: recentTemplateIds(draft, "graphic"),
            lastGraphicId: lastUsedGraphicTemplate(draft, templates)?.id ?? "",
          }
        : null,
    [draft, templates],
  );

  if (!draft || !addPickers) {
    return (
      <>
        <PageChrome />
        <PageBody style={{ height: "100%" }}>
          <p style={{ color: colors.textDim, marginTop: 12 }}>Loading show…</p>
        </PageBody>
      </>
    );
  }

  const selectedRow = selectedRowId ? draft.rows.find((r) => r.id === selectedRowId) ?? null : null;
  const notesSets = cloud ? [] : draft.sermonNotes ?? [];
  const offlineReason = !connected && !cloud ? "Reconnect to save" : null;
  const duplicateReason = dirty ? "Save your changes first" : !connected && !cloud ? "Not connected to the server" : null;
  const empty = draft.rows.length === 0 && (draft.sections ?? []).length === 0;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
      <PageChrome docTitle={draft.name.trim() || "Untitled show"} />
      <ShowHeader
        draft={draft}
        onChange={commit}
        dirty={dirty}
        saving={saving}
        onSave={() => void save()}
        onRevert={revert}
        onDelete={() => void removeShow()}
        onDuplicate={() => void duplicateShow()}
        canSaveReason={offlineReason}
        duplicateReason={duplicateReason}
      />
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "grid",
          gridTemplateColumns: "minmax(320px, 38%) 1fr",
        }}
      >
        <div style={{ overflow: "auto", borderRight: `1px solid ${colors.border}`, minHeight: 0 }}>
          <ShowDetailsRow selected={!selectedRow} onSelect={() => setSelectedRowId(null)} />
          <RundownList
            show={draft}
            mode="edit"
            selectedRowId={selectedRow ? selectedRow.id : null}
            onSelect={setSelectedRowId}
            onMoveRow={(rowId, t) => {
              const cur = draftRef.current;
              if (cur) commit(moveRow(cur, rowId, t.toSectionId, t.toIndex));
            }}
            onSectionMenu={openSectionMenu}
            onRenameSection={(id, name) => {
              const cur = draftRef.current;
              if (cur) commit(renameSection(cur, id, name));
            }}
            onRowMenu={openRowMenu}
            renameSection={renameRequest}
            footer={
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {empty && (
                  <p style={{ color: colors.textMuted, fontSize: 12, margin: 0 }}>
                    No items yet. Add an item, or a section to group items.
                  </p>
                )}
                <div style={{ display: "flex", gap: 8 }}>
                  <Button size="sm" icon={<Plus size={14} />} onClick={openAddMenu} aria-haspopup="menu">
                    Add item <ChevronDown size={14} aria-hidden />
                  </Button>
                  <Button size="sm" variant="ghost" icon={<Rows3 size={14} />} onClick={addSectionHere}>
                    Section
                  </Button>
                </div>
              </div>
            }
          />
        </div>
        <div style={{ overflow: "auto", padding: 16, minHeight: 0, minWidth: 0 }}>
          {selectedRow ? (
            <ItemPane key={selectedRow.id} row={selectedRow} draft={draft} onReplaceRow={replaceRow} />
          ) : (
            <ShowDetailsPane
              draft={draft}
              onUpdate={update}
              songs={songs}
              songCache={songCache}
              templates={templates}
              templateCache={templateCache}
              channels={takeableChannels}
              cloud={cloud}
            />
          )}
        </div>
      </div>
      <ScriptureRowModal open={scriptureModalOpen} onClose={() => setScriptureModalOpen(false)} onSave={saveScriptureRow} />
      <VideoRowModal open={videoModalOpen} channels={takeableChannels} onClose={() => setVideoModalOpen(false)} onSave={saveVideoRow} />
      <SongPickerDialog
        open={songPickerOpen}
        recentIds={addPickers.recentSongs}
        onClose={() => setSongPickerOpen(false)}
        onAdd={addSongs}
      />
      <AddGraphicDialog
        open={graphicAddOpen}
        initialId={addPickers.lastGraphicId}
        recentIds={addPickers.recentGraphic}
        onClose={() => setGraphicAddOpen(false)}
        onAdd={addGraphic}
      />
      <SlidesAddFlow
        open={slidesAddOpen}
        onClose={() => setSlidesAddOpen(false)}
        onAdd={(row) => {
          addRows([row as RundownRow]);
          setSlidesAddOpen(false);
        }}
      />
      {menu.menu}
    </div>
  );
}

/** The "Show details" pseudo-row at the top of the list: selects the show-wide pane. */
function ShowDetailsRow({ selected, onSelect }: { selected: boolean; onSelect(): void }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        height: 32,
        padding: "0 8px 0 14px",
        background: selected ? colors.control : "transparent",
        border: "none",
        borderBottom: `1px solid ${colors.border}`,
        color: colors.text,
        fontSize: fontSize.md,
        fontWeight: 500,
        textAlign: "left",
        cursor: "pointer",
      }}
    >
      Show details
      <span style={{ color: colors.textMuted, fontSize: fontSize.xs, fontWeight: 400 }}>Sermon notes · song defaults</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Selected item pane: one form per kind (forms/*), each with a live preview.
// ---------------------------------------------------------------------------

function ItemPane({ row, draft, onReplaceRow }: { row: RundownRow; draft: Show; onReplaceRow(next: RowLike): void }) {
  switch (row.kind) {
    case "graphic":
      return <GraphicItemForm row={row} show={draft} onChange={onReplaceRow} />;
    case "song":
      return <SongItemForm row={row} show={draft} onChange={onReplaceRow} />;
    case "scripture":
      return <ScriptureItemForm row={row} show={draft} onChange={onReplaceRow} />;
    case "video":
      return <VideoItemForm row={row} show={draft} onChange={onReplaceRow} />;
    case "slides":
      // [P3.8] placeholder for slides rows; P3.16 fills in SlidesItemForm.
      return <SlidesItemForm row={row} show={draft} onChange={onReplaceRow} />;
    default:
      return (
        <p style={{ color: colors.textMuted, fontSize: 12, margin: 0 }}>
          This item type isn&apos;t supported by this version. It is kept as is when you save.
        </p>
      );
  }
}

/** "Add item → Graphic": choose a template (grouped, last used first), then add. */
function AddGraphicDialog({
  open,
  initialId,
  recentIds,
  onClose,
  onAdd,
}: {
  open: boolean;
  initialId: string;
  recentIds: string[];
  onClose(): void;
  onAdd(templateId: string): void;
}) {
  const [templateId, setTemplateId] = useState(initialId);
  useEffect(() => {
    if (open) setTemplateId(initialId);
  }, [open, initialId]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add graphic"
      size="sm"
      onConfirm={templateId ? () => onAdd(templateId) : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!templateId} onClick={() => onAdd(templateId)}>
            Add graphic
          </Button>
        </>
      }
    >
      <Field label="Template">
        <TemplateSelect label="Template" use="graphic" value={templateId} recentIds={recentIds} onChange={setTemplateId} style={{ maxWidth: "none" }} />
      </Field>
    </Modal>
  );
}
