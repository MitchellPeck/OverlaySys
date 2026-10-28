"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Canvas,
  LayerTree,
  PropertyInspector,
  TimelinePanel,
  FieldsPanel,
  TEMPLATE_SIZE_PRESETS,
  alignLayers,
  copyLayersPayload,
  distributeLayers,
  duplicateLayers,
  fontUsage,
  isEditableTarget,
  moveLayersZ,
  nudgeForKey,
  nudgeLayers,
  parseLayersPayload,
  pasteLayers,
  removeLayers,
  removeTemplateFont,
  templateSizePresetKey,
  useEditCoalescer,
  type AlignMode,
  type LayerClipboard,
  type ZMove,
} from "@overlaysys/editor-kit";
import type { Draft } from "immer";
import type { Layer, Template } from "@overlaysys/core";
import { Button, colors } from "@overlaysys/ui";
import { useWs, getClient } from "@/lib/useWs";
import { useStore } from "@/lib/store";
import { useEditor } from "@/lib/editorStore";
import { isLocalDraftEdit, shouldAdoptIncoming } from "@/lib/stageDesigner";
import { useUnsavedGuard } from "@/lib/useUnsavedGuard";
import { useResolvedChannelConfigs } from "@/lib/useResolvedChannels";
import { uploadAsset } from "@/lib/uploadAsset";
import { PageBody } from "@/app/components/PageShell";
import { PageChrome } from "@/app/shell/PageChrome";
import { isCloudMode } from "@/lib/mode";
import {
  getTemplateCloud,
  refreshTemplateMetasCloud,
  saveTemplateCloud,
} from "@/lib/cloudData";
import { useDialog } from "@/lib/dialog";

type Recipe = (d: Draft<Template>) => void;

