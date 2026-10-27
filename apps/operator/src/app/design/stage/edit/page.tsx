"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { v4 as uuid } from "uuid";
import {
  CURRENT_ITEM_TIMER_ID,
  STAGE_SAMPLE_KINDS,
  STAGE_SAMPLE_LABELS,
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
  StagePalette,
  StageWidgetList,
  isEditableTarget,
  moveInOrder,
} from "@overlaysys/editor-kit";
import { Button, colors } from "@overlaysys/ui";
import { useWs, getClient } from "@/lib/useWs";
import { useStore } from "@/lib/store";
import { useStageEditor } from "@/lib/stageEditorStore";
import {
  addWidget,
  alignWidgets,
  distributeWidgets,
  duplicateWidgets,
  nudgeWidgets,
  patchWidget,
  removeWidgets,
  toggleHidden,
  toggleLocked,
} from "@/lib/stageLayoutOps";
import {
  STAGE_SIZE_PRESETS,
  centeredRectAt,
  createTrailingThrottle,
  isLocalDraftEdit,
  shouldAdoptIncomingLayout,
  shouldConfirmLinkNavigation,
  sizePresetKey,
  stageEditorShortcut,
} from "@/lib/stageDesigner";
import { useResolvedChannelConfigs } from "@/lib/useResolvedChannels";
import { PageBody } from "@/app/components/PageShell";
import { PageChrome } from "@/app/shell/PageChrome";
import { isCloudMode } from "@/lib/mode";

