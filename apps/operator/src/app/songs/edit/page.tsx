"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  type Song, type Section,
} from "@overlaysys/core";
import { Button, Field, Input, Panel, Select, Textarea, colors } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";
import { useDialog } from "@/lib/dialog";
import { AppHeader } from "@/app/components/AppHeader";
import { PageShell, PageBody } from "@/app/components/PageShell";
import { PasteLyricsModal } from "../PasteLyricsModal";
import { isCloudMode } from "@/lib/mode";
import {
  getSongCloud,
  refreshSongMetasCloud,
  refreshTemplateMetasCloud,
  saveSongCloud,
} from "@/lib/cloudData";

// useSearchParams suspends during static prerender; wrapping it in a
// Suspense boundary lets Next.js's static export complete (the inner
// page hydrates with the real query string at runtime).
export default function SongEditorPage() {
  return (
    <Suspense fallback={<div style={{ padding: 24 }}>Loading…</div>}>
      <SongEditorPageInner />
    </Suspense>
  );
}

function SongEditorPageInner() {
  const searchParams = useSearchParams();
  const id = decodeURIComponent(searchParams?.get("id") ?? "");
  const { send } = useWs();
  const conn = useStore((s) => s.conn);
  const cached = useStore((s) => s.songCache[id]);
  const setSongInStore = useStore((s) => s.setSong);
  const templates = useStore((s) => s.templates);
  const [draft, setDraft] = useState<Song | null>(cached ?? null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [dragSecIdx, setDragSecIdx] = useState<number | null>(null);
  const [secDropZone, setSecDropZone] = useState<{ idx: number; pos: "before" | "after" } | null>(null);
  const { alert, dialog, confirm } = useDialog();
  const cloud = isCloudMode();

  async function showCloudError(action: string, err: unknown) {
    const message = err instanceof Error ? err.message : JSON.stringify(err);
    console.warn(`[songs/edit] cloud ${action} failed`, err);
    await alert({
      title: `Cloud ${action} failed`,
      message: (
        <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontSize: 12, margin: 0 }}>
          {message}
        </pre>
      ),
    });
  }

  function moveSection(from: number, to: number) {
    if (from === to) return;
    setDraft((d) => {
      if (!d) return d;
      const next = d.sections.slice();
      const [removed] = next.splice(from, 1);
      if (!removed) return d;
      const adjustedTo = from < to ? to - 1 : to;
      next.splice(adjustedTo, 0, removed);
      return { ...d, sections: next };
    });
  }

  useEffect(() => {
    if (cloud) {
      if (!cached) {
        getSongCloud(id)
          .then((s) => {
            if (s) {
              setSongInStore(s);
              setDraft(s);
            }
          })
          .catch((err) => console.warn("[songs/edit] cloud load failed", err));
      }
      if (templates.length === 0) {
        refreshTemplateMetasCloud().catch((err) =>
          console.warn("[songs/edit] template list failed", err),
        );
      }
      return;
    }
    if (conn === "open" && !cached) send({ type: "get_song", songId: id });
    if (conn === "open" && templates.length === 0) send({ type: "list_templates" });
  }, [cloud, conn, cached, id, send, templates.length, setSongInStore]);

  useEffect(() => {
    if (cached) setDraft(cached);
  }, [cached]);

  if (!draft) return <div style={{ padding: 24 }}>Loading…</div>;

  function setMeta<K extends keyof Song>(key: K, value: Song[K]) {
    setDraft((d) => (d ? { ...d, [key]: value } : d));
  }

  function updateSection(idx: number, patch: Partial<Section>) {
    setDraft((d) => {
      if (!d) return d;
      const next = d.sections.slice();
      const target = next[idx];
      if (!target) return d;
      next[idx] = { ...target, ...patch };
      return { ...d, sections: next };
    });
  }

  function updateSlide(secIdx: number, slideIdx: number, lines: string[]) {
    setDraft((d) => {
      if (!d) return d;
      const sections = d.sections.slice();
      const sec = sections[secIdx];
      if (!sec) return d;
      const slides = sec.slides.slice();
      const target = slides[slideIdx];
      if (!target) return d;
      slides[slideIdx] = { ...target, lines };
      sections[secIdx] = { ...sec, slides };
      return { ...d, sections };
    });
  }

  function addSlide(secIdx: number) {
    setDraft((d) => {
      if (!d) return d;
      const sections = d.sections.slice();
      const sec = sections[secIdx];
      if (!sec) return d;
      sections[secIdx] = {
        ...sec,
        slides: [...sec.slides, { id: `${sec.id}s${sec.slides.length + 1}`, lines: [""] }],
      };
      return { ...d, sections };
    });
  }

  function removeSlide(secIdx: number, slideIdx: number) {
    setDraft((d) => {
      if (!d) return d;
      const sections = d.sections.slice();
      const sec = sections[secIdx];
      if (!sec) return d;
      if (sec.slides.length <= 1) return d;
      sections[secIdx] = { ...sec, slides: sec.slides.filter((_, i) => i !== slideIdx) };
      return { ...d, sections };
    });
  }

  function addSection(kind: Section["kind"] = "verse") {
    setDraft((d) => {
      if (!d) return d;
      // Generate a unique kind-prefixed id by counting existing sections of
      // the same kind. Falls back to a numeric suffix on collision so it
      // works even when the song was authored with hand-picked ids.
      const prefix = SECTION_ID_PREFIX[kind];
      const sameKindCount = d.sections.filter((s) => s.kind === kind).length;
      let n = sameKindCount + 1;
      let id = `${prefix}${n}`;
      while (d.sections.some((s) => s.id === id)) {
        n += 1;
        id = `${prefix}${n}`;
      }
      const label = `${KIND_LABEL[kind]} ${n}`;
      const newSection: Section = {
        id,
        kind,
        label,
        slides: [{ id: `${id}s1`, lines: [""] }],
      };
      return { ...d, sections: [...d.sections, newSection] };
    });
  }

  async function removeSection(secIdx: number) {
    const sec = draft?.sections[secIdx];
    if (!sec) return;
    const arrangementUses = (draft?.defaultArrangement ?? []).filter(
      (sid) => sid === sec.id,
    ).length;
    const ok = await confirm({
      title: "Delete section?",
      destructive: true,
      confirmLabel: "Delete",
      message: (
        <>
          <p style={{ margin: 0 }}>
            Delete <strong>{sec.label}</strong>{" "}
            <span style={{ color: colors.textDim, fontFamily: "ui-monospace, monospace", fontSize: 11 }}>
              ({sec.id})
            </span>{" "}
            and its {sec.slides.length} slide{sec.slides.length === 1 ? "" : "s"}?
          </p>
          {arrangementUses > 0 && (
            <p style={{ marginTop: 8, marginBottom: 0, color: colors.textDim, fontSize: 12 }}>
              This section appears {arrangementUses} time{arrangementUses === 1 ? "" : "s"} in
              the default arrangement and will be removed from there too.
            </p>
          )}
        </>
      ),
    });
    if (!ok) return;
    setDraft((d) => {
      if (!d) return d;
      const sections = d.sections.filter((_, i) => i !== secIdx);
      const defaultArrangement = d.defaultArrangement.filter((sid) => sid !== sec.id);
      return { ...d, sections, defaultArrangement };
    });
  }

  async function save() {
    if (!draft) return;
    if (cloud) {
      try {
        await saveSongCloud(draft);
        await refreshSongMetasCloud();
        setSongInStore(draft);
      } catch (err) {
        await showCloudError("save", err);
      }
      return;
    }
    send({ type: "save_song", song: draft });
  }

  return (
    <PageShell>
      <AppHeader
        context={
          <h1 style={{ margin: 0, fontSize: 16 }}>
            ♪ {draft.title || <span style={{ color: colors.textDim, fontStyle: "italic" }}>(untitled)</span>}
          </h1>
        }
        actions={
          <>
            <Button onClick={() => setPasteOpen((v) => !v)} size="sm">Paste lyrics…</Button>
            <Button onClick={save} variant="primary" size="sm">Save</Button>
          </>
        }
      />
      <PageBody maxWidth={1100}>

      {pasteOpen && draft && (
        <PasteLyricsModal
          song={draft}
          onApply={(patch) => setDraft((d) => (d ? { ...d, ...patch } : d))}
          onClose={() => setPasteOpen(false)}
        />
      )}

      <Panel title="Metadata" padding="md" style={{ marginBottom: 16 }}>
        <Field label="Title" layout="inline">
          <Input value={draft.title} onChange={(e) => setMeta("title", e.target.value)} />
        </Field>
        <Field label="Author" layout="inline">
          <Input value={draft.author ?? ""} onChange={(e) => setMeta("author", e.target.value || undefined)} />
        </Field>
        <Field label="CCLI #" layout="inline">
          <Input value={draft.ccliNumber ?? ""} onChange={(e) => setMeta("ccliNumber", e.target.value || undefined)} />
        </Field>
        <Field label="Copyright" layout="inline">
          <Input value={draft.copyright ?? ""} onChange={(e) => setMeta("copyright", e.target.value || undefined)} />
        </Field>
        <Field
          label="Template"
          layout="inline"
          hint="Default template used when this song is added to a show. Show rows can override per-row."
        >
          <Select
            value={draft.defaultLyricTemplateId ?? ""}
            onChange={(e) => setMeta("defaultLyricTemplateId", e.target.value || undefined)}
          >
            <option value="">(none — pick per show row)</option>
            {!!draft.defaultLyricTemplateId &&
              !templates.some((t) => t.id === draft.defaultLyricTemplateId) && (
                <option value={draft.defaultLyricTemplateId}>
                  {draft.defaultLyricTemplateId} (missing)
                </option>
              )}
            {templates.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </Select>
        </Field>
      </Panel>

      <h2 style={{ fontSize: 14, marginBottom: 8 }}>Sections</h2>
      {draft.sections.length === 0 && (
        <p style={{ fontSize: 12, color: colors.textDim, fontStyle: "italic", marginBottom: 12 }}>
          No sections yet. Add one below or paste lyrics.
        </p>
      )}
      {draft.sections.map((sec, secIdx) => {
        const isDragging = dragSecIdx === secIdx;
        const dropAtMe = secDropZone?.idx === secIdx ? secDropZone.pos : null;
        return (
          <div
            key={sec.id}
            onDragOver={(e) => {
              if (dragSecIdx === null) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              const pos: "before" | "after" =
                e.clientY < r.top + r.height / 2 ? "before" : "after";
              setSecDropZone({ idx: secIdx, pos });
            }}
            onDragLeave={(e) => {
              // Only clear when leaving the wrapper itself, not children.
              if (e.currentTarget === e.target) setSecDropZone(null);
            }}
            onDrop={(e) => {
              e.preventDefault();
              const sourceIdxStr = e.dataTransfer.getData("text/plain");
              const sourceIdx = Number(sourceIdxStr);
              const z = secDropZone;
              setSecDropZone(null);
              setDragSecIdx(null);
              if (Number.isNaN(sourceIdx) || !z) return;
              const target = z.pos === "before" ? z.idx : z.idx + 1;
              moveSection(sourceIdx, target);
            }}
            style={{
              marginBottom: 16,
              // Raw 2px borders here are intentional drop indicators —
              // not the standardized radius/border tokens.
              borderTop: dropAtMe === "before" ? `2px solid ${colors.green}` : "2px solid transparent",
              borderBottom: dropAtMe === "after" ? `2px solid ${colors.green}` : "2px solid transparent",
              opacity: isDragging ? 0.5 : 1,
            }}
          >
            <Panel padding="md">
              <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
                <span
                  draggable
                  onDragStart={(e) => {
                    setDragSecIdx(secIdx);
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", String(secIdx));
                  }}
                  onDragEnd={() => {
                    setDragSecIdx(null);
                    setSecDropZone(null);
                  }}
                  title="Drag to reorder section"
                  aria-label="Drag handle"
                  style={{
                    cursor: "grab",
                    color: colors.textDim,
                    fontSize: 16,
                    padding: "0 4px",
                    userSelect: "none",
                  }}
                >
                  ⋮⋮
                </span>
                <Input
                  value={sec.label}
                  onChange={(e) => updateSection(secIdx, { label: e.target.value })}
                  style={{ fontWeight: 600, flex: 1 }}
                />
                <Select
                  value={sec.kind}
                  onChange={(e) => updateSection(secIdx, { kind: e.target.value as Section["kind"] })}
                  style={{ width: "auto" }}
                >
                  <option value="verse">verse</option>
                  <option value="chorus">chorus</option>
                  <option value="bridge">bridge</option>
                  <option value="tag">tag</option>
                  <option value="intro">intro</option>
                  <option value="outro">outro</option>
                  <option value="other">other</option>
                </Select>
                <span style={{ fontSize: 10, color: colors.textDim, fontFamily: "ui-monospace, monospace" }}>
                  {sec.id}
                </span>
                <Button
                  onClick={() => removeSection(secIdx)}
                  variant="destructive"
                  size="sm"
                  title="Delete section"
                >
                  Delete section
                </Button>
              </div>
              {sec.slides.map((slide, slideIdx) => (
                <div key={slide.id} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                  <Textarea
                    value={slide.lines.join("\n")}
                    onChange={(e) => updateSlide(secIdx, slideIdx, e.target.value.split("\n"))}
                    rows={2}
                    mono
                    style={{ flex: 1 }}
                  />
                  <Button onClick={() => removeSlide(secIdx, slideIdx)} size="sm" disabled={sec.slides.length <= 1}>
                    ✕
                  </Button>
                </div>
              ))}
              <Button onClick={() => addSlide(secIdx)} size="sm">+ Slide</Button>
            </Panel>
          </div>
        );
      })}

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <Button onClick={() => addSection("verse")} size="sm">+ Verse</Button>
        <Button onClick={() => addSection("chorus")} size="sm">+ Chorus</Button>
        <Button onClick={() => addSection("bridge")} size="sm">+ Bridge</Button>
        <Select
          value=""
          onChange={(e) => {
            const v = e.target.value as Section["kind"] | "";
            if (!v) return;
            addSection(v);
            e.currentTarget.value = "";
          }}
          style={{ width: "auto" }}
        >
          <option value="">+ Other section…</option>
          <option value="tag">Tag</option>
          <option value="intro">Intro</option>
          <option value="outro">Outro</option>
          <option value="other">Other</option>
        </Select>
      </div>

      <Panel title="Default Arrangement" padding="md" style={{ marginBottom: 16 }}>
        <ArrangementEditor
          arrangement={draft.defaultArrangement}
          sections={draft.sections}
          onChange={(next) => setMeta("defaultArrangement", next)}
        />
        <p style={{ fontSize: 10, color: colors.textDim, marginTop: 4 }}>
          Sections can repeat. Drag chips to reorder.
        </p>
      </Panel>
      </PageBody>
      {dialog}
    </PageShell>
  );
}

