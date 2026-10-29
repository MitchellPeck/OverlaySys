"use client";

import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { v4 as uuid } from "uuid";
import { produce } from "immer";
import type {
  ChannelConfig,
  SermonNotes,
  Show,
  RundownRow,
  GraphicRow,
  ScriptureRow,
  VideoRow,
  SongRow,
  ShowSong,
  Song,
  SongMeta,
  Template,
  TemplateMeta,
} from "@overlaysys/core";
import { addSection, deleteSection, moveRow, renameSection, resolveArrangement } from "@overlaysys/core";
import { BookOpen, ChevronDown, ChevronRight, Copy, Film, FolderInput, Music, Plus, Presentation, Rows3, Trash2, Type } from "lucide-react";
import {
  Button,
  Checkbox,
  Input,
  KindBar,
  Select,
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
import { FieldInput } from "@/lib/FieldInput";
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
import { NotesSetPicker } from "./SermonNotesEditor";
import { formatRowLength, parseRowLength } from "@/lib/rowLength";
import { ArrangementModal, arrangementSummary } from "./ArrangementModal";
import { VideoRowModal, type VideoRowSaveArgs } from "@/app/components/VideoRowModal";
import { VideoThumb } from "@/app/components/VideoThumb";
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
  const [scriptureModalOpen, setScriptureModalOpen] = useState(false);
  const [editingScriptureRow, setEditingScriptureRow] = useState<ScriptureRow | null>(null);
  const [videoModalOpen, setVideoModalOpen] = useState(false);
  const [editingVideoRow, setEditingVideoRow] = useState<VideoRow | null>(null);
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

  function addGraphic() {
    const firstMeta = templates[0];
    const firstTpl = firstMeta?.id ?? "";
    // Prefer the meta's defaultChannel (always available from list_templates).
    const channelHint = firstMeta?.defaultChannel || templateCache[firstTpl]?.defaultChannel || undefined;
    addRows([{ kind: "graphic", id: uuid(), templateId: firstTpl, data: {}, ...(channelHint ? { channelHint } : {}) }]);
  }

  function addSong() {
    const firstSong = songs[0];
    if (!firstSong) {
      toast({ tone: "warn", message: "No songs in the library yet. Create one in Songs first." });
      return;
    }
    const showSong = draftRef.current?.songs.find((e) => e.songId === firstSong.id);
    // Lyric template cascade: ShowSong override → song default → first template.
    const lyricTemplateId =
      showSong?.lyricTemplateId ?? songCache[firstSong.id]?.defaultLyricTemplateId ?? templates[0]?.id ?? "";
    addRows([{ kind: "song", id: uuid(), songId: firstSong.id, lyricTemplateId }], firstSong.id);
  }

  function saveScriptureRow(args: ScriptureSaveArgs) {
    // Undefined values clear a previous override when switching back to "default".
    const introFields = {
      introTemplateId: args.intro.introTemplateId,
      introFieldMap: args.intro.introFieldMap,
      introFieldLiterals: args.intro.introFieldLiterals,
      skipIntro: args.intro.skipIntro || undefined,
    };
    const abbr = args.translationAbbreviation !== undefined ? { translationAbbreviation: args.translationAbbreviation } : {};
    if (editingScriptureRow) {
      update((s) => {
        const idx = s.rows.findIndex((r) => r.id === editingScriptureRow.id);
        if (idx >= 0) {
          s.rows[idx] = {
            ...editingScriptureRow,
            reference: args.reference,
            translation: args.translation,
            ...abbr,
            attribution: args.attribution,
            slides: args.slides.map((sl) => ({ id: sl.id, verses: sl.verses })),
            templateId: args.templateId,
            ...introFields,
          };
        }
      });
    } else {
      addRows([
        {
          kind: "scripture",
          id: uuid(),
          reference: args.reference,
          translation: args.translation,
          ...abbr,
          attribution: args.attribution,
          ...(args.passage.source ? { source: args.passage.source } : {}),
          slides: args.slides.map((sl) => ({ id: sl.id, verses: sl.verses })),
          templateId: args.templateId,
          ...introFields,
        },
      ]);
    }
    setScriptureModalOpen(false);
    setEditingScriptureRow(null);
  }

  function saveVideoRow(args: VideoRowSaveArgs) {
    const fields = {
      assetUrl: args.assetUrl,
      ...(args.label ? { label: args.label } : {}),
      ...(args.durationSec !== undefined ? { durationSec: args.durationSec } : {}),
      volume: args.volume,
      endAction: args.endAction,
      transitionIn: args.transitionIn,
      transitionOut: args.transitionOut,
      channelHint: args.channelHint,
    };
    if (editingVideoRow) {
      update((s) => {
        const idx = s.rows.findIndex((r) => r.id === editingVideoRow.id);
        if (idx >= 0) {
          const { label: _l, durationSec: _d, ...keep } = editingVideoRow;
          s.rows[idx] = { ...keep, ...fields };
        }
      });
    } else {
      addRows([{ kind: "video", id: uuid(), ...fields }]);
    }
    setVideoModalOpen(false);
    setEditingVideoRow(null);
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
      { id: "graphic", label: "Graphic", icon: <Type size={14} />, onSelect: addGraphic },
      { id: "song", label: "Song", icon: <Music size={14} />, onSelect: addSong },
      {
        id: "scripture",
        label: "Scripture",
        icon: <BookOpen size={14} />,
        onSelect: () => {
          setEditingScriptureRow(null);
          setScriptureModalOpen(true);
        },
      },
      {
        id: "video",
        label: "Video",
        icon: <Film size={14} />,
        onSelect: () => {
          setEditingVideoRow(null);
          setVideoModalOpen(true);
        },
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

  if (!draft) {
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
            <ItemPane
              key={selectedRow.id}
              row={selectedRow}
              draft={draft}
              templates={templates}
              templateCache={templateCache}
              songs={songs}
              songCache={songCache}
              channels={takeableChannels}
              sermonNotes={notesSets}
              onUpdate={update}
              onReplaceRow={(next) => update((s) => {
                const i = s.rows.findIndex((r) => r.id === next.id);
                if (i >= 0) s.rows[i] = next as RundownRow;
              })}
              onEditScripture={(row) => {
                setEditingScriptureRow(row);
                setScriptureModalOpen(true);
              }}
              onEditVideo={(row) => {
                setEditingVideoRow(row);
                setVideoModalOpen(true);
              }}
            />
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
      <ScriptureRowModal
        open={scriptureModalOpen}
        editingRow={editingScriptureRow ?? undefined}
        onClose={() => {
          setScriptureModalOpen(false);
          setEditingScriptureRow(null);
        }}
        onSave={saveScriptureRow}
      />
      <VideoRowModal
        open={videoModalOpen}
        editingRow={editingVideoRow ?? undefined}
        channels={takeableChannels}
        onClose={() => {
          setVideoModalOpen(false);
          setEditingVideoRow(null);
        }}
        onSave={saveVideoRow}
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
// Selected item pane. Interim forms (P2a.18 replaces them with forms/*).
// ---------------------------------------------------------------------------

const KIND_LABEL: Record<string, string> = {
  graphic: "Graphic",
  song: "Song",
  scripture: "Scripture",
  video: "Video",
  slides: "Slides",
};

/** Set or clear keys on one row: `undefined` removes the key. */
function patchRowIn(onUpdate: Update, rowId: string, patch: Record<string, unknown>) {
  onUpdate((s) => {
    const r = s.rows.find((x) => x.id === rowId) as Record<string, unknown> | undefined;
    if (!r) return;
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete r[key];
      else r[key] = value;
    }
  });
}

function FormRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "90px 1fr", gap: 8, alignItems: "start" }}>
      <span style={{ fontSize: fontSize.sm, color: colors.textDim, paddingTop: 5 }}>{label}</span>
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

function ItemPane({
  row,
  draft,
  templates,
  templateCache,
  songs,
  songCache,
  channels,
  sermonNotes,
  onUpdate,
  onReplaceRow,
  onEditScripture,
  onEditVideo,
}: {
  row: RundownRow;
  draft: Show;
  templates: TemplateMeta[];
  templateCache: Record<string, Template>;
  songs: SongMeta[];
  songCache: Record<string, Song>;
  channels: ChannelConfig[];
  sermonNotes: SermonNotes[];
  onUpdate: Update;
  onReplaceRow(next: { id: string }): void;
  onEditScripture(row: ScriptureRow): void;
  onEditVideo(row: VideoRow): void;
}) {
  const kind = KIND_LABEL[row.kind] ?? "Item";
  let name = "";
  let body: ReactNode;
  if (row.kind === "graphic") {
    name = templates.find((t) => t.id === row.templateId)?.name ?? "Missing template";
    body = (
      <GraphicRowForm
        row={row}
        templates={templates}
        template={templateCache[row.templateId] ?? null}
        onUpdate={onUpdate}
      />
    );
  } else if (row.kind === "song") {
    name = songCache[row.songId]?.title ?? songs.find((s) => s.id === row.songId)?.title ?? "Missing song";
    body = (
      <SongRowForm
        row={row}
        showSong={draft.songs.find((e) => e.songId === row.songId)}
        songs={songs}
        songCache={songCache}
        templates={templates}
        onUpdate={onUpdate}
      />
    );
  } else if (row.kind === "scripture") {
    name = row.reference;
    body = (
      <FormRow label="Passage">
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: fontSize.md }}>
          <span>
            {row.reference} ({row.translation})
          </span>
          <span style={{ color: colors.textMuted, fontSize: fontSize.xs }}>
            {row.slides.length} slide{row.slides.length !== 1 ? "s" : ""}
          </span>
          <Button size="sm" onClick={() => onEditScripture(row)}>
            Edit slides…
          </Button>
        </div>
      </FormRow>
    );
  } else if (row.kind === "video") {
    name = row.label || "Video";
    body = (
      <FormRow label="Video">
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: fontSize.md }}>
          <VideoThumb assetUrl={row.assetUrl} width={64} />
          <span style={{ color: colors.textMuted, fontSize: fontSize.xs }}>
            {row.endAction === "clear" ? "Clears at end" : "Holds at end"}
          </span>
          <Button size="sm" onClick={() => onEditVideo(row)}>
            Edit video…
          </Button>
        </div>
      </FormRow>
    );
  } else if (row.kind === "slides") {
    // [P3.8] placeholder for slides rows; P3.16 fills in SlidesItemForm.
    body = <SlidesItemForm row={row} show={draft} onChange={onReplaceRow} />;
  } else {
    body = (
      <p style={{ color: colors.textMuted, fontSize: 12, margin: 0 }}>
        This item type isn&apos;t supported by this version. It is kept as is when you save.
      </p>
    );
  }
  const known = ["graphic", "song", "scripture", "video"].includes(row.kind);
  const showSong = row.kind === "song" ? draft.songs.find((e) => e.songId === row.songId) : undefined;
  const inheritedChannel =
    row.kind === "song" ? showSong?.channelOverride ?? songCache[row.songId]?.defaultChannel : undefined;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, maxWidth: 720 }}>
      <h2 style={{ margin: 0, fontSize: fontSize.base, fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
        <KindBar kind={row.kind as Parameters<typeof KindBar>[0]["kind"]} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {kind}
          {name ? ` · ${name}` : ""}
        </span>
      </h2>
      {body}
      {known && (
        <>
          <FormRow label="Output">
            <ChannelHintSelect
              value={row.channelHint}
              onChange={(v) => patchRowIn(onUpdate, row.id, { channelHint: v })}
              channels={channels}
              inheritedValue={inheritedChannel}
            />
          </FormRow>
          <FormRow label="Length">
            <RowLengthInput
              value={row.lengthSec}
              onCommit={(lengthSec) => patchRowIn(onUpdate, row.id, { lengthSec, lengthSecManual: true })}
            />
          </FormRow>
          <FormRow label="Cue note">
            <Input
              aria-label="Cue note"
              value={row.notes ?? ""}
              onChange={(e) => patchRowIn(onUpdate, row.id, { notes: e.target.value || undefined })}
              placeholder="Operator cue…"
            />
          </FormRow>
          {sermonNotes.length > 0 && (
            <FormRow label="Sermon notes">
              <NotesSetPicker
                sets={sermonNotes}
                value={row.sermonNotesId}
                onChange={(v) => patchRowIn(onUpdate, row.id, { sermonNotesId: v })}
              />
            </FormRow>
          )}
        </>
      )}
    </div>
  );
}

