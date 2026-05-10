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
import type { Template } from "@overlaysys/core";
import { Button, colors } from "@overlaysys/ui";
import { useWs, getClient } from "@/lib/useWs";
import { useStore } from "@/lib/store";
import { useEditor } from "@/lib/editorStore";
import { uploadAsset } from "@/lib/uploadAsset";
import { AppHeader } from "@/app/components/AppHeader";

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

  useEffect(() => {
    fetchedRef.current = null;
    setDraft(null);
    const off = getClient().on((msg) => {
      if (msg.type === "template" && msg.template.id === templateId) {
        if (!useEditor.getState().dirty) setDraft(msg.template);
      }
    });
    return off;
  }, [templateId, setDraft]);

  useEffect(() => {
    if (conn !== "open") return;
    if (fetchedRef.current === templateId) return;
    fetchedRef.current = templateId;
    send({ type: "get_template", templateId });
  }, [conn, templateId, send]);

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

  function save() {
    const cur = useEditor.getState().draft;
    if (!cur) return;
    send({ type: "save_template", template: cur });
    markSaved();
  }

  function revert() {
    fetchedRef.current = null;
    setDraft(null);
    send({ type: "get_template", templateId });
  }

  if (!draft) {
    return (
      <>
        <AppHeader />
        <main style={{ padding: 24 }}>
          <p style={{ color: colors.textDim, marginTop: 12 }}>
            Loading template <code>{templateId}</code>…
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
        gridTemplateRows: "auto minmax(0, 1fr) 280px",
        overflow: "hidden",
      }}
    >
      <AppHeader
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
            <Button onClick={save} variant="primary" size="sm" disabled={!dirty || conn !== "open"}>
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

        <div style={{ background: "#0a0b0e", minWidth: 0, minHeight: 0, overflow: "hidden" }}>
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
    </main>
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
          style={{
            width: 80,
            padding: "4px 6px",
            background: colors.panel,
            border: `1px solid ${colors.border}`,
            borderRadius: 3,
            color: colors.text,
            fontSize: 12,
          }}
        />
        <span style={{ color: colors.textDim, fontSize: 11 }}>
          seconds {seconds > 0 ? "" : "(off)"}
        </span>
      </label>
    </div>
  );
}

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