const uploadInspector = async (file: File): Promise<string> =>
  (await uploadAsset(file)).url;

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
        } else if (savingRef.current) {
          // The server reports handler failures without an id; one save is in flight.
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
    if (conn !== "open") return;
    if (fetchedRef.current === templateId) return;
    fetchedRef.current = templateId;
    send({ type: "get_template", templateId });
  }, [cloud, conn, templateId, send, setDraft]);

  useUnsavedGuard(dirty, {
    message: UNSAVED_PROMPT,
    getDirty: () => useEditor.getState().dirty,
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
  const keyActionsRef = useRef({ save, play, pause, deleteSelection, duplicateSelection, moveZ });
  keyActionsRef.current = { save, play, pause, deleteSelection, duplicateSelection, moveZ };
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const a = keyActionsRef.current;
      const meta = e.metaKey || e.ctrlKey;
      // Save works from inside an input too, and must never open the browser's Save dialog.
      if (meta && e.code === "KeyS" && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        void a.save();
        return;
      }
      if (isEditableTarget(e.target) || isEditableTarget(document.activeElement)) return;
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
        e.preventDefault();
        if (st.playing) a.pause();
        else a.play();
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
      if (isEditableTarget(e.target) || isEditableTarget(document.activeElement)) return;
      const clip = copySelection();
      if (!clip) return;
      e.preventDefault();
      e.clipboardData?.setData("text/plain", JSON.stringify(clip));
      if (cut) keyActionsRef.current.deleteSelection();
    }
    function onPaste(e: ClipboardEvent) {
      if (isEditableTarget(e.target) || isEditableTarget(document.activeElement)) return;
      const text = e.clipboardData?.getData("text/plain") ?? "";
      const clip = (text && parseLayersPayload(text)) || layerClipboard;
      if (!clip) return;
      e.preventDefault();
      paste(clip);
    }
    const copy = (e: ClipboardEvent) => onCopy(e, false);
    const cut = (e: ClipboardEvent) => onCopy(e, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("copy", copy);
    window.addEventListener("cut", cut);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("copy", copy);
      window.removeEventListener("cut", cut);
      window.removeEventListener("paste", onPaste);
    };
    // Store actions are stable; everything else is read live.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Save / revert ----
  async function save() {
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
    fetchedRef.current = templateId;
    send({ type: "get_template", templateId });
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
  const primary = selectedLayerId ? findLayer(draft.layers, selectedLayerId) : null;

  return (
    <div
      style={{
        height: "100%",
        display: "grid",
        gridTemplateRows: "auto auto minmax(0, 1fr) 280px",
        overflow: "hidden",
      }}
    >
      <PageChrome
        context={
          <>
            <TemplateNameInput template={draft} onCommit={commit} onLive={applyLive} />
            <span style={{ color: colors.textDim, fontSize: 11 }}>{draft.id}</span>
            {saving ? (
              <span style={{ color: colors.textDim, fontSize: 11 }}>saving…</span>
            ) : (
              dirty && (
                <span style={{ color: colors.accent2, fontSize: 11, fontWeight: 600 }}>
                  <span
                    aria-hidden
                    style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "currentColor", marginRight: 6, verticalAlign: "middle" }}
                  />
                  unsaved
                </span>
              )
            )}
          </>
        }
        actions={
          <>
            <Button onClick={undo} variant="ghost" size="sm" disabled={!canUndo} title="Undo (⌘Z)">↶ Undo</Button>
            <Button onClick={redo} variant="ghost" size="sm" disabled={!canRedo} title="Redo (⇧⌘Z)">↷ Redo</Button>
            <Button onClick={revert} variant="ghost" size="sm" disabled={!dirty || saving}>Revert</Button>
            <Button
              onClick={() => void save()}
              variant="primary"
              size="sm"
              disabled={!dirty || saving || (!cloud && conn !== "open")}
              title={!cloud && conn !== "open" ? "Not connected to the server" : undefined}
            >
              {saving ? "Saving…" : "Save (⌘S)"}
            </Button>
          </>
        }
      />

      <div>
        {error && (
          <div
            role="alert"
            style={{ padding: "6px 12px", fontSize: 12, color: colors.danger, borderBottom: `1px solid ${colors.border}`, display: "flex", gap: 12, alignItems: "center" }}
          >
            {error}
            <Button size="sm" variant="ghost" onClick={() => setError(null)}>Dismiss</Button>
          </div>
        )}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "260px minmax(0, 1fr) 300px",
          gap: 1,
          background: colors.border,
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        <EditorSection title="Layers" extra={<LayersHint />}>
          <LayerTree
            template={draft}
            selectedId={selectedLayerId}
            selectedIds={selectedLayerIds}
            onSelect={setSelectedLayer}
            onSelectLayers={selectLayers}
            onCommit={commit}
          />
        </EditorSection>

        <div style={{ background: "var(--bg)", minWidth: 0, minHeight: 0, overflow: "hidden" }}>
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
          />
        </div>

        {selectedLayers.length === 0 ? (
          <EditorSection title="Template" subtitle="nothing selected">
            <TemplateSettings template={draft} onCommit={commit} onLive={applyLive} />
            <div style={{ marginTop: 16, paddingTop: 12, borderTop: `1px solid ${colors.border}` }}>
              <FieldsPanel template={draft} onCommit={commit} onLive={applyLive} onUpload={uploadInspector} />
            </div>
          </EditorSection>
        ) : (
          <EditorSection
            title="Inspector"
            subtitle={selectedLayers.length > 1 ? `${selectedLayers.length} layers` : (primary?.name ?? "")}
          >
            <ArrangeBar
              count={selectedLayers.length}
              onAlign={(mode) => commit(alignLayers(useEditor.getState().selectedLayerIds, mode))}
              onDistribute={(axis) => commit(distributeLayers(useEditor.getState().selectedLayerIds, axis))}
              onZ={moveZ}
            />
            {selectedLayers.length === 1 && (
              <>
                <PropertyInspector
                  template={draft}
                  selectedId={selectedLayerId}
                  onCommit={commit}
                  onLive={applyLive}
                  onPushHistory={pushHistory}
                  onUpload={uploadInspector}
                />
                {selectedLayerId && (
                  <div style={{ marginTop: 16, paddingTop: 12, borderTop: `1px solid ${colors.border}` }}>
                    <ClipBySection template={draft} selectedLayerId={selectedLayerId} onCommit={commit} />
                  </div>
                )}
              </>
            )}
            {selectedLayers.length > 1 && (
              <p style={{ fontSize: 11, color: colors.textDim, lineHeight: 1.5 }}>
                Arrows nudge (Shift = 10px) · ⌘D duplicate · ⌘C / ⌘V copy and paste · Delete removes.
              </p>
            )}
          </EditorSection>
        )}
      </div>

      <div style={{ borderTop: `1px solid ${colors.border}`, minHeight: 0, overflow: "hidden" }}>
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
      </div>
      {dialog}
    </div>
  );
}