function GraphicRowForm({
  row,
  templates,
  template,
  onUpdate,
}: {
  row: GraphicRow;
  templates: TemplateMeta[];
  template: Template | null;
  onUpdate: Update;
}) {
  function setData(key: string, value: string) {
    onUpdate((s) => {
      const r = s.rows.find((x) => x.id === row.id);
      if (!r || r.kind !== "graphic") return;
      r.data = { ...r.data, [key]: value };
    });
  }
  return (
    <>
      <FormRow label="Template">
        <Select
          aria-label="Template"
          value={row.templateId}
          onChange={(e) => {
            const nextId = e.target.value;
            // Prefill the output from the new template only when the item has none yet.
            const nextHint = row.channelHint ?? templates.find((t) => t.id === nextId)?.defaultChannel ?? undefined;
            patchRowIn(onUpdate, row.id, { templateId: nextId, channelHint: nextHint });
          }}
        >
          {!templates.some((t) => t.id === row.templateId) && <option value={row.templateId}>Missing template</option>}
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      </FormRow>
      <FormRow label="Fields">
        <FieldsEditor template={template} data={row.data} onChange={setData} />
      </FormRow>
    </>
  );
}

function SongRowForm({
  row,
  showSong,
  songs,
  songCache,
  templates,
  onUpdate,
}: {
  row: SongRow;
  showSong: ShowSong | undefined;
  songs: SongMeta[];
  songCache: Record<string, Song>;
  templates: TemplateMeta[];
  onUpdate: Update;
}) {
  const [overridesOpen, setOverridesOpen] = useState(false);
  const [arrModalOpen, setArrModalOpen] = useState(false);
  const patch = (p: Partial<SongRow>) => patchRowIn(onUpdate, row.id, p as Record<string, unknown>);

  function pickSong(songId: string) {
    const cached = songCache[songId];
    onUpdate((s) => {
      const r = s.rows.find((x) => x.id === row.id);
      if (!r || r.kind !== "song") return;
      const changed = r.songId !== songId;
      const oldSongId = r.songId;
      r.songId = songId;
      // Lyric template cascade: ShowSong → Song default → first template.
      const targetShowSong = s.songs.find((e) => e.songId === songId);
      const nextLyricTpl = targetShowSong?.lyricTemplateId ?? cached?.defaultLyricTemplateId ?? templates[0]?.id;
      if (nextLyricTpl) r.lyricTemplateId = nextLyricTpl;
      // Intro/outro overrides belonged to the old song (field maps are
      // template-specific): clear them when the song changes.
      if (changed) {
        const rec = r as Record<string, unknown>;
        for (const k of ["introTemplateId", "introFieldMap", "outroTemplateId", "outroFieldMap", "skipIntro", "skipOutro"]) delete rec[k];
      }
      if (!s.songs.some((e) => e.songId === songId)) s.songs.push({ songId });
      // Drop the old song's auto-added (empty, now unused) default entry.
      if (changed && isBareUnusedSongDefault(s, oldSongId)) s.songs = s.songs.filter((e) => e.songId !== oldSongId);
    });
  }

  const cachedSong = songCache[row.songId];
  const inheritedLyricTplId = showSong?.lyricTemplateId ?? cachedSong?.defaultLyricTemplateId;
  const inheritedIntroTplId = showSong?.introTemplateId ?? cachedSong?.defaultIntroTemplateId;
  const inheritedOutroTplId = showSong?.outroTemplateId ?? cachedSong?.defaultOutroTemplateId;
  const tplName = (id: string | undefined) => (!id ? "(none)" : templates.find((t) => t.id === id)?.name ?? "Missing template");

  return (
    <>
      <FormRow label="Song">
        <Select aria-label="Song" value={row.songId} onChange={(e) => pickSong(e.target.value)}>
          {!songs.some((s) => s.id === row.songId) && <option value={row.songId}>Missing song</option>}
          {songs.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </Select>
      </FormRow>
      <FormRow label="Lyric template">
        <Select aria-label="Lyric template" value={row.lyricTemplateId} onChange={(e) => patch({ lyricTemplateId: e.target.value })}>
          {!templates.some((t) => t.id === row.lyricTemplateId) && <option value={row.lyricTemplateId}>Missing template</option>}
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
        {inheritedLyricTplId && row.lyricTemplateId !== inheritedLyricTplId && (
          <div style={{ fontSize: fontSize.xs, color: colors.textMuted, marginTop: 4 }}>
            Show default: {tplName(inheritedLyricTplId)}
          </div>
        )}
      </FormRow>
      <FormRow label="Arrangement">
        {cachedSong ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: fontSize.sm }}>
            <span>{arrangementSummary(resolveArrangement(row, showSong, cachedSong), cachedSong)}</span>
            <Button size="sm" onClick={() => setArrModalOpen(true)}>
              Edit arrangement…
            </Button>
          </div>
        ) : (
          <span style={{ fontSize: fontSize.sm, color: colors.textMuted }}>Loading song…</span>
        )}
        {arrModalOpen && cachedSong && (
          <ArrangementModal
            song={cachedSong}
            level="row"
            value={row.arrangement}
            inherited={showSong?.arrangement ?? cachedSong.defaultArrangement}
            onSave={(next) => patch({ arrangement: next })}
            onClose={() => setArrModalOpen(false)}
          />
        )}
      </FormRow>
      <FormRow label="Intro / outro">
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", gap: 16 }}>
            <Checkbox checked={!!row.skipIntro} onChange={(v) => patch({ skipIntro: v || undefined })} label="Skip intro" />
            <Checkbox checked={!!row.skipOutro} onChange={(v) => patch({ skipOutro: v || undefined })} label="Skip outro" />
          </div>
          <div>
            <Button
              size="sm"
              variant="ghost"
              aria-expanded={overridesOpen}
              icon={overridesOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              onClick={() => setOverridesOpen((v) => !v)}
            >
              Intro and outro templates for this item
            </Button>
          </div>
          {overridesOpen && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: fontSize.xs }}>
              <RowOverrideField
                label="Intro template"
                isOverridden={row.introTemplateId !== undefined}
                inheritedLabel={inheritedIntroTplId ? tplName(inheritedIntroTplId) : "(none — skip)"}
                onRevert={() => patch({ introTemplateId: undefined, introFieldMap: undefined })}
                onOverride={() => patch({ introTemplateId: inheritedIntroTplId ?? templates[0]?.id ?? "" })}
              >
                <RowTemplateSelect
                  label="Intro template"
                  value={row.introTemplateId}
                  templates={templates}
                  onChange={(v) => patch({ introTemplateId: v })}
                  allowEmpty
                />
              </RowOverrideField>
              <RowOverrideField
                label="Outro template"
                isOverridden={row.outroTemplateId !== undefined}
                inheritedLabel={inheritedOutroTplId ? tplName(inheritedOutroTplId) : "(none — skip)"}
                onRevert={() => patch({ outroTemplateId: undefined, outroFieldMap: undefined })}
                onOverride={() => patch({ outroTemplateId: inheritedOutroTplId ?? templates[0]?.id ?? "" })}
              >
                <RowTemplateSelect
                  label="Outro template"
                  value={row.outroTemplateId}
                  templates={templates}
                  onChange={(v) => patch({ outroTemplateId: v })}
                  allowEmpty
                />
              </RowOverrideField>
            </div>
          )}
        </div>
      </FormRow>
    </>
  );
}