const FEED_TICK_MS = 250;
const PREVIEW_THROTTLE_MS = 150;
const NOOP = () => {};
/** Delay before the one retry of a get_stage_layout that came back not_found. */
const NOT_FOUND_RETRY_MS = 300;
const UNSAVED_PROMPT = "You have unsaved changes to this stage layout. Leave anyway?";

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
      } else if (msg.type === "ack") {
        if (msg.op === "save_stage_layout" && msg.id === layoutId) {
          const sent = savingRef.current;
          savingRef.current = null;
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
        savingRef.current = null;
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

  // ---- Unsaved-changes guard ----
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    // In-app links (Next <Link>, sidebar) navigate client-side, so beforeunload
    // never fires: catch the click in the capture phase, before Next's handler.
    const onClick = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a) return;
      const ask = shouldConfirmLinkNavigation({
        dirty: useStageEditor.getState().dirty,
        href: a.getAttribute("href") ?? "",
        currentHref: window.location.href,
        button: e.button,
        modified: e.metaKey || e.ctrlKey || e.shiftKey || e.altKey,
        defaultPrevented: e.defaultPrevented,
        target: a.getAttribute("target"),
        download: a.hasAttribute("download"),
      });
      if (!ask || window.confirm(UNSAVED_PROMPT)) return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);

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

  function newWidgetId(kind: string): string {
    return `${kind}-${uuid().slice(0, 8)}`;
  }

  function addKind(kind: StageWidgetKind) {
    if (readOnly) return;
    const id = newWidgetId(kind);
    commit(addWidget(kind, id));
    select([id]);
  }

  function dropKind(kind: StageWidgetKind, point: { x: number; y: number }) {
    if (readOnly) return;
    const id = newWidgetId(kind);
    commit((d) => {
      addWidget(kind, id)(d);
      const w = d.widgets.find((x) => x.id === id);
      if (w) w.rect = centeredRectAt(point, w.rect.w, w.rect.h, d.size);
    });
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

  // ---- Keyboard ----
  const keyActions = useRef({ save, undo, redo, deleteSelection, duplicateSelection, readOnly });
  keyActions.current = { save, undo, redo, deleteSelection, duplicateSelection, readOnly };
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const action = stageEditorShortcut(e);
      if (!action) return;
      const a = keyActions.current;
      // Save works from inside an inspector input too, and must never fall
      // through to the browser's Save Page dialog.
      if (action === "save") {
        e.preventDefault();
        a.save();
        return;
      }
      if (isEditableTarget(e.target) || isEditableTarget(document.activeElement)) return;
      e.preventDefault();
      if (a.readOnly) return;
      if (action === "undo") a.undo();
      else if (action === "redo") a.redo();
      else if (action === "delete") a.deleteSelection();
      else if (action === "duplicate") a.duplicateSelection();
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

  return (
    <div style={{ height: "100%", display: "grid", gridTemplateRows: "auto auto minmax(0, 1fr)", overflow: "hidden" }}>
      <PageChrome
        title={draft.name}
        context={
          <>
            <span style={{ color: colors.textDim, fontSize: 11 }}>{draft.id}</span>
            {dirty && (
              <span style={{ color: colors.accent2, fontSize: 11, fontWeight: 600 }}>
                <span
                  aria-hidden
                  style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "currentColor", marginRight: 6, verticalAlign: "middle" }}
                />
                unsaved
              </span>
            )}
            {previewingNames.length > 0 && (
              <span style={{ color: colors.ok, fontSize: 11, fontWeight: 600 }}>Previewing on {previewingNames.join(", ")}</span>
            )}
          </>
        }
        actions={
          <>
            <Button onClick={undo} variant="ghost" size="sm" disabled={readOnly || !canUndo}>↶ Undo</Button>
            <Button onClick={redo} variant="ghost" size="sm" disabled={readOnly || !canRedo}>↷ Redo</Button>
            <Button onClick={revert} variant="ghost" size="sm" disabled={!dirty}>Revert</Button>
            <Button
              onClick={duplicateLayout}
              variant="ghost"
              size="sm"
              disabled={dirty || conn !== "open"}
              title={dirty ? "Save first — Duplicate copies the saved layout" : "Duplicate this layout"}
            >
              Duplicate
            </Button>
            <Button onClick={save} variant="primary" size="sm" disabled={readOnly || !dirty || conn !== "open"}>
              Save (⌘S)
            </Button>
          </>
        }
      />

      <Toolbar
        draft={draft}
        readOnly={readOnly}
        presetKey={presetKey}
        sampleKind={sampleKind}
        onSampleKind={setSampleKind}
        onCommit={commit}
        stageChannels={stageChannels}
        previewChannel={previewChannel}
        onPreviewChannel={setPreviewChannel}
        previewOn={previewOn}
        onPreviewOn={setPreviewOn}
        previewDisabled={conn !== "open" || stageChannels.length === 0}
      />

      <div style={{ minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
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
            <span>Built-in layout — Duplicate to edit</span>
            <Button onClick={duplicateLayout} variant="primary" size="sm" disabled={conn !== "open"}>Duplicate</Button>
          </div>
        )}
        {error && (
          <div style={{ padding: "6px 12px", fontSize: 12, color: colors.danger, borderBottom: `1px solid ${colors.border}` }}>{error}</div>
        )}

        <div
          style={{
            flex: 1,
            display: "grid",
            gridTemplateColumns: "240px minmax(0, 1fr) 300px",
            gap: 1,
            background: colors.border,
            minHeight: 0,
            overflow: "hidden",
          }}
        >
          <EditorSection title="Widgets">
            <fieldset disabled={readOnly} style={fieldsetStyle}>
              <StagePalette onAdd={addKind} />
            </fieldset>
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${colors.border}` }}>
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
            </div>
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
            onDropKind={dropKind}
          />

          <EditorSection title="Inspector">
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
  onDropKind,
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
  onDropKind: (kind: StageWidgetKind, point: { x: number; y: number }) => void;
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
        onDropWidget={readOnly ? undefined : onDropKind}
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
  stageChannels,
  previewChannel,
  onPreviewChannel,
  previewOn,
  onPreviewOn,
  previewDisabled,
}: {
  draft: StageLayout;
  readOnly: boolean;
  presetKey: string;
  sampleKind: StageSampleKind;
  onSampleKind: (k: StageSampleKind) => void;
  onCommit: (r: Recipe) => void;
  stageChannels: { id: string; name: string }[];
  previewChannel: string;
  onPreviewChannel: (id: string) => void;
  previewOn: boolean;
  onPreviewOn: (on: boolean) => void;
  previewDisabled: boolean;
}) {
  const [name, setName] = useState(draft.name);
  const [customOpen, setCustomOpen] = useState(false);
  const skipNameCommitRef = useRef(false);
  useEffect(() => setName(draft.name), [draft.name]);

  function commitName() {
    if (skipNameCommitRef.current) {
      // Escape: blur fires with the typed (stale) name; discard it.
      skipNameCommitRef.current = false;
      setName(draft.name);
      return;
    }
    const next = name.trim();
    if (!next || next === draft.name) {
      setName(draft.name);
      return;
    }
    onCommit((d) => {
      d.name = next;
    });
  }

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
        gap: 12,
        padding: "8px 12px",
        background: colors.surface,
        borderBottom: `1px solid ${colors.border}`,
        fontSize: 12,
      }}
    >
      <input
        value={name}
        disabled={readOnly}
        onChange={(e) => setName(e.target.value)}
        onBlur={commitName}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") {
            skipNameCommitRef.current = true;
            setName(draft.name);
            (e.target as HTMLInputElement).blur();
          }
        }}
        title="Layout name"
        style={{ ...inputStyle, width: 200, fontWeight: 600 }}
      />

      <label style={labelStyle}>
        Size
        <select
          value={showCustom ? "custom" : presetKey}
          disabled={readOnly}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "custom") {
              setCustomOpen(true);
              return;
            }
            setCustomOpen(false);
            const p = STAGE_SIZE_PRESETS.find((s) => `${s.w}x${s.h}` === v);
            if (p) setSize(p.w, p.h);
          }}
          style={inputStyle}
        >
          {STAGE_SIZE_PRESETS.map((p) => (
            <option key={`${p.w}x${p.h}`} value={`${p.w}x${p.h}`}>
              {p.w}×{p.h}
            </option>
          ))}
          <option value="custom">Custom…</option>
        </select>
      </label>
      {showCustom && (
        <>
          <SizeInput label="W" value={draft.size.w} disabled={readOnly} onCommit={(w) => setSize(w, draft.size.h)} />
          <SizeInput label="H" value={draft.size.h} disabled={readOnly} onCommit={(h) => setSize(draft.size.w, h)} />
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
        <select value={sampleKind} onChange={(e) => onSampleKind(e.target.value as StageSampleKind)} style={inputStyle}>
          {STAGE_SAMPLE_KINDS.map((k) => (
            <option key={k} value={k}>
              {STAGE_SAMPLE_LABELS[k]}
            </option>
          ))}
        </select>
      </label>

      <div style={{ ...labelStyle, marginLeft: "auto" }}>
        Preview on monitor
        <select
          value={previewChannel}
          disabled={stageChannels.length === 0}
          onChange={(e) => onPreviewChannel(e.target.value)}
          style={inputStyle}
        >
          {stageChannels.length === 0 && <option value="">No stage channels</option>}
          {stageChannels.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <input
            type="checkbox"
            checked={previewOn}
            disabled={previewDisabled && !previewOn}
            onChange={(e) => onPreviewOn(e.target.checked)}
          />
          {previewOn ? "On" : "Off"}
        </label>
      </div>
    </div>
  );
}

/** Positive integer input that commits on blur or Enter. */
function SizeInput({ label, value, disabled, onCommit }: { label: string; value: number; disabled: boolean; onCommit: (v: number) => void }) {
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
    <label style={labelStyle}>
      {label}
      <input
        type="number"
        min={1}
        step={1}
        value={text}
        disabled={disabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        style={{ ...inputStyle, width: 72 }}
      />
    </label>
  );
}

function EditorSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ background: colors.panel, padding: 12, overflow: "auto", minHeight: 0 }}>
      <h3 style={{ margin: "0 0 8px", fontSize: 11, fontWeight: 600, color: colors.textDim }}>{title}</h3>
      {children}
    </section>
  );
}

const fieldsetStyle: React.CSSProperties = { border: 0, padding: 0, margin: 0, minWidth: 0 };

const labelStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 6, color: colors.textDim };

const inputStyle: React.CSSProperties = {
  padding: "4px 6px",
  background: colors.panel,
  border: `1px solid ${colors.border}`,
  borderRadius: 3,
  color: colors.text,
  fontSize: 12,
};