/** Template name; one undo step per edit, Enter / blur ends it, Escape reverts. */
function TemplateNameInput({ template, onCommit, onLive }: { template: Template; onCommit: (r: Recipe) => void; onLive: (r: Recipe) => void }) {
  const { commit, handlers } = useEditCoalescer(onCommit, onLive);
  const startRef = useRef(template.name);
  return (
    <span {...handlers}>
      <input
        value={template.name}
        onFocus={() => (startRef.current = template.name)}
        onChange={(e) => {
          const v = e.target.value;
          commit((d) => {
            d.name = v;
          });
        }}
        onBlur={() => {
          if (template.name.trim()) return;
          // Never leave the template nameless.
          const back = startRef.current || template.id;
          onLive((d) => {
            d.name = back;
          });
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        title="Template name"
        aria-label="Template name"
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
    </span>
  );
}

const ALIGN_BUTTONS: { mode: AlignMode; label: string }[] = [
  { mode: "left", label: "Left" },
  { mode: "hcenter", label: "Centre" },
  { mode: "right", label: "Right" },
  { mode: "top", label: "Top" },
  { mode: "vcenter", label: "Middle" },
  { mode: "bottom", label: "Bottom" },
];

/** Align / distribute / z-order for the selection. One layer aligns to the canvas (or its group). */
function ArrangeBar({
  count,
  onAlign,
  onDistribute,
  onZ,
}: {
  count: number;
  onAlign: (mode: AlignMode) => void;
  onDistribute: (axis: "x" | "y") => void;
  onZ: (to: ZMove) => void;
}) {
  return (
    <div style={{ marginBottom: 12, paddingBottom: 10, borderBottom: `1px solid ${colors.border}` }}>
      <div style={{ fontSize: 10, color: colors.textDim, marginBottom: 4 }}>
        {count === 1 ? "Align to canvas" : "Align"}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 2 }}>
        {ALIGN_BUTTONS.map((b) => (
          <button key={b.mode} type="button" onClick={() => onAlign(b.mode)} title={`Align ${b.label.toLowerCase()}`} style={miniBtn}>
            {b.label}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 2, marginTop: 4 }}>
        {count >= 3 && (
          <>
            <button type="button" onClick={() => onDistribute("x")} style={miniBtn}>Distribute ↔</button>
            <button type="button" onClick={() => onDistribute("y")} style={miniBtn}>Distribute ↕</button>
          </>
        )}
        <button type="button" onClick={() => onZ("top")} title="Bring to front (⇧⌘])" style={miniBtn}>To front</button>
        <button type="button" onClick={() => onZ("bottom")} title="Send to back (⇧⌘[)" style={miniBtn}>To back</button>
      </div>
    </div>
  );
}

const miniBtn: React.CSSProperties = {
  flex: 1,
  padding: "3px 4px",
  background: colors.panel,
  border: `1px solid ${colors.border}`,
  borderRadius: 3,
  color: colors.text,
  fontSize: 10,
  cursor: "pointer",
};

function TemplateSettings({
  template,
  onCommit: commitStep,
  onLive,
}: {
  template: Template;
  onCommit: (recipe: Recipe) => void;
  onLive: (recipe: Recipe) => void;
}) {
  // Typing makes one undo step per field edit, not one per keystroke.
  const { commit: onCommit, handlers } = useEditCoalescer(commitStep, onLive);
  const seconds =
    template.autoOutMs && template.autoOutMs > 0 ? template.autoOutMs / 1000 : 0;
  const channelConfigs = useResolvedChannelConfigs();
  const channelChoices = useMemo(
    () => channelConfigs.filter((c) => !c.mirrorOf),
    [channelConfigs],
  );
  const blink = template.blinkOnTake;
  // Show the blink-config inputs whenever the object exists (even if
  // disabled), so the operator can leave saved color / duration / count
  // values intact while toggling the feature off and back on.
  const showBlinkConfig = !!blink;
  const presetKey = templateSizePresetKey(template.size);
  const [customSize, setCustomSize] = useState(false);
  const showCustom = customSize || presetKey === "custom";

  function setSize(w: number, h: number) {
    if (w === template.size.w && h === template.size.h) return;
    // Layers keep their positions; nothing is scaled.
    onCommit((d) => {
      d.size = { w, h };
    });
  }

  return (
    <div {...handlers}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: colors.textDim,
          marginBottom: 8,
        }}
      >
        Settings
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
        <span style={{ minWidth: 70 }}>Canvas</span>
        <select
          value={showCustom ? "custom" : presetKey}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "custom") {
              setCustomSize(true);
              return;
            }
            setCustomSize(false);
            const p = TEMPLATE_SIZE_PRESETS.find((s) => `${s.w}x${s.h}` === v);
            if (p) setSize(p.w, p.h);
          }}
          style={{ ...settingsInputStyle, width: "auto", flex: 1 }}
        >
          {TEMPLATE_SIZE_PRESETS.map((p) => (
            <option key={`${p.w}x${p.h}`} value={`${p.w}x${p.h}`}>
              {p.label}
            </option>
          ))}
          <option value="custom">Custom…</option>
        </select>
      </label>
      {showCustom && (
        <div style={{ display: "flex", gap: 8, marginTop: 6, marginLeft: 78 }}>
          <SizeInput label="W" value={template.size.w} onCommit={(w) => setSize(w, template.size.h)} />
          <SizeInput label="H" value={template.size.h} onCommit={(h) => setSize(template.size.w, h)} />
        </div>
      )}

      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, marginTop: 8 }}>
        <span style={{ minWidth: 70 }}>Auto-out</span>
        <input
          type="number"
          min={0}
          step={0.1}
          value={seconds === 0 ? "" : seconds}
          placeholder="off"
          onChange={(e) => {
            const v = e.target.value.trim();
            const next = v === "" ? undefined : Math.max(0, Math.round(Number(v) * 1000));
            onCommit((d) => {
              if (!next || next <= 0) {
                delete d.autoOutMs;
              } else {
                d.autoOutMs = next;
              }
            });
          }}
          title="Auto-clear this template N seconds after it's taken. Empty / 0 to disable."
          style={settingsInputStyle}
        />
        <span style={{ color: colors.textDim, fontSize: 11 }}>
          seconds {seconds > 0 ? "" : "(off)"}
        </span>
      </label>

      <label
        style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, marginTop: 8 }}
        title="Suggested channel — prefills the channel selector in the Take panel and channelHint when this template is added to a rundown."
      >
        <span style={{ minWidth: 70 }}>Default ch.</span>
        <select
          value={template.defaultChannel ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            onCommit((d) => {
              if (!v) delete d.defaultChannel;
              else d.defaultChannel = v;
            });
          }}
          style={{ ...settingsInputStyle, width: "auto", flex: 1 }}
        >
          <option value="">(none)</option>
          {/* Preserve out-of-list values rather than silently drop them when
              a previously-set channel was removed or became a mirror. */}
          {template.defaultChannel &&
            !channelChoices.some((c) => c.id === template.defaultChannel) && (
              <option value={template.defaultChannel}>
                {template.defaultChannel} (missing)
              </option>
            )}
          {channelChoices.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>

      <label
        style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, marginTop: 8 }}
        title="Flash a color overlay on each take. Re-taking the same template re-blinks; updates (same take) do not."
      >
        <input
          type="checkbox"
          checked={blink?.enabled ?? false}
          onChange={(e) => {
            const next = e.target.checked;
            onCommit((d) => {
              if (next) {
                // Seed defaults the first time the operator turns it on so
                // the renderer has a usable config without further input.
                if (!d.blinkOnTake) {
                  d.blinkOnTake = {
                    enabled: true,
                    color: "#ffffff",
                    durationMs: 500,
                    count: 2,
                  };
                } else {
                  d.blinkOnTake.enabled = true;
                }
              } else if (d.blinkOnTake) {
                d.blinkOnTake.enabled = false;
              }
            });
          }}
        />
        <span style={{ minWidth: 70 }}>Blink on take</span>
      </label>

      {showBlinkConfig && (
        <div
          style={{
            marginTop: 6,
            marginLeft: 22,
            display: "grid",
            gridTemplateColumns: "70px 1fr 1fr",
            gap: 6,
            alignItems: "center",
            fontSize: 12,
          }}
        >
          <span style={{ color: colors.textDim, fontSize: 11 }}>color</span>
          <input
            type="color"
            value={blink?.color ?? "#ffffff"}
            onChange={(e) => {
              const v = e.target.value;
              onCommit((d) => {
                if (!d.blinkOnTake) return;
                d.blinkOnTake.color = v;
              });
            }}
            style={{
              width: "100%",
              height: 24,
              padding: 0,
              border: `1px solid ${colors.border}`,
              borderRadius: 3,
              background: "transparent",
            }}
          />
          <input
            value={blink?.color ?? "#ffffff"}
            onChange={(e) => {
              const v = e.target.value;
              onCommit((d) => {
                if (!d.blinkOnTake) return;
                d.blinkOnTake.color = v;
              });
            }}
            style={{ ...settingsInputStyle, fontFamily: "ui-monospace, monospace" }}
          />

          <span style={{ color: colors.textDim, fontSize: 11 }}>duration</span>
          <input
            type="number"
            min={50}
            step={50}
            value={blink?.durationMs ?? 500}
            onChange={(e) => {
              const v = Math.max(50, Math.round(Number(e.target.value)));
              if (!Number.isFinite(v)) return;
              onCommit((d) => {
                if (!d.blinkOnTake) return;
                d.blinkOnTake.durationMs = v;
              });
            }}
            style={settingsInputStyle}
          />
          <span style={{ color: colors.textDim, fontSize: 11 }}>ms per cycle</span>

          <span style={{ color: colors.textDim, fontSize: 11 }}>count</span>
          <input
            type="number"
            min={1}
            max={20}
            step={1}
            value={blink?.count ?? 2}
            onChange={(e) => {
              const v = Math.max(1, Math.min(20, Math.round(Number(e.target.value))));
              if (!Number.isFinite(v)) return;
              onCommit((d) => {
                if (!d.blinkOnTake) return;
                d.blinkOnTake.count = v;
              });
            }}
            style={settingsInputStyle}
          />
          <span style={{ color: colors.textDim, fontSize: 11 }}>blinks</span>
        </div>
      )}

      <EmbeddedFonts template={template} onCommit={onCommit} />
    </div>
  );
}