/** An inherited value with "Override" / "Use show value". */
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
  children: ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ width: 100, flexShrink: 0, color: colors.textDim }}>{label}</span>
      <div style={{ flex: 1, minWidth: 0, maxWidth: 320 }}>
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
            title="Inherited from the show or song"
          >
            {inheritedLabel}
          </span>
        )}
      </div>
      <Button size="sm" variant="ghost" onClick={isOverridden ? onRevert : onOverride}>
        {isOverridden ? "Use show value" : "Override"}
      </Button>
    </div>
  );
}

function RowTemplateSelect({
  label,
  value,
  templates,
  onChange,
  allowEmpty,
}: {
  label: string;
  value: string | undefined;
  templates: TemplateMeta[];
  onChange: (v: string | undefined) => void;
  allowEmpty?: boolean;
}) {
  const current = value ?? "";
  const known = current && templates.some((t) => t.id === current);
  return (
    <Select aria-label={label} value={current} onChange={(e) => onChange(e.target.value || undefined)}>
      {allowEmpty && <option value="">(none — skip)</option>}
      {!known && current && <option value={current}>Missing template</option>}
      {templates.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
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
  const declaredKeys = useMemo(() => template?.fields.map((f) => f.key) ?? [], [template]);
  const orphanKeys = Object.keys(data).filter((k) => !declaredKeys.includes(k));
  const fieldsToShow = template?.fields ?? [];

  if (!template) {
    return <span style={{ color: colors.textMuted, fontSize: fontSize.xs }}>Loading template…</span>;
  }
  if (fieldsToShow.length === 0 && orphanKeys.length === 0) {
    return <span style={{ color: colors.textMuted, fontSize: fontSize.xs }}>This template has no fields.</span>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {fieldsToShow.map((f) => (
        <div key={f.key} style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 110, fontSize: fontSize.xs, color: colors.textDim, flexShrink: 0 }}>{f.label}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <FieldInput field={f} value={data[f.key]} onChange={(v) => onChange(f.key, v)} />
          </div>
        </div>
      ))}
      {orphanKeys.map((k) => (
        <div key={k} style={{ display: "flex", alignItems: "center", gap: 6, opacity: 0.7 }}>
          <span
            style={{ width: 110, fontSize: fontSize.xs, color: colors.warn, flexShrink: 0 }}
            title="Not declared by the template — still sent on Take. Declare it in the template's Fields panel."
          >
            {k}*
          </span>
          <Input aria-label={k} value={data[k] ?? ""} onChange={(e) => onChange(k, e.target.value)} />
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
  /** Cascade-resolved output used when `value` is unset (labels the empty option). */
  inheritedValue?: string;
}) {
  const current = value ?? "";
  const knownChannel = current && channels.some((c) => c.id === current);
  const inheritedLabel = inheritedValue ? channels.find((c) => c.id === inheritedValue)?.name ?? inheritedValue : null;
  const emptyLabel = inheritedLabel ? `${inheritedLabel} (inherited)` : "Program (auto)";
  // Keep out-of-list values rather than silently dropping them on save.
  return (
    <Select aria-label="Output" value={current} onChange={(e) => onChange(e.target.value ? e.target.value : undefined)} style={{ maxWidth: 320 }}>
      <option value="">{emptyLabel}</option>
      {!knownChannel && current && <option value={current}>{current} (missing)</option>}
      {channels.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </Select>
  );
}

/** "Length" text input: commits on blur when valid, reverts when not. */
function RowLengthInput({ value, onCommit }: { value: number | undefined; onCommit: (sec: number | undefined) => void }) {
  const [text, setText] = useState(formatRowLength(value));
  const focusedRef = useRef(false);
  // Sync from the model, but never clobber what the user is typing.
  useEffect(() => {
    if (!focusedRef.current) setText(formatRowLength(value));
  }, [value]);
  return (
    <Input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onBlur={() => {
        focusedRef.current = false;
        const parsed = parseRowLength(text);
        if (!parsed.ok) {
          setText(formatRowLength(value));
          return;
        }
        if (parsed.sec !== value) onCommit(parsed.sec);
        setText(formatRowLength(parsed.sec));
      }}
      placeholder="M:SS"
      title="Length (M:SS) — starts the item countdown when taken"
      aria-label="Length"
      style={{ width: 90 }}
    />
  );
}