const SECTION_ID_PREFIX: Record<Section["kind"], string> = {
  verse: "v",
  chorus: "c",
  bridge: "b",
  tag: "tag",
  intro: "intro",
  outro: "outro",
  other: "s",
};

const KIND_LABEL: Record<Section["kind"], string> = {
  verse: "Verse",
  chorus: "Chorus",
  bridge: "Bridge",
  tag: "Tag",
  intro: "Intro",
  outro: "Outro",
  other: "Section",
};

function ArrangementEditor({
  arrangement,
  sections,
  onChange,
}: {
  arrangement: string[];
  sections: Section[];
  onChange: (next: string[]) => void;
}) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropZone, setDropZone] = useState<{ idx: number; pos: "before" | "after" } | null>(null);

  function move(from: number, to: number) {
    if (from === to) return;
    const next = arrangement.slice();
    const [removed] = next.splice(from, 1);
    if (removed === undefined) return;
    const adjustedTo = from < to ? to - 1 : to;
    next.splice(adjustedTo, 0, removed);
    onChange(next);
  }
  function remove(idx: number) {
    onChange(arrangement.filter((_, i) => i !== idx));
  }
  function add(sectionId: string) {
    onChange([...arrangement, sectionId]);
  }

  return (
    <div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 8 }}>
        {arrangement.length === 0 && (
          <p style={{ color: colors.textDim, fontSize: 12, fontStyle: "italic" }}>
            Empty arrangement. Add sections below.
          </p>
        )}
        {arrangement.map((sectionId, i) => {
          const section = sections.find((s) => s.id === sectionId);
          const isDragging = dragIdx === i;
          const dropAtMe = dropZone?.idx === i ? dropZone.pos : null;
          return (
            <div
              key={`${sectionId}@${i}`}
              draggable
              onDragStart={(e) => {
                setDragIdx(i);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", String(i));
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                const pos: "before" | "after" = e.clientY < r.top + r.height / 2 ? "before" : "after";
                setDropZone({ idx: i, pos });
              }}
              onDragLeave={() => setDropZone(null)}
              onDrop={(e) => {
                e.preventDefault();
                const sourceIdxStr = e.dataTransfer.getData("text/plain");
                const sourceIdx = Number(sourceIdxStr);
                const z = dropZone;
                setDropZone(null);
                if (Number.isNaN(sourceIdx) || !z) return;
                const target = z.pos === "before" ? z.idx : z.idx + 1;
                move(sourceIdx, target);
              }}
              onDragEnd={() => { setDragIdx(null); setDropZone(null); }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "6px 10px",
                borderRadius: 4,
                border: `1px solid ${colors.border}`,
                background: colors.panel2,
                opacity: isDragging ? 0.5 : 1,
                // Raw 2px borders here are intentional drag indicators —
                // not the standardized radius/border tokens.
                borderTop: dropAtMe === "before" ? `2px solid ${colors.green}` : undefined,
                borderBottom: dropAtMe === "after" ? `2px solid ${colors.green}` : `1px solid ${colors.border}`,
                cursor: "grab",
                fontSize: 12,
              }}
            >
              <span style={{ color: colors.textDim, width: 24, textAlign: "right" }}>{i + 1}.</span>
              <span aria-hidden style={{ color: colors.textDim }}>⋮⋮</span>
              <span style={{ fontWeight: 600 }}>{section?.label ?? sectionId}</span>
              <span style={{ fontSize: 10, color: colors.textDim, fontFamily: "ui-monospace, monospace" }}>
                {sectionId}{!section && " (missing)"}
              </span>
              <button
                onClick={() => remove(i)}
                title="Remove"
                style={{
                  marginLeft: "auto",
                  padding: "2px 8px",
                  background: "transparent",
                  color: colors.textDim,
                  border: `1px solid ${colors.border}`,
                  borderRadius: 3,
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
      <Select
        value=""
        onChange={(e) => {
          const v = e.target.value;
          if (v) add(v);
          e.currentTarget.value = "";
        }}
        style={{ width: "auto" }}
      >
        <option value="">+ Add section…</option>
        {sections.map((s) => (
          <option key={s.id} value={s.id}>{s.label} ({s.id})</option>
        ))}
      </Select>
    </div>
  );
}
