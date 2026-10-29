"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { v4 as uuid } from "uuid";
import { ChevronLeft, ChevronRight, Plus, Redo2, Undo2 } from "lucide-react";
import {
  CURRENT_ITEM_TIMER_ID,
  STAGE_SAMPLE_KINDS,
  STAGE_SAMPLE_LABELS,
  STAGE_WIDGET_LABELS,
  isBuiltInStageLayoutId,
  sampleStageFeed,
  type StageLayout,
  type StageSampleKind,
  type StageWidgetKind,
} from "@overlaysys/core";
import {
  ColorInput,
  StageCanvas,
  StageInspector,
  StageWidgetList,
  isEditableTarget,
  moveInOrder,
} from "@overlaysys/editor-kit";
import { Button, IconButton, Menu, NumberInput, Select, colors, toast, useConfirm, type MenuItem, type SaveBarProps } from "@overlaysys/ui";
import { useWs, getClient } from "@/lib/useWs";
import { useStore } from "@/lib/store";
import { useStageEditor } from "@/lib/stageEditorStore";
import {
  addWidgetOp,
  alignWidgets,
  distributeWidgets,
  duplicateWidgets,
  moveWidgetZ,
  nudgeWidgets,
  patchWidget,
  removeWidgets,
  toggleHidden,
  toggleLocked,
} from "@/lib/stageLayoutOps";
import {
  STAGE_SIZE_PRESETS,
  createTrailingThrottle,
  isLocalDraftEdit,
  sampleKindFor,
  stageLayoutUses,
  shouldAdoptIncomingLayout,
  sizePresetKey,
  stageEditorShortcut,
} from "@/lib/stageDesigner";
import { anythingOnAir } from "@/lib/onAir";
import { useConnection } from "@/lib/useConnection";
import { useResolvedChannelConfigs } from "@/lib/useResolvedChannels";
import { useUnsavedGuard } from "@/lib/useUnsavedGuard";
import { ackErrorText, sendAndAwaitAck } from "@/lib/awaitAck";
import { PageBody } from "@/app/components/PageShell";
import { PageChrome } from "@/app/shell/PageChrome";
import { isCloudMode } from "@/lib/mode";
import { StageEditorHeader } from "./StageEditorHeader";
import { StagePreviewSwitch } from "./StagePreviewSwitch";
import { StageStartDialog } from "./StageStartDialog";

const FEED_TICK_MS = 250;
const PREVIEW_THROTTLE_MS = 150;
const NOOP = () => {};
/** Delay before the one retry of a get_stage_layout that came back not_found. */
const NOT_FOUND_RETRY_MS = 300;
const UNSAVED_PROMPT = "You have unsaved changes to this stage layout.";
const RAIL_PX = 24;

export default function StageLayoutEditorPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24 }}>Loading…</div>}>
      <StageLayoutEditorInner />
    </Suspense>
  );
}

function StageLayoutEditorInner() {
  if (isCloudMode()) {
    return (
      <>
        <PageChrome title="Stage layout" />
        <PageBody>
          <p style={{ color: colors.textDim, marginTop: 12 }}>Stage layouts are available in the desktop app.</p>
        </PageBody>
      </>
    );
  }
  return <StageLayoutEditorRoute />;
}

function StageLayoutEditorRoute() {
  const searchParams = useSearchParams();
  if (searchParams?.get("new") === "1") return <StageStartDialog />;
  return <StageLayoutEditor />;
}

