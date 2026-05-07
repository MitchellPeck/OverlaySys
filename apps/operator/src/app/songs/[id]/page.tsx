"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import {
  parseSongFromText,
  type Song, type Section,
} from "@overlaysys/core";
import { useStore } from "@/lib/store";
import { useWs } from "@/lib/useWs";

export default function SongEditorPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(params.id);
  const { send } = useWs();
  const conn = useStore((s) => s.conn);
  const cached = useStore((s) => s.songCache[id]);
  const [draft, setDraft] = useState<Song | null>(cached ?? null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");

  useEffect(() => {
    if (conn === "open" && !cached) send({ type: "get_song", songId: id });
  }, [conn, cached, id, send]);

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
      if (sec.slides.length <= 1) return d; // keep at least one
      sections[secIdx] = { ...sec, slides: sec.slides.filter((_, i) => i !== slideIdx) };
      return { ...d, sections };
    });
  }

  function save() {
    if (!draft) return;
    send({ type: "save_song", song: draft });
  }

  function applyPaste() {
    if (!draft) return;
    try {
      const parsed = parseSongFromText(draft.id, draft.title, pasteText);
      // Preserve metadata, replace sections + arrangement.
      setDraft({ ...draft, sections: parsed.sections, defaultArrangement: parsed.defaultArrangement });
      setPasteOpen(false);
      setPasteText("");
    } catch (err) {
      alert(`Parse failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <Link href="/songs" style={{ color: "var(--text-dim)" }}>← Songs</Link>
        <h1 style={{ margin: 0, fontSize: 18 }}>{draft.title}</h1>
        <button onClick={() => setPasteOpen((v) => !v)} style={btn()}>Paste lyrics…</button>
        <button onClick={save} style={btn("primary")}>Save</button>
      </header>

      {pasteOpen && (
        <div style={{ marginBottom: 16, padding: 12, border: "1px solid var(--border)", borderRadius: 4 }}>
          <p style={{ fontSize: 12, color: "var(--text-dim)", margin: "0 0 8px" }}>
            Paste plain text with <code>[Section Name]</code> headers. Blank line = new slide within a section.
          </p>
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={12}
            style={{ width: "100%", fontFamily: "ui-monospace, monospace", fontSize: 12 }}
          />
          <button onClick={applyPaste} style={btn("primary")}>Replace song body</button>
        </div>
      )}

      <fieldset style={{ marginBottom: 16, padding: 12, border: "1px solid var(--border)", borderRadius: 4 }}>
        <legend style={{ fontSize: 12, color: "var(--text-dim)" }}>Metadata</legend>
        <Field label="Title" value={draft.title} onChange={(v) => setMeta("title", v)} />
        <Field label="Author" value={draft.author ?? ""} onChange={(v) => setMeta("author", v || undefined)} />
        <Field label="CCLI #" value={draft.ccliNumber ?? ""} onChange={(v) => setMeta("ccliNumber", v || undefined)} />
        <Field label="Copyright" value={draft.copyright ?? ""} onChange={(v) => setMeta("copyright", v || undefined)} />
      </fieldset>

      <h2 style={{ fontSize: 14, marginBottom: 8 }}>Sections</h2>
      {draft.sections.map((sec, secIdx) => (
        <section key={sec.id} style={{ marginBottom: 16, padding: 12, border: "1px solid var(--border)", borderRadius: 4 }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
            <input
              value={sec.label}
              onChange={(e) => updateSection(secIdx, { label: e.target.value })}
              style={{ fontWeight: 600, flex: 1 }}
            />
            <select
              value={sec.kind}
              onChange={(e) => updateSection(secIdx, { kind: e.target.value as Section["kind"] })}
            >
              <option value="verse">verse</option>
              <option value="chorus">chorus</option>
              <option value="bridge">bridge</option>
              <option value="tag">tag</option>
              <option value="intro">intro</option>
              <option value="outro">outro</option>
              <option value="other">other</option>
            </select>
            <span style={{ fontSize: 10, color: "var(--text-dim)", fontFamily: "ui-monospace, monospace" }}>
              {sec.id}
            </span>
          </div>
          {sec.slides.map((slide, slideIdx) => (
            <div key={slide.id} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
              <textarea
                value={slide.lines.join("\n")}
                onChange={(e) => updateSlide(secIdx, slideIdx, e.target.value.split("\n"))}
                rows={2}
                style={{ flex: 1, fontFamily: "ui-monospace, monospace", fontSize: 12 }}
              />
              <button onClick={() => removeSlide(secIdx, slideIdx)} style={btn()} disabled={sec.slides.length <= 1}>
                ✕
              </button>
            </div>
          ))}
          <button onClick={() => addSlide(secIdx)} style={btn()}>+ Slide</button>
        </section>
      ))}

      <fieldset style={{ marginBottom: 16, padding: 12, border: "1px solid var(--border)", borderRadius: 4 }}>
        <legend style={{ fontSize: 12, color: "var(--text-dim)" }}>Default Arrangement</legend>
        <input
          value={draft.defaultArrangement.join(" → ")}
          onChange={(e) =>
            setMeta(
              "defaultArrangement",
              e.target.value.split("→").map((s) => s.trim()).filter(Boolean),
            )
          }
          style={{ width: "100%", fontFamily: "ui-monospace, monospace", fontSize: 12 }}
        />
        <p style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 4 }}>
          Section ids separated by →. Available: {draft.sections.map((s) => s.id).join(", ")}
        </p>
      </fieldset>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
      <label style={{ width: 100, fontSize: 12, color: "var(--text-dim)" }}>{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} style={{ flex: 1 }} />
    </div>
  );
}

function btn(kind: "default" | "primary" = "default"): React.CSSProperties {
  return {
    padding: "6px 10px",
    background: kind === "primary" ? "var(--accent)" : "var(--panel-2)",
    color: kind === "primary" ? "#fff" : "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    fontWeight: 600,
    cursor: "pointer",
    fontSize: 12,
  };
}
