"use client";

import { isShortcutBlocked, type TargetLike } from "@/lib/shortcutGuards";
import { spaceAction } from "./designerKeys";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { v4 as uuid } from "uuid";
import {
  Canvas,
  LayerTree,
  TimelinePanel,
  layersMissingOut,
  alignLayers,
  copyLayersPayload,
  distributeLayers,
  duplicateLayers,
  moveLayersZ,
  nudgeForKey,
  nudgeLayers,
  parseLayersPayload,
  pasteLayers,
  removeLayers,
  type LayerClipboard,
  type PickFromLibraryFn,
  type ZMove,
} from "@overlaysys/editor-kit";
import type { Draft } from "immer";
import type { Layer, Template } from "@overlaysys/core";
import { Button, alertDialog, colors, confirm as confirmDialog, toast } from "@overlaysys/ui";
import { useWs, getClient } from "@/lib/useWs";
import { useStore } from "@/lib/store";
import { useEditor } from "@/lib/editorStore";
import { isLocalDraftEdit, shouldAdoptIncoming } from "@/lib/stageDesigner";
import { useUnsavedGuard } from "@/lib/useUnsavedGuard";
import { resolveAssetUrl } from "@/lib/uploadAsset";
import { ackErrorText, errorMatches, requestOne, sendAndAwaitAck } from "@/lib/awaitAck";
import { downloadJson } from "@/lib/download";
import { exportFileName } from "@/lib/exportName";
import { PageBody } from "@/app/components/PageShell";
import { PageChrome } from "@/app/shell/PageChrome";
import { isCloudMode } from "@/lib/mode";
import {
  deleteTemplateCloud,
  getTemplateCloud,
  refreshTemplateMetasCloud,
  saveTemplateCloud,
} from "@/lib/cloudData";
import { useDialog } from "@/lib/dialog";
import { DesignerHeader } from "./DesignerHeader";
import { PreviewOnPvwButton } from "./PreviewOnPvwButton"; // [P2b.11]
import { DesignerLayout, DesignerPanel } from "./DesignerLayout";
import { DesignerInspector } from "./DesignerInspector";
import { useMediaSourceChoice } from "@/app/media/useMediaSourceChoice";
import { timelineRowCount } from "./timelineSize";
import { PROTECTED_TEMPLATE_IDS, fetchTemplateUsage, templateDeleteConfirm } from "./templateUsage";

type Recipe = (d: Draft<Template>) => void;

const UNSAVED_PROMPT = "You have unsaved changes to this template. Leave anyway?";
/** A save with no ack after this long is reported as failed (the draft stays dirty). */
const SAVE_ACK_TIMEOUT_MS = 8000;
const STEP_SECONDS = 1 / 30;

/**
 * Layer clipboard shared across templates in this window, so a layer copied
 * in one template pastes into another. The system clipboard gets the same
 * JSON when the browser allows it.
 */
let layerClipboard: LayerClipboard | null = null;

export default function DesignPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24 }}>Loading…</div>}>
      <DesignPageInner />
    </Suspense>
  );
}