/** Fonts embedded in the template JSON, with remove (they're never pruned otherwise). */
function EmbeddedFonts({ template, onCommit }: { template: Template; onCommit: (r: Recipe) => void }) {
  if (template.fonts.length === 0) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: colors.textDim, marginBottom: 6 }}>Embedded fonts</div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {template.fonts.map((f) => {
          const usedBy = fontUsage(template, f.family);
          return (
            <li key={f.family} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, marginBottom: 4 }}>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: f.family }}>
                {f.family}
              </span>
              {usedBy.length > 0 && (
                <span style={{ fontSize: 10, color: colors.textDim }} title={usedBy.join(", ")}>
                  used ×{usedBy.length}
                </span>
              )}
              <button
                type="button"
                onClick={() => onCommit(removeTemplateFont(f.family))}
                aria-label={`Remove font ${f.family}`}
                title={
                  usedBy.length > 0
                    ? `Remove — ${usedBy.join(", ")} will fall back to an installed font`
                    : "Remove font"
                }
                style={{ ...miniBtn, flex: "none", color: colors.danger }}
              >
                Remove
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Positive integer input that commits on blur or Enter. */
function SizeInput({ label, value, onCommit }: { label: string; value: number; onCommit: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  function commit() {
    const n = Math.round(Number(text));
    if (!Number.isFinite(n) || n <= 0) {
      setText(String(value));
      return;
    }
    if (n !== value) onCommit(n);
  }
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: colors.textDim }}>
      {label}
      <input
        type="number"
        min={1}
        step={1}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        style={{ ...settingsInputStyle, width: 72 }}
      />
    </label>
  );
}