function StageLayoutEditor() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const layoutId = decodeURIComponent(searchParams?.get("id") ?? "");
  const { send } = useWs();
  const conn = useStore((s) => s.conn);
  const stageTimers = useStore((s) => s.stageTimers);
  const previews = useStore((s) => s.stageLayoutPreviews);
  const channelConfigs = useResolvedChannelConfigs();

  const draft = useStageEditor((s) => s.draft);
  const dirty = useStageEditor((s) => s.dirty);
  const selectedIds = useStageEditor((s) => s.selectedIds);
  const sampleKind = useStageEditor((s) => s.sampleKind);
  const canUndo = useStageEditor((s) => s.history.length > 0);
  const canRedo = useStageEditor((s) => s.redoStack.length > 0);
  const { setDraft, commit, applyLive, pushHistory, cancelDrag, undo, redo, markSaved, select, setSampleKind } =
    useStageEditor.getState();

  const [error, setError] = useState<string | null>(null);
  const [previewOn, setPreviewOn] = useState(false);
  const [saving, setSaving] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [addAnchor, setAddAnchor] = useState<HTMLElement | null>(null);
  /** Channels with a stage screen attached, from the server's status broadcasts; null until one arrives. */
  const [screenChannels, setScreenChannels] = useState<Set<string> | null>(null);
  const channelStates = useStore((s) => s.channelStates);
  const show = useStore((s) => s.show);
  const { connected } = useConnection();
  const confirmDialog = useConfirm();
  const [previewChannel, setPreviewChannel] = useState("");
  const fetchedRef = useRef<string | null>(null);
  const savingRef = useRef<StageLayout | null>(null);
  /** Id whose save was acked; its broadcast echo must not reset history. */
  const awaitingEchoRef = useRef<string | null>(null);
  const duplicateRef = useRef<{ pending: boolean; copyId: string | null }>({ pending: false, copyId: null });

  const readOnly = !!draft && (draft.builtIn === true || isBuiltInStageLayoutId(draft.id));

  const stageChannels = useMemo(() => channelConfigs.filter((c) => c.kind === "stage"), [channelConfigs]);
  const channelChoices = useMemo(
    () => channelConfigs.filter((c) => c.kind !== "stage" && !c.mirrorOf).map((c) => ({ id: c.id, name: c.name })),
    [channelConfigs],
  );
  const timerChoices = useMemo(
    () => stageTimers.filter((t) => t.id !== CURRENT_ITEM_TIMER_ID).map((t) => ({ id: t.id, label: t.label })),
    [stageTimers],
  );

  // Keep the preview channel pointing at an existing stage channel.
  useEffect(() => {
    if (stageChannels.some((c) => c.id === previewChannel)) return;
    setPreviewChannel(stageChannels[0]?.id ?? "");
  }, [stageChannels, previewChannel]);

  // ---- Loading, save acks, duplicate routing ----
  useEffect(() => {
    fetchedRef.current = null;
    awaitingEchoRef.current = null;
    setDraft(null);
    setError(null);
    const notFound = `Layout "${layoutId}" not found.`;
    // Create-then-route can open the editor before the new layout is
    // readable: retry the fetch once before reporting it missing.
    let retried = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const off = getClient().on((msg) => {
      if (msg.type === "stage_layout") {
        const dup = duplicateRef.current;
        if (dup.copyId && msg.layout.id === dup.copyId) {
          duplicateRef.current = { pending: false, copyId: null };
          router.push(`/design/stage/edit?id=${encodeURIComponent(msg.layout.id)}`);
          return;
        }
        if (msg.layout.id !== layoutId) return;
        const st = useStageEditor.getState();
        const adopt = shouldAdoptIncomingLayout(
          { draft: st.draft, dirty: st.dirty, awaitingEchoId: awaitingEchoRef.current },
          msg.layout,
        );
        if (awaitingEchoRef.current === msg.layout.id) awaitingEchoRef.current = null;
        if (adopt) {
          setDraft(msg.layout);
          setError((e) => (e === notFound ? null : e));
        }
      } else if (msg.type === "stage_layout_status") {
        setScreenChannels(new Set(msg.screens.map((x) => x.channel)));
      } else if (msg.type === "ack") {
        if (msg.op === "save_stage_layout" && msg.id === layoutId) {
          const sent = savingRef.current;
          savingRef.current = null;
          setSaving(false);
          if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
          awaitingEchoRef.current = msg.id;
          // Edits made while the save was in flight stay unsaved.
          if (sent && useStageEditor.getState().draft === sent) markSaved();
          // The server dropped the preview of this layout on save.
          setPreviewOn(false);
          setError(null);
        } else if (msg.op === "duplicate_stage_layout" && duplicateRef.current.pending && msg.id) {
          duplicateRef.current = { pending: false, copyId: msg.id };
        }
      } else if (msg.type === "error" && msg.message === layoutId) {
        if (msg.code === "not_found" && !retried) {
          retried = true;
          retryTimer = setTimeout(() => send({ type: "get_stage_layout", layoutId }), NOT_FOUND_RETRY_MS);
        } else if (msg.code === "not_found") setError(notFound);
        else if (msg.code === "read_only") setError("Built-in layouts are read-only. Duplicate to edit.");
        if (savingRef.current) toast({ tone: "error", message: "Not saved: the server rejected this layout." });
        savingRef.current = null;
        setSaving(false);
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        duplicateRef.current = { pending: false, copyId: null };
      }
    });
    return () => {
      off();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [layoutId, setDraft, markSaved, router, send]);

  useEffect(() => {
    if (conn !== "open") return;
    if (fetchedRef.current === layoutId) return;
    fetchedRef.current = layoutId;
    send({ type: "get_stage_layout", layoutId });
  }, [conn, layoutId, send]);

  // Pick the sample feed that suits the layout once per opened layout.
  const sampledForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!draft || draft.id !== layoutId || sampledForRef.current === layoutId) return;
    sampledForRef.current = layoutId;
    setSampleKind(sampleKindFor(draft));
  }, [draft, layoutId, setSampleKind]);

  // ---- Unsaved-changes guard ----
  // On the first render after an in-place layout switch, `dirty` still
  // belongs to the previous draft; arming then would push a sentinel at the
  // new URL (and drop Forward history) for no unsaved work.
  const draftId = draft?.id ?? null;
  useUnsavedGuard(dirty, {
    message: UNSAVED_PROMPT,
    getDirty: () => useStageEditor.getState().dirty,
    resetKey: layoutId,
    canArm: draftId === layoutId,
  });

  // A local edit means any save echo we were waiting for is moot (the draft is
  // dirty, so it won't be adopted anyway); drop the marker so a broadcast that
  // never arrives can't swallow a later get_stage_layout reply. Every edit
  // counts, not just clean→dirty: edits made while a save was in flight leave
  // the draft dirty through the ack.
  useEffect(
    () =>
      useStageEditor.subscribe((next, prev) => {
        if (isLocalDraftEdit(prev, next)) awaitingEchoRef.current = null;
      }),
    [],
  );

  // ---- Preview on monitor ----
  const lastPreviewRef = useRef<{ channel: string; layout: StageLayout } | null>(null);
  const previewThrottle = useMemo(
    () =>
      createTrailingThrottle((channel: string, layout: StageLayout) => {
        lastPreviewRef.current = { channel, layout };
        send({ type: "stage_layout_preview", channel, layout });
      }, PREVIEW_THROTTLE_MS),
    [send],
  );

  // On toggle-on, channel change or reconnect: send now (through the throttle,
  // so it fires at once when idle and the next edit still waits its 150 ms).
  // Cleanup (toggle-off, channel change, unmount) clears the old channel's preview.
  useEffect(() => {
    if (!previewOn || !previewChannel || conn !== "open") return;
    const cur = useStageEditor.getState().draft;
    if (cur) previewThrottle.call(previewChannel, cur);
    return () => {
      previewThrottle.cancel();
      lastPreviewRef.current = null;
      send({ type: "stage_layout_preview", channel: previewChannel, layout: null });
    };
  }, [previewOn, previewChannel, conn, send, previewThrottle]);

  // After every draft change, throttled.
  useEffect(() => {
    if (!previewOn || !previewChannel || conn !== "open" || !draft) return;
    const last = lastPreviewRef.current;
    if (last && last.channel === previewChannel && last.layout === draft) return;
    previewThrottle.call(previewChannel, draft);
  }, [draft, previewOn, previewChannel, conn, previewThrottle]);

  const previewingNames = draft
    ? previews
        .filter((p) => p.layoutId === draft.id)
        .map((p) => stageChannels.find((c) => c.id === p.channel)?.name ?? p.channel)
    : [];

  // ---- Actions ----
  function save() {
    const cur = useStageEditor.getState().draft;
    if (!cur || readOnly || conn !== "open") return;
    savingRef.current = cur;
    setSaving(true);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    // No ack in time: stop showing "Saving" so the operator can retry.
    saveTimerRef.current = setTimeout(() => {
      if (savingRef.current !== cur) return;
      savingRef.current = null;
      setSaving(false);
      toast({ tone: "error", message: "Not saved: the server didn't confirm in time." });
    }, 8000);
    send({ type: "save_stage_layout", layout: cur });
  }

  function revert() {
    // The reply to this fetch must be adopted even if a save echo never came.
    awaitingEchoRef.current = null;
    setDraft(null);
    send({ type: "get_stage_layout", layoutId });
    fetchedRef.current = layoutId;
  }

  function duplicateLayout() {
    // Duplicate copies the stored layout, so unsaved edits would be lost.
    if (!draft || dirty || conn !== "open") return;
    duplicateRef.current = { pending: true, copyId: null };
    send({ type: "duplicate_stage_layout", layoutId: draft.id });
  }

  async function deleteLayout() {
    if (!draft || readOnly || conn !== "open") return;
    const uses = stageLayoutUses(
      draft.id,
      channelConfigs,
      (show?.rows ?? []).map((r, i) => ({ id: r.id, title: `${r.kind} ${i + 1}`, stageLayouts: "stageLayouts" in r ? r.stageLayouts : undefined })),
    );
    const ok = await confirmDialog({
      title: uses.length > 0 ? `Delete ${draft.name}? It is in use` : `Delete ${draft.name}?`,
      message:
        uses.length > 0 ? (
          <div>
            <p style={{ margin: "0 0 6px" }}>These will fall back to the default layout:</p>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {uses.map((u) => (
                <li key={u}>{u}</li>
              ))}
            </ul>
          </div>
        ) : (
          "This stage layout is removed for good."
        ),
      confirmLabel: "Delete",
      danger: true,
    });
    if (!ok) return;
    try {
      await sendAndAwaitAck(getClient(), { type: "delete_stage_layout", layoutId: draft.id }, { op: "delete_stage_layout", id: draft.id });
    } catch (e) {
      toast({ tone: "error", message: `Not deleted: ${ackErrorText(e)}` });
      return;
    }
    // Deleted: nothing left to guard.
    markSaved();
    router.push("/design?tab=stage");
  }

  function newWidgetId(kind: string): string {
    return `${kind}-${uuid().slice(0, 8)}`;
  }

  function addKind(kind: StageWidgetKind) {
    if (readOnly) return;
    const id = newWidgetId(kind);
    commit(addWidgetOp(kind, id));
    select([id]);
  }

  function deleteSelection() {
    const ids = useStageEditor.getState().selectedIds;
    if (readOnly || ids.length === 0) return;
    commit(removeWidgets(ids));
  }

  function duplicateSelection() {
    const st = useStageEditor.getState();
    if (readOnly || !st.draft || st.selectedIds.length === 0) return;
    const created: string[] = [];
    const kindOf = new Map(st.draft.widgets.map((w) => [w.id, w.kind]));
    commit(
      duplicateWidgets(st.selectedIds, (old) => {
        const id = newWidgetId(kindOf.get(old) ?? "widget");
        created.push(id);
        return id;
      }),
    );
    select(created);
  }

  /** Step every selected widget in z-order (array order, last on top). */
  function moveSelectionZ(to: "up" | "down" | "top" | "bottom") {
    const st = useStageEditor.getState();
    if (readOnly || !st.draft || st.selectedIds.length === 0) return;
    const index = new Map(st.draft.widgets.map((w, i) => [w.id, i]));
    // Lead with the widget nearest the destination so they don't leapfrog.
    const ids = [...st.selectedIds].sort((a, b) =>
      to === "up" || to === "top" ? index.get(b)! - index.get(a)! : index.get(a)! - index.get(b)!,
    );
    commit((d) => {
      for (const id of ids) moveWidgetZ(id, to)(d);
    });
  }

  // ---- Keyboard ----
  const keyActions = useRef({ save, undo, redo, deleteSelection, duplicateSelection, moveSelectionZ, readOnly });
  keyActions.current = { save, undo, redo, deleteSelection, duplicateSelection, moveSelectionZ, readOnly };
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const action = stageEditorShortcut(e);
      if (!action) return;
      const a = keyActions.current;
      // Save works from inside an inspector input too, and must never fall
      // through to the browser's Save Page dialog.
      if (action === "save") {
        // The SaveBar's own ⌘S handler saves; only block the browser dialog here.
        e.preventDefault();
        return;
      }
      if (isEditableTarget(e.target) || isEditableTarget(document.activeElement)) return;
      e.preventDefault();
      if (a.readOnly) return;
      if (action === "undo") a.undo();
      else if (action === "redo") a.redo();
      else if (action === "delete") a.deleteSelection();
      else if (action === "duplicate") a.duplicateSelection();
      else if (action === "forward") a.moveSelectionZ("up");
      else if (action === "backward") a.moveSelectionZ("down");
      else if (action === "front") a.moveSelectionZ("top");
      else if (action === "back") a.moveSelectionZ("bottom");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!draft) {
    return (
      <>
        <PageChrome title="Stage layout" />
        <PageBody style={{ height: "100%" }}>
          <p style={{ color: error ? colors.danger : colors.textDim, marginTop: 12 }}>
            {error ?? (
              <>
                Loading stage layout <code>{layoutId}</code>…
              </>
            )}
          </p>
        </PageBody>
      </>
    );
  }

  const presetKey = sizePresetKey(draft.size);
  const showLive = anythingOnAir(channelStates);
  // Unknown until the first status broadcast: assume the monitor is in use.
  const channelInUse = screenChannels === null ? true : screenChannels.has(previewChannel);
  const bar: SaveBarProps = {
    dirty,
    saving,
    onSave: save,
    onRevert: revert,
    ...(connected ? {} : { disabledReason: "Reconnect to save" }),
  };
  const addItems: MenuItem[] = (Object.keys(STAGE_WIDGET_LABELS) as StageWidgetKind[]).map((kind) => ({
    id: kind,
    label: STAGE_WIDGET_LABELS[kind],
    onSelect: () => addKind(kind),
  }));
  const duplicateDisabled: boolean | string = dirty ? "Save first. Duplicate copies the saved layout." : conn !== "open" ? "Reconnect to duplicate" : false;

  return (
    // PageChrome renders into the shell (returns null): the title, then the editor.
    <div style={{ height: "100%", display: "grid", gridTemplateRows: "auto minmax(0, 1fr)", overflow: "hidden" }}>
      <PageChrome
        title={draft.name}
        context={
          previewingNames.length > 0 ? (
            <span style={{ color: colors.ok, fontSize: 11, fontWeight: 600 }}>Previewing on {previewingNames.join(", ")}</span>
          ) : undefined
        }
      />

      <div style={{ padding: "8px 12px", background: colors.surface, borderBottom: `1px solid ${colors.border}` }}>
        <StageEditorHeader
          name={draft.name}
          readOnly={readOnly}
          onRename={(name) =>
            commit((d) => {
              d.name = name;
            })
          }
          bar={bar}
          onDuplicate={duplicateLayout}
          duplicateDisabled={duplicateDisabled}
          onDelete={() => void deleteLayout()}
          deleteDisabled={readOnly ? "Built-in layouts can't be deleted" : conn !== "open" ? "Reconnect to delete" : false}
        />
      </div>

      <div style={{ minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <Toolbar
          draft={draft}
          readOnly={readOnly}
          presetKey={presetKey}
          sampleKind={sampleKind}
          onSampleKind={setSampleKind}
          onCommit={commit}
          onAddClick={(el) => setAddAnchor(el)}
          onUndo={undo}
          onRedo={redo}
          canUndo={canUndo}
          canRedo={canRedo}
          preview={
            <StagePreviewSwitch
              channels={stageChannels}
              channelId={previewChannel}
              onChannel={(id) => {
                // A new monitor needs its own confirm: never move a draft to it silently.
                setPreviewOn(false);
                setPreviewChannel(id);
              }}
              on={previewOn}
              onChange={setPreviewOn}
              disabled={conn !== "open" || stageChannels.length === 0}
              showLive={showLive}
              channelInUse={channelInUse}
            />
          }
        />
        {addAnchor && !readOnly && <Menu items={addItems} anchor={addAnchor} onClose={() => setAddAnchor(null)} />}

        {readOnly && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "6px 12px",
              fontSize: 12,
              background: colors.surface2,
              borderBottom: `1px solid ${colors.border}`,
            }}
          >
            <span>Built-in layout. Duplicate to edit.</span>
            <Button onClick={duplicateLayout} variant="primary" size="sm" disabled={conn !== "open"}>
              Duplicate to edit
            </Button>
          </div>
        )}
        {error && (
          <div style={{ padding: "6px 12px", fontSize: 12, color: colors.danger, borderBottom: `1px solid ${colors.border}` }}>{error}</div>
        )}

        <div
          style={{
            flex: 1,
            display: "grid",
            gridTemplateColumns: `220px minmax(0, 1fr) ${inspectorOpen ? 300 : RAIL_PX}px`,
            gap: 1,
            background: colors.border,
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          <EditorSection title="Widgets">
            <fieldset disabled={readOnly} style={fieldsetStyle}>
              <StageWidgetList
                layout={draft}
                selectedIds={selectedIds}
                onSelect={(id, additive) => select([id], additive)}
                onReorder={(id, to) => {
                  if (readOnly) return;
                  commit((d) => {
                    d.widgets = moveInOrder(d.widgets, id, to);
                  });
                }}
                onToggleHidden={(id) => !readOnly && commit(toggleHidden(id))}
                onToggleLocked={(id) => !readOnly && commit(toggleLocked(id))}
              />
            </fieldset>
          </EditorSection>

          <CanvasPane
            draft={draft}
            sampleKind={sampleKind}
            selectedIds={selectedIds}
            readOnly={readOnly}
            onSelect={select}
            onLive={applyLive}
            onPushHistory={pushHistory}
            onCancelDrag={cancelDrag}
            onNudge={(dx, dy) => commit(nudgeWidgets(useStageEditor.getState().selectedIds, dx, dy))}
          />

          {inspectorOpen ? (
            <EditorSection
              title="Inspector"
              action={
                <IconButton size={24} aria-label="Collapse inspector" onClick={() => setInspectorOpen(false)}>
                  <ChevronRight size={14} aria-hidden />
                </IconButton>
              }
            >
              <fieldset disabled={readOnly} style={fieldsetStyle}>
                <StageInspector
                  layout={draft}
                  selectedIds={selectedIds}
                  onPatch={(id, patch) => !readOnly && commit(patchWidget(id, patch))}
                  onAlign={(mode) => !readOnly && commit(alignWidgets(useStageEditor.getState().selectedIds, mode))}
                  onDistribute={(axis) => !readOnly && commit(distributeWidgets(useStageEditor.getState().selectedIds, axis))}
                  timerChoices={timerChoices}
                  channelChoices={channelChoices}
                />
              </fieldset>
            </EditorSection>
          ) : (
            <div style={{ background: colors.panel, display: "flex", justifyContent: "center", paddingTop: 8 }}>
              <IconButton size={24} aria-label="Expand inspector" onClick={() => setInspectorOpen(true)}>
                <ChevronLeft size={14} aria-hidden />
              </IconButton>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type Recipe = Parameters<ReturnType<typeof useStageEditor.getState>["commit"]>[0];

/**
 * The canvas re-renders on its own 250 ms tick, so clocks and timers move in
 * the sample feed without re-rendering the rest of the page.
 */
function CanvasPane({
  draft,
  sampleKind,
  selectedIds,
  readOnly,
  onSelect,
  onLive,
  onPushHistory,
  onCancelDrag,
  onNudge,
}: {
  draft: StageLayout;
  sampleKind: StageSampleKind;
  selectedIds: string[];
  readOnly: boolean;
  onSelect: (ids: string[], additive: boolean) => void;
  onLive: (r: Recipe) => void;
  onPushHistory: () => void;
  onCancelDrag: () => void;
  onNudge: (dx: number, dy: number) => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), FEED_TICK_MS);
    return () => clearInterval(t);
  }, []);
  const feed = useMemo(() => sampleStageFeed(sampleKind, draft, now), [sampleKind, draft, now]);

  return (
    <div style={{ background: colors.bg, minWidth: 0, minHeight: 0, overflow: "hidden" }}>
      <StageCanvas
        layout={draft}
        feed={feed}
        nowMs={now}
        selectedIds={selectedIds}
        onSelect={onSelect}
        onLive={readOnly ? NOOP : onLive}
        onPushHistory={readOnly ? NOOP : onPushHistory}
        onCancelDrag={readOnly ? NOOP : onCancelDrag}
        onNudge={readOnly ? NOOP : onNudge}
      />
    </div>
  );
}

function Toolbar({
  draft,
  readOnly,
  presetKey,
  sampleKind,
  onSampleKind,
  onCommit,
  onAddClick,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  preview,
}: {
  draft: StageLayout;
  readOnly: boolean;
  presetKey: string;
  sampleKind: StageSampleKind;
  onSampleKind: (k: StageSampleKind) => void;
  onCommit: (r: Recipe) => void;
  onAddClick: (el: HTMLElement) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  preview: React.ReactNode;
}) {
  const [customOpen, setCustomOpen] = useState(false);

  function setSize(w: number, h: number) {
    if (w === draft.size.w && h === draft.size.h) return;
    // Changing the size doesn't move or scale widgets.
    onCommit((d) => {
      d.size = { w, h };
    });
  }

  const showCustom = customOpen || presetKey === "custom";

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "6px 12px",
        padding: "6px 12px",
        background: colors.surface,
        borderBottom: `1px solid ${colors.border}`,
        fontSize: 12,
      }}
    >
      {!readOnly && (
        <Button size="sm" icon={<Plus size={12} aria-hidden />} onClick={(e) => onAddClick(e.currentTarget)}>
          Add
        </Button>
      )}
      <div style={{ display: "flex", gap: 2 }}>
        <IconButton aria-label="Undo" disabled={readOnly || !canUndo} onClick={onUndo}>
          <Undo2 size={14} aria-hidden />
        </IconButton>
        <IconButton aria-label="Redo" disabled={readOnly || !canRedo} onClick={onRedo}>
          <Redo2 size={14} aria-hidden />
        </IconButton>
      </div>

      <label style={labelStyle}>
        Size
        <span style={{ width: 120 }}>
          <Select
            value={showCustom ? "custom" : presetKey}
            disabled={readOnly}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "custom") {
                setCustomOpen(true);
                return;
              }
              setCustomOpen(false);
              const p = STAGE_SIZE_PRESETS.find((x) => `${x.w}x${x.h}` === v);
              if (p) setSize(p.w, p.h);
            }}
          >
            {STAGE_SIZE_PRESETS.map((p) => (
              <option key={`${p.w}x${p.h}`} value={`${p.w}x${p.h}`}>
                {p.w}×{p.h}
              </option>
            ))}
            <option value="custom">Custom…</option>
          </Select>
        </span>
      </label>
      {showCustom && (
        <>
          <label style={labelStyle}>
            W
            <span style={{ width: 80 }}>
              <NumberInput aria-label="Width" value={draft.size.w} int min={1} disabled={readOnly} onCommit={(w) => setSize(w, draft.size.h)} />
            </span>
          </label>
          <label style={labelStyle}>
            H
            <span style={{ width: 80 }}>
              <NumberInput aria-label="Height" value={draft.size.h} int min={1} disabled={readOnly} onCommit={(h) => setSize(draft.size.w, h)} />
            </span>
          </label>
        </>
      )}

      <label style={labelStyle}>
        Background
        <fieldset disabled={readOnly} style={{ ...fieldsetStyle, width: 140 }}>
          <ColorInput
            value={draft.background}
            onChange={(v) =>
              onCommit((d) => {
                d.background = v;
              })
            }
          />
        </fieldset>
      </label>

      <label style={labelStyle}>
        Sample
        <span style={{ width: 130 }}>
          <Select value={sampleKind} onChange={(e) => onSampleKind(e.target.value as StageSampleKind)}>
            {STAGE_SAMPLE_KINDS.map((k) => (
              <option key={k} value={k}>
                {STAGE_SAMPLE_LABELS[k]}
              </option>
            ))}
          </Select>
        </span>
      </label>

      <div style={{ marginLeft: "auto" }}>{preview}</div>
    </div>
  );
}

function EditorSection({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section style={{ background: colors.panel, padding: 12, overflow: "auto", minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "0 0 8px" }}>
        <h3 style={{ margin: 0, fontSize: 11, fontWeight: 600, color: colors.textDim }}>{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

const fieldsetStyle: React.CSSProperties = { border: 0, padding: 0, margin: 0, minWidth: 0 };

const labelStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 6, color: colors.textDim, whiteSpace: "nowrap" };
