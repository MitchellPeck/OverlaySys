"use client";

import { Suspense, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import {
  Canvas,
  LayerTree,
  PropertyInspector,
  TimelinePanel,
  FieldsPanel,
} from "@overlaysys/editor-kit";
import type { Draft } from "immer";
import type { Layer, Template } from "@overlaysys/core";
import { Button, colors } from "@overlaysys/ui";
import { useWs, getClient } from "@/lib/useWs";
import { useStore } from "@/lib/store";
import { useEditor } from "@/lib/editorStore";
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

const uploadInspector = async (file: File): Promise<string> =>
  (await uploadAsset(file)).url;

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
  const activeTimeline = useEditor((s) => s.activeTimeline);
  const scrubTime = useEditor((s) => s.scrubTime);
  const playing = useEditor((s) => s.playing);
  const loop = useEditor((s) => s.loop);
  const selectedKeyframe = useEditor((s) => s.selectedKeyframe);
  const setDraft = useEditor((s) => s.setDraft);
  const commit = useEditor((s) => s.commit);
  const applyLive = useEditor((s) => s.applyLive);
  const pushHistory = useEditor((s) => s.pushHistory);
  const setSelectedLayer = useEditor((s) => s.setSelectedLayer);
  const setSelectedKeyframe = useEditor((s) => s.setSelectedKeyframe);
  const setActiveTimeline = useEditor((s) => s.setActiveTimeline);
  const setScrubTime = useEditor((s) => s.setScrubTime);
  const setPlaying = useEditor((s) => s.setPlaying);
  const setLoop = useEditor((s) => s.setLoop);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const markSaved = useEditor((s) => s.markSaved);

  const fetchedRef = useRef<string | null>(null);
  const playRafRef = useRef<number | null>(null);
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

  useEffect(() => {
    fetchedRef.current = null;
    setDraft(null);
    if (cloud) return;
    const off = getClient().on((msg) => {
      if (msg.type === "template" && msg.template.id === templateId) {
        if (!useEditor.getState().dirty) setDraft(msg.template);
      }
    });
    return off;
  }, [templateId, setDraft, cloud]);

  useEffect(() => {
    if (cloud) {
      if (fetchedRef.current === templateId) return;
      fetchedRef.current = templateId;
      getTemplateCloud(templateId)
        .then((t) => {
          if (t) setDraft(t);
        })
        .catch((err) => console.warn("[design/edit] cloud load failed", err));
      return;
    }
    if (conn !== "open") return;
    if (fetchedRef.current === templateId) return;
    fetchedRef.current = templateId;
    send({ type: "get_template", templateId });
  }, [cloud, conn, templateId, send, setDraft]);

  const previewData = useMemo<Record<string, string>>(() => {
    if (!draft) return {};
    const out: Record<string, string> = {};
    for (const f of draft.fields) out[f.key] = f.default ?? `[${f.label}]`;
    return out;
  }, [draft]);

  function play() {
    if (!draft) return;
    if (playRafRef.current) cancelAnimationFrame(playRafRef.current);
    setPlaying(true);
    const dur = draft.timelines[activeTimeline].duration;
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

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.code === "KeyZ" && !e.shiftKey) {
        e.preventDefault();
        undo();
      } else if (meta && (e.code === "KeyY" || (e.code === "KeyZ" && e.shiftKey))) {
        e.preventDefault();
        redo();
      } else if (meta && e.code === "KeyS") {
        e.preventDefault();
        save();
      } else if (e.code === "Space") {
        e.preventDefault();
        if (playing) pause();
        else play();
      } else if (e.code === "Home") {
        e.preventDefault();
        if (playing) pause();
        setScrubTime(0);
      } else if (e.code === "End") {
        e.preventDefault();
        if (playing) pause();
        const dur = useEditor.getState().draft?.timelines[useEditor.getState().activeTimeline].duration ?? 0;
        setScrubTime(dur);
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        if (playing) pause();
        const cur = useEditor.getState().scrubTime;
        setScrubTime(Math.max(0, cur - 1 / 30));
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        if (playing) pause();
        const dur = useEditor.getState().draft?.timelines[useEditor.getState().activeTimeline].duration ?? 0;
        const cur = useEditor.getState().scrubTime;
        setScrubTime(Math.min(dur, cur + 1 / 30));
      } else if ((e.code === "Delete" || e.code === "Backspace") && useEditor.getState().selectedKeyframe) {
        e.preventDefault();
        const sel = useEditor.getState().selectedKeyframe!;
        commit((d) => {
          const tl = d.timelines[useEditor.getState().activeTimeline];
          for (const t of tl.tracks) {
            const key = `${t.layerId}::${t.property}`;
            if (key === sel.trackKey) t.keyframes.splice(sel.index, 1);
          }
        });
        setSelectedKeyframe(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  async function save() {
    const cur = useEditor.getState().draft;
    if (!cur) return;
    if (cloud) {
      try {
        await saveTemplateCloud(cur);
        await refreshTemplateMetasCloud();
        markSaved();
      } catch (err) {
        await showCloudError("save", err);
      }
      return;
    }
    send({ type: "save_template", template: cur });
    markSaved();
  }

  async function revert() {
    fetchedRef.current = null;
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
    send({ type: "get_template", templateId });
  }

  if (!draft) {
    return (
      <>
        <PageChrome />
        <PageBody style={{ height: "100%" }}>
          <p style={{ color: colors.textDim, marginTop: 12 }}>
            Loading template <code>{templateId}</code>…
          </p>
        </PageBody>
      </>
    );
  }

  return (
    <div
      style={{
        height: "100%",
        display: "grid",
        gridTemplateRows: "minmax(0, 1fr) 280px",
        overflow: "hidden",
      }}
    >
      <PageChrome
        context={
          <>
            <input
              value={draft.name}
              onChange={(e) => commit((d) => { d.name = e.target.value; })}
              title="Template name"
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
            {dirty && <span style={{ color: colors.accent2, fontSize: 11, fontWeight: 600 }}>● unsaved</span>}
          </>
        }
        actions={
          <>
            <Button onClick={undo} variant="ghost" size="sm">↶ Undo</Button>
            <Button onClick={redo} variant="ghost" size="sm">↷ Redo</Button>
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
        <EditorSection title="Layers" extra={<FieldsLink />}>
          <LayerTree
            template={draft}
            selectedId={selectedLayerId}
            onSelect={setSelectedLayer}
            onCommit={commit}
          />
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: `1px solid ${colors.border}` }}>
            <TemplateSettings template={draft} onCommit={commit} />
          </div>
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: `1px solid ${colors.border}` }}>
            <FieldsPanel template={draft} onCommit={commit} onUpload={uploadInspector} />
          </div>
        </EditorSection>

        <div style={{ background: "var(--bg)", minWidth: 0, minHeight: 0, overflow: "hidden" }}>
          <Canvas
            template={draft}
            data={previewData}
            selectedLayerId={selectedLayerId}
            onSelectLayer={setSelectedLayer}
            scrub={{ timeline: activeTimeline, time: scrubTime }}
            onCommit={commit}
            onLive={applyLive}
            onPushHistory={pushHistory}
          />
        </div>

        <EditorSection title="Inspector" subtitle={selectedLayerId ?? "no selection"}>
          <PropertyInspector
            template={draft}
            selectedId={selectedLayerId}
            onCommit={commit}
            onPushHistory={pushHistory}
            onUpload={uploadInspector}
          />
          {selectedLayerId && (
            <div style={{ marginTop: 16, paddingTop: 12, borderTop: `1px solid ${colors.border}` }}>
              <ClipBySection
                template={draft}
                selectedLayerId={selectedLayerId}
                onCommit={commit}
              />
            </div>
          )}
        </EditorSection>
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

function TemplateSettings({
  template,
  onCommit,
}: {
  template: Template;
  onCommit: (recipe: (d: Draft<Template>) => void) => void;
}) {
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
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          color: colors.textDim,
          textTransform: "uppercase",
          letterSpacing: 1.2,
          marginBottom: 8,
        }}
      >
        Settings
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
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
    </div>
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
  onCommit: (recipe: (d: Draft<Template>) => void) => void;
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
          color: colors.textDim,
          textTransform: "uppercase",
          letterSpacing: 1.2,
          marginBottom: 8,
        }}
      >
        Clip By
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

function FieldsLink() {
  return (
    <span style={{ fontSize: 11, color: colors.textDim }}>
      drag to reorder · 👁 to hide
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
            textTransform: "uppercase",
            letterSpacing: 1.2,
            color: colors.textDim,
          }}
        >
          {title}
        </h3>
        {subtitle && <span style={{ fontSize: 11, color: colors.textDim }}>· {subtitle}</span>}
        <div style={{ marginLeft: "auto" }}>{extra}</div>
      </div>
      {children}
    </section>
  );
}