const settingsInputStyle: React.CSSProperties = {
  width: 80,
  padding: "4px 6px",
  background: colors.panel,
  border: `1px solid ${colors.border}`,
  borderRadius: 3,
  color: colors.text,
  fontSize: 12,
};

/**
 * Flatten the template's layer tree into a list usable by a layer-picker
 * dropdown. Excludes the layer being edited so a layer can't reference
 * itself.
 */
function flattenLayers(layers: Layer[], excludeId: string): Array<{ id: string; name: string; type: Layer["type"] }> {
  const out: Array<{ id: string; name: string; type: Layer["type"] }> = [];
  function visit(l: Layer): void {
    if (l.id !== excludeId) out.push({ id: l.id, name: l.name, type: l.type });
    if (l.type === "group") for (const c of l.children) visit(c);
  }
  for (const l of layers) visit(l);
  return out;
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

function ClipBySection({
  template,
  selectedLayerId,
  onCommit,
}: {
  template: Template;
  selectedLayerId: string;
  onCommit: (recipe: Recipe) => void;
}) {
  const layer = findLayer(template.layers, selectedLayerId);
  if (!layer) return null;
  const candidates = flattenLayers(template.layers, selectedLayerId);
  const clipBy = layer.clipBy;

  function setClip(
    layerId: string | null,
    hide?: "inside" | "outside" | "above" | "below" | "left" | "right",
  ) {
    onCommit((d) => {
      const target = findLayerInDraft(d.layers, selectedLayerId);
      if (!target) return;
      if (!layerId) {
        delete target.clipBy;
        return;
      }
      target.clipBy = {
        layerId,
        hide: hide ?? target.clipBy?.hide ?? "inside",
      };
    });
  }

  return (
    <div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: colors.textDim,
          marginBottom: 8,
        }}
      >
        Clip by
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <select
          value={clipBy?.layerId ?? ""}
          onChange={(e) => setClip(e.target.value || null)}
          style={selectStyle}
          title="Reference layer whose bounding box defines a reveal edge for this layer."
        >
          <option value="">none</option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} ({c.type})
            </option>
          ))}
        </select>
        {clipBy && (
          <select
            value={clipBy.hide}
            onChange={(e) =>
              setClip(
                clipBy.layerId,
                e.target.value as "inside" | "outside" | "above" | "below" | "left" | "right",
              )
            }
            style={selectStyle}
            title="How the reference's bounding box masks this layer."
          >
            <option value="inside">hide where overlapping (inside)</option>
            <option value="outside">show only inside reference</option>
            <option value="below">half-plane: hide below</option>
            <option value="above">half-plane: hide above</option>
            <option value="right">half-plane: hide right</option>
            <option value="left">half-plane: hide left</option>
          </select>
        )}
        {clipBy && (
          <p style={{ margin: 0, fontSize: 11, color: colors.textDim, lineHeight: 1.4 }}>
            Set the reference layer to invisible (eye toggle in the Layers panel) to use it
            as a positional marker without rendering it.
          </p>
        )}
      </div>
    </div>
  );
}