function DesignPageInner() {
  const searchParams = useSearchParams();
  const templateId = decodeURIComponent(searchParams?.get("id") ?? "");
  const router = useRouter();
  const { send } = useWs();
  const conn = useStore((s) => s.conn);

  const draft = useEditor((s) => s.draft);
  const dirty = useEditor((s) => s.dirty);
  const selectedLayerId = useEditor((s) => s.selectedLayerId);
  const selectedLayerIds = useEditor((s) => s.selectedLayerIds);
  const activeTimeline = useEditor((s) => s.activeTimeline);
  const scrubTime = useEditor((s) => s.scrubTime);
  const playing = useEditor((s) => s.playing);
  const loop = useEditor((s) => s.loop);
  const selectedKeyframe = useEditor((s) => s.selectedKeyframe);
  const canUndo = useEditor((s) => s.history.length > 0);
  const canRedo = useEditor((s) => s.redoStack.length > 0);
  const {
    setDraft,
    commit,
    applyLive,
    pushHistory,
    cancelDrag,
    setSelectedLayer,
    selectLayers,
    setSelectedKeyframe,
    setActiveTimeline,
    setScrubTime,
    setPlaying,
    setLoop,
    undo,
    redo,
    markSaved,
  } = useEditor.getState();

  const fetchedRef = useRef<string | null>(null);
  const playRafRef = useRef<number | null>(null);
  /** The draft object a save was sent for; cleared by its ack or failure. */
  const savingRef = useRef<Template | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Id whose save was acked; its broadcast echo must not reset history. */
  const awaitingEchoRef = useRef<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cloud = isCloudMode();
  const { alert, dialog } = useDialog();
  // "Choose from Media" (show computer only) and "Upload" for layer sources and
  // field defaults; uploaded photos and videos join Media, fonts don't.
  const media = useMediaSourceChoice();
  const pickFromLibrary: PickFromLibraryFn | undefined = media.pickFromLibrary;

  async function showCloudError(action: string, err: unknown) {
    const message = err instanceof Error ? err.message : JSON.stringify(err);
    console.warn(`[design/edit] cloud ${action} failed`, err);
    await alert({
      title: `Cloud ${action} failed`,
      message: (
        <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12, margin: 0 }}>
          {message}
        </pre>
      ),
    });
  }

  function endSave(err: string | null) {
    savingRef.current = null;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
    setSaving(false);
    setError(err);
  }

  // ---- Loading, save acks, broadcasts ----
  useEffect(() => {
    fetchedRef.current = null;
    awaitingEchoRef.current = null;
    savingRef.current = null;
    setSaving(false);
    setError(null);
    setDraft(null);
    if (cloud) return;
    const off = getClient().on((msg) => {
      if (msg.type === "template" && msg.template.id === templateId) {
        const st = useEditor.getState();
        const adopt = shouldAdoptIncoming(
          { draft: st.draft, dirty: st.dirty, awaitingEchoId: awaitingEchoRef.current },
          msg.template,
        );
        if (awaitingEchoRef.current === msg.template.id) awaitingEchoRef.current = null;
        if (adopt) setDraft(msg.template);
      } else if (msg.type === "ack" && msg.op === "save_template" && msg.id === templateId) {
        const sent = savingRef.current;
        awaitingEchoRef.current = msg.id;
        endSave(null);
        // Edits made while the save was in flight stay unsaved.
        if (sent && useEditor.getState().draft === sent) markSaved();
      } else if (msg.type === "error") {
        if (msg.code === "not_found" && msg.message === templateId) {
          setError(`Template "${templateId}" not found.`);
        } else if (savingRef.current && errorMatches(msg, { op: "save_template", id: templateId })) {
          // Only an error that answers this template's save counts as the save failing.
          endSave(`Save failed: ${msg.message}`);
        }
      }
    });
    return () => {
      off();
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [templateId, setDraft, markSaved, cloud]);

  // A dropped connection loses the in-flight save's ack.
  useEffect(() => {
    if (conn !== "open" && savingRef.current) endSave("Connection lost before the save was confirmed. Not saved.");
  }, [conn]);

  // A local edit makes any awaited echo moot (the draft is dirty, so it won't
  // be adopted); drop the marker so a broadcast that never arrives can't
  // swallow a later get_template reply.
  useEffect(
    () =>
      useEditor.subscribe((next, prev) => {
        if (isLocalDraftEdit(prev, next)) awaitingEchoRef.current = null;
      }),
    [],
  );

  useEffect(() => {
    if (cloud) {
      if (fetchedRef.current === templateId) return;
      fetchedRef.current = templateId;
      getTemplateCloud(templateId)
        .then((t) => {
          if (t) setDraft(t);
          else setError(`Template "${templateId}" not found.`);
        })
        .catch((err) => {
          console.warn("[design/edit] cloud load failed", err);
          setError(`Couldn't load the template: ${err instanceof Error ? err.message : String(err)}`);
        });
      return;
    }
    if (conn !== "open") {
      // A fetch sent before the drop is lost: with nothing loaded yet, ask again on reconnect.
      if (!useEditor.getState().draft) fetchedRef.current = null;
      return;
    }
    if (fetchedRef.current === templateId) return;
    fetchedRef.current = templateId;
    send({ type: "get_template", templateId });
  }, [cloud, conn, templateId, send, setDraft]);

  // A name typed in the header but not yet committed counts as unsaved too.
  const nameFlushRef = useRef<(() => void) | null>(null);
  const namePendingRef = useRef(false);
  const [namePending, setNamePending] = useState(false);
  const onNamePendingChange = useCallback((p: boolean) => {
    namePendingRef.current = p;
    setNamePending(p);
  }, []);
  const anyDirty = dirty || namePending;

  useUnsavedGuard(anyDirty, {
    message: UNSAVED_PROMPT,
    getDirty: () => useEditor.getState().dirty || namePendingRef.current,
    resetKey: templateId,
    canArm: draft?.id === templateId,
  });

  // Field defaults only: recomputing on every draft change would push new
  // data into the canvas on every drag frame.
  const fields = draft?.fields;
  const previewData = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const f of fields ?? []) out[f.key] = f.default ?? `[${f.label}]`;
    return out;
  }, [fields]);

  function play() {
    const cur = useEditor.getState().draft;
    if (!cur) return;
    if (playRafRef.current) cancelAnimationFrame(playRafRef.current);
    setPlaying(true);
    const dur = cur.timelines[useEditor.getState().activeTimeline].duration;
    const startWall = performance.now();
    const startT = useEditor.getState().scrubTime >= dur ? 0 : useEditor.getState().scrubTime;
    function step(now: number) {
      const elapsed = (now - startWall) / 1000;
      let t = startT + elapsed;
      if (t >= dur) {
        if (useEditor.getState().loop) {
          t = t % dur;
        } else {
          setScrubTime(dur);
          setPlaying(false);
          playRafRef.current = null;
          return;
        }
      }
      setScrubTime(t);
      playRafRef.current = requestAnimationFrame(step);
    }
    playRafRef.current = requestAnimationFrame(step);
  }
  function pause() {
    if (playRafRef.current) {
      cancelAnimationFrame(playRafRef.current);
      playRafRef.current = null;
    }
    setPlaying(false);
  }
  useEffect(
    () => () => {
      if (playRafRef.current) cancelAnimationFrame(playRafRef.current);
    },
    [],
  );

  // ---- Layer actions ----
  function deleteSelection() {
    const ids = useEditor.getState().selectedLayerIds;
    if (ids.length === 0) return;
    commit(removeLayers(ids));
  }
  function duplicateSelection() {
    const ids = useEditor.getState().selectedLayerIds;
    if (ids.length === 0) return;
    const created: string[] = [];
    commit(duplicateLayers(ids, created));
    if (created.length > 0) selectLayers(created);
  }
  function copySelection(): LayerClipboard | null {
    const st = useEditor.getState();
    if (!st.draft || st.selectedLayerIds.length === 0) return null;
    const clip = copyLayersPayload(st.draft, st.selectedLayerIds);
    if (clip) layerClipboard = clip;
    return clip;
  }
  function paste(clip: LayerClipboard | null) {
    if (!clip) return;
    const created: string[] = [];
    commit(pasteLayers(clip, created));
    if (created.length > 0) selectLayers(created);
  }
  function moveZ(to: ZMove) {
    const ids = useEditor.getState().selectedLayerIds;
    if (ids.length > 0) commit(moveLayersZ(ids, to));
  }

  // ---- Keyboard ----
  const spacePannedRef = useRef(false);
  /** Canvas fills this with the artboard area on screen; new layers land in its centre. */
  const visibleAreaRef = useRef<(() => { x: number; y: number; w: number; h: number }) | null>(null);
  const keyActionsRef = useRef({ play, pause, deleteSelection, duplicateSelection, moveZ });
  keyActionsRef.current = { play, pause, deleteSelection, duplicateSelection, moveZ };
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const a = keyActionsRef.current;
      const meta = e.metaKey || e.ctrlKey;
      // ⌘S is SaveBar's (it works from inside inputs too).
      if (isShortcutBlocked(e.target as TargetLike, document.activeElement as TargetLike)) return;
      const st = useEditor.getState();
      if (meta && e.code === "KeyZ" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (meta && (e.code === "KeyY" || (e.code === "KeyZ" && e.shiftKey))) {
        e.preventDefault();
        redo();
      } else if (meta && e.code === "KeyD" && !e.shiftKey) {
        e.preventDefault();
        a.duplicateSelection();
      } else if (meta && (e.code === "BracketRight" || e.code === "BracketLeft")) {
        e.preventDefault();
        const up = e.code === "BracketRight";
        a.moveZ(e.shiftKey ? (up ? "top" : "bottom") : up ? "up" : "down");
      } else if (meta) {
        return;
      } else if (e.code === "Space") {
        // Arm only; play/pause toggles on keyup unless the canvas was panned.
        e.preventDefault();
        if (spaceAction({ phase: "down", repeat: e.repeat, panned: false, typing: false }) === "arm") spacePannedRef.current = false;
      } else if (e.code === "Home") {
        e.preventDefault();
        if (st.playing) a.pause();
        setScrubTime(0);
      } else if (e.code === "End") {
        e.preventDefault();
        if (st.playing) a.pause();
        setScrubTime(st.draft?.timelines[st.activeTimeline].duration ?? 0);
      } else if (e.key.startsWith("Arrow")) {
        // Arrows nudge the selection (Shift = 10px). Alt+←/→, or ←/→ with
        // nothing selected, step the playhead one frame.
        const nudge = nudgeForKey(e.key, e.shiftKey);
        if (!nudge) return;
        const horizontal = e.key === "ArrowLeft" || e.key === "ArrowRight";
        if (!e.altKey && st.selectedLayerIds.length > 0) {
          e.preventDefault();
          commit(nudgeLayers(st.selectedLayerIds, nudge[0], nudge[1]));
        } else if (horizontal) {
          e.preventDefault();
          if (st.playing) a.pause();
          const dur = st.draft?.timelines[st.activeTimeline].duration ?? 0;
          const t = st.scrubTime + (e.key === "ArrowLeft" ? -STEP_SECONDS : STEP_SECONDS);
          setScrubTime(Math.max(0, Math.min(dur, t)));
        }
      } else if (e.code === "Delete" || e.code === "Backspace") {
        e.preventDefault();
        const sel = st.selectedKeyframe;
        if (sel) {
          commit((d) => {
            const tl = d.timelines[st.activeTimeline];
            for (const t of tl.tracks) {
              const key = `${t.layerId}::${t.property}`;
              if (key === sel.trackKey) t.keyframes.splice(sel.index, 1);
            }
          });
          setSelectedKeyframe(null);
        } else {
          a.deleteSelection();
        }
      }
    }
    // Copy / cut / paste go through the clipboard events, which need no permission.
    function onCopy(e: ClipboardEvent, cut: boolean) {
      if (isShortcutBlocked(e.target as TargetLike, document.activeElement as TargetLike)) return;
      const clip = copySelection();
      if (!clip) return;
      e.preventDefault();
      e.clipboardData?.setData("text/plain", JSON.stringify(clip));
      if (cut) keyActionsRef.current.deleteSelection();
    }
    function onPaste(e: ClipboardEvent) {
      if (isShortcutBlocked(e.target as TargetLike, document.activeElement as TargetLike)) return;
      const text = e.clipboardData?.getData("text/plain") ?? "";
      const clip = (text && parseLayersPayload(text)) || layerClipboard;
      if (!clip) return;
      e.preventDefault();
      paste(clip);
    }
    const copy = (e: ClipboardEvent) => onCopy(e, false);
    const cut = (e: ClipboardEvent) => onCopy(e, true);
    function onKeyUp(e: KeyboardEvent) {
      if (e.code !== "Space") return;
      const typing = isShortcutBlocked(e.target as TargetLike, document.activeElement as TargetLike);
      if (spaceAction({ phase: "up", repeat: false, panned: spacePannedRef.current, typing }) !== "toggle-play") return;
      e.preventDefault();
      const a = keyActionsRef.current;
      if (useEditor.getState().playing) a.pause();
      else a.play();
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("copy", copy);
    window.addEventListener("cut", cut);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("copy", copy);
      window.removeEventListener("cut", cut);
      window.removeEventListener("paste", onPaste);
    };
    // Store actions are stable; everything else is read live.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Save / revert ----
  async function save() {
    // Commit a typed-but-uncommitted template name first, so it is never left out.
    nameFlushRef.current?.();
    const cur = useEditor.getState().draft;
    if (!cur || !useEditor.getState().dirty || savingRef.current) return;
    if (cloud) {
      savingRef.current = cur;
      setSaving(true);
      try {
        await saveTemplateCloud(cur);
        await refreshTemplateMetasCloud();
        endSave(null);
        // Edits made while the save was in flight stay unsaved.
        if (useEditor.getState().draft === cur) markSaved();
      } catch (err) {
        endSave(null);
        await showCloudError("save", err);
      }
      return;
    }
    if (useStore.getState().conn !== "open") {
      setError("Not connected to the server. Not saved.");
      return;
    }
    savingRef.current = cur;
    setSaving(true);
    setError(null);
    send({ type: "save_template", template: cur });
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      if (savingRef.current === cur) endSave("The server didn't confirm the save. Not saved — try again.");
    }, SAVE_ACK_TIMEOUT_MS);
  }

  async function revert() {
    fetchedRef.current = null;
    // The reply to this fetch must be adopted even if a save echo never came.
    awaitingEchoRef.current = null;
    setError(null);
    setDraft(null);
    if (cloud) {
      try {
        const t = await getTemplateCloud(templateId);
        if (t) setDraft(t);
      } catch (err) {
        await showCloudError("revert", err);
      }
      return;
    }
    // Offline the fetch can't go out: leave the template unfetched so the
    // load effect requests it when the connection comes back.
    if (useStore.getState().conn !== "open") return;
    fetchedRef.current = templateId;
    send({ type: "get_template", templateId });
  }

  // ---- Header menu: duplicate / export / delete (the saved template) ----
  async function duplicateTemplate() {
    const cur = useEditor.getState().draft;
    if (!cur || useEditor.getState().dirty) return;
    let copyId: string;
    try {
      if (cloud) {
        copyId = `template-${uuid().slice(0, 8)}`;
        await saveTemplateCloud({ ...cur, id: copyId, name: `${cur.name} (copy)` });
        await refreshTemplateMetasCloud();
      } else {
        copyId = await requestOne(getClient(), { type: "duplicate_template", templateId: cur.id }, (m) =>
          m.type === "ack" && m.op === "duplicate_template" && m.id ? m.id : undefined,
        );
      }
    } catch (e) {
      toast({ tone: "error", message: `Not duplicated: ${ackErrorText(e)}` });
      return;
    }
    router.push(`/design/edit?id=${encodeURIComponent(copyId)}`);
  }

  function exportTemplate() {
    const cur = useEditor.getState().draft;
    if (cur) downloadJson(exportFileName("template", cur), cur);
  }

  async function deleteTemplate() {
    const cur = useEditor.getState().draft;
    if (!cur || useEditor.getState().dirty || namePendingRef.current) return;
    const usage =
      (cloud ? null : await fetchTemplateUsage(cur.id)) ??
      (PROTECTED_TEMPLATE_IDS.includes(cur.id)
        ? { shows: [], hotcards: [], songs: [], scriptureDefault: false, protected: true }
        : null);
    const c = templateDeleteConfirm(cur.name || "template", usage);
    if (c.blocked) {
      await alertDialog({ title: c.title, message: c.message, okLabel: c.confirmLabel });
      return;
    }
    const ok = await confirmDialog({ title: c.title, message: c.message, confirmLabel: c.confirmLabel, danger: true });
    if (!ok) return;
    try {
      if (cloud) {
        await deleteTemplateCloud(cur.id);
        await refreshTemplateMetasCloud();
      } else {
        await sendAndAwaitAck(getClient(), { type: "delete_template", templateId: cur.id }, { op: "delete_template", id: cur.id });
      }
    } catch (e) {
      toast({ tone: "error", message: `Not deleted: ${ackErrorText(e)}` });
      return;
    }
    // Deleted: nothing left to guard.
    markSaved();
    router.push("/design");
  }

  if (!draft) {
    return (
      <>
        <PageChrome />
        <PageBody style={{ height: "100%" }}>
          <p style={{ color: error ? colors.danger : colors.textDim, marginTop: 12 }}>
            {error ?? (
              <>
                Loading template <code>{templateId}</code>…
              </>
            )}
          </p>
        </PageBody>
      </>
    );
  }

  const selectedLayers = selectedLayerIds
    .map((id) => findLayer(draft.layers, id))
    .filter((l): l is Layer => !!l);
  const offline = !cloud && conn !== "open";
  const saveFirst = (what: string) => `Save first. ${what} uses the saved template.`;

  return (
    <>
      <PageChrome docTitle={draft.name} />
      <DesignerLayout
        rowCount={timelineRowCount(draft.timelines[activeTimeline].tracks)}
        warningLines={activeTimeline === "out" ? layersMissingOut(draft).length : 0}
        header={
          <DesignerHeader
            name={draft.name}
            size={draft.size}
            dirty={anyDirty}
            saving={saving}
            canUndo={canUndo}
            canRedo={canRedo}
            onUndo={undo}
            onRedo={redo}
            onSave={() => void save()}
            onRevert={() => void revert()}
            onRename={(name) =>
              commit((d) => {
                d.name = name;
              })
            }
            previewSlot={<PreviewOnPvwButton sourceId={templateId} draft={draft} data={previewData} offline={offline} />}
            saveDisabledReason={offline ? "Reconnect to save" : undefined}
            onDuplicate={() => void duplicateTemplate()}
            duplicateDisabled={anyDirty ? saveFirst("Duplicate") : offline ? "Reconnect to duplicate" : false}
            onExport={exportTemplate}
            exportDisabled={anyDirty ? saveFirst("Export") : false}
            onDelete={() => void deleteTemplate()}
            // Delete-while-dirty would mark-saved then navigate, racing the guard's history sentinel.
            deleteDisabled={anyDirty ? "Save or revert first" : offline ? "Reconnect to delete" : false}
            nameFlushRef={nameFlushRef}
            onNamePendingChange={onNamePendingChange}
          />
        }
        banner={
          error && (
            <div
              role="alert"
              style={{ padding: "6px 12px", fontSize: 12, color: colors.dangerText, background: colors.surface, borderBottom: `1px solid ${colors.border}`, display: "flex", gap: 12, alignItems: "center" }}
            >
              {error}
              <Button size="sm" variant="ghost" onClick={() => setError(null)}>Dismiss</Button>
            </div>
          )
        }
        layers={
          <DesignerPanel title="Layers">
            <LayerTree
              template={draft}
              selectedId={selectedLayerId}
              selectedIds={selectedLayerIds}
              onSelect={setSelectedLayer}
              onSelectLayers={selectLayers}
              onCommit={commit}
              getVisibleArea={() => visibleAreaRef.current?.() ?? null}
            />
          </DesignerPanel>
        }
        canvas={
          <Canvas
            template={draft}
            data={previewData}
            selectedLayerId={selectedLayerId}
            selectedLayerIds={selectedLayerIds}
            onSelectLayer={setSelectedLayer}
            onSelectLayers={selectLayers}
            scrub={{ timeline: activeTimeline, time: scrubTime }}
            onCommit={commit}
            onLive={applyLive}
            onPushHistory={pushHistory}
            onCancelDrag={cancelDrag}
            spacePannedRef={spacePannedRef}
            onPasteboardClick={() => selectLayers([])}
            visibleAreaRef={visibleAreaRef}
          />
        }
        inspector={
          <DesignerInspector
            draft={draft}
            selectedLayers={selectedLayers}
            selectedLayerId={selectedLayerId}
            onCommit={commit}
            onLive={applyLive}
            onPushHistory={pushHistory}
            onUpload={media.uploadAny}
            resolveUrl={resolveAssetUrl}
            onPickFromLibrary={pickFromLibrary}
            onAlign={(mode) => commit(alignLayers(useEditor.getState().selectedLayerIds, mode))}
            onDistribute={(axis) => commit(distributeLayers(useEditor.getState().selectedLayerIds, axis))}
            onZ={moveZ}
          />
        }
        timeline={
          <TimelinePanel
            template={draft}
            active={activeTimeline}
            setActive={setActiveTimeline}
            time={scrubTime}
            setTime={setScrubTime}
            selectedLayerId={selectedLayerId}
            selectedKeyframe={selectedKeyframe}
            setSelectedKeyframe={setSelectedKeyframe}
            playing={playing}
            loop={loop}
            onPlay={play}
            onPause={pause}
            onLoopToggle={() => setLoop(!loop)}
            onCommit={commit}
            onLive={applyLive}
            onPushHistory={pushHistory}
          />
        }
      />
      {dialog}
      {media.picker}
    </>
  );
}

function findLayer(layers: Layer[], id: string): Layer | null {
  for (const l of layers) {
    if (l.id === id) return l;
    if (l.type === "group") {
      const found = findLayer(l.children, id);
      if (found) return found;
    }
  }
  return null;
}