function findLayerInDraft(layers: Draft<Layer>[], id: string): Draft<Layer> | null {
  for (const l of layers) {
    if (l.id === id) return l;
    if (l.type === "group") {
      const found = findLayerInDraft(l.children, id);
      if (found) return found;
    }
  }
  return null;
}

const selectStyle: React.CSSProperties = {
  padding: "4px 6px",
  background: colors.panel,
  border: `1px solid ${colors.border}`,
  borderRadius: 3,
  color: colors.text,
  fontSize: 12,
  width: "100%",
};

function LayersHint() {
  return (
    <span style={{ fontSize: 11, color: colors.textDim }}>
      drag to reorder · ⇧-click to multi-select
    </span>
  );
}

/**
 * Sidebar section for the design editor. Distinct from @overlaysys/ui Panel —
 * uses a small uppercase letterspaced title without a bordered card to fit
 * the editor's three-pane chrome.
 */
function EditorSection({
  title,
  subtitle,
  extra,
  children,
}: {
  title: string;
  subtitle?: string;
  extra?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section style={{ background: colors.panel, padding: 12, overflow: "auto", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "baseline", marginBottom: 8, gap: 6 }}>
        <h3
          style={{
            margin: 0,
            fontSize: 11,
            fontWeight: 600,
            color: colors.textDim,
          }}
        >
          {title}
        </h3>
        {subtitle && (
          <span style={{ fontSize: 11, color: colors.textDim, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            · {subtitle}
          </span>
        )}
        <div style={{ marginLeft: "auto" }}>{extra}</div>
      </div>
      {children}
    </section>
  );
}
