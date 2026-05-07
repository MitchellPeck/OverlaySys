"use client";

import { useState } from "react";
import {
  parseSongSelectText,
  slugifyTitle,
  type Song,
} from "@overlaysys/core";

interface Props {
  onSubmit: (song: Song) => void;
  onCancel: () => void;
  // Caller supplies the existing song ids so we can avoid slug collisions.
  existingIds: Set<string>;
}

export function ImportFromFileModal({ onSubmit, onCancel, existingIds }: Props) {
  const [parseError, setParseError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [author, setAuthor] = useState("");
  const [ccli, setCcli] = useState("");
  const [copyright, setCopyright] = useState("");
  const [sections, setSections] = useState<Song["sections"]>([]);
  const [arrangement, setArrangement] = useState<string[]>([]);
  const [filename, setFilename] = useState<string>("");

  async function readFile(file: File) {
    setFilename(file.name);
    setParseError(null);
    const text = await file.text();
    try {
      const r = parseSongSelectText(text);
      const t = r.meta.title ?? file.name.replace(/\.[^.]+$/, "");
      setTitle(t);
      setSlug(uniqueSlug(slugifyTitle(t), existingIds));
      setAuthor(r.meta.authors?.join(", ") ?? "");
      setCcli(r.meta.ccliNumber ?? "");
      setCopyright(r.meta.copyright ?? "");
      setSections(r.sections);
      setArrangement(r.defaultArrangement);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : String(err));
      setSections([]);
      setArrangement([]);
    }
  }

  function save() {
    if (!slug || !title || sections.length === 0) {
      setParseError("title, slug, and at least one section are required");
      return;
    }
    const song: Song = {
      id: slug,
      title,
      sections,
      defaultArrangement: arrangement,
    };
    if (author) song.author = author;
    if (ccli) song.ccliNumber = ccli;
    if (copyright) song.copyright = copyright;
    onSubmit(song);
  }

  return (
    <div
      role="dialog"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
    >
      <div
        style={{
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: 16,
          minWidth: 480,
          maxWidth: 720,
          maxHeight: "80vh",
          overflowY: "auto",
        }}
      >
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Import song from file</h2>

        <input
          type="file"
          accept=".txt,.cho"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) readFile(f);
          }}
          style={{ marginBottom: 12 }}
        />

        {parseError && (
          <p style={{ color: "#ef4444", fontSize: 12 }}>
            Parse failed: {parseError}
          </p>
        )}

        {sections.length > 0 && (
          <>
            <Field label="Title" value={title} onChange={setTitle} />
            <Field
              label="Slug"
              value={slug}
              onChange={(v) => setSlug(v.replace(/\s+/g, "-").toLowerCase())}
              hint={existingIds.has(slug) ? "⚠ slug collides with existing song" : undefined}
            />
            <Field label="Author" value={author} onChange={setAuthor} />
            <Field label="CCLI #" value={ccli} onChange={setCcli} />
            <Field label="Copyright" value={copyright} onChange={setCopyright} />
            <p style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 8 }}>
              <strong>{sections.length}</strong> section(s) detected:{" "}
              {sections.map((s) => s.label).join(", ")}
            </p>
            <p style={{ fontSize: 11, color: "var(--text-dim)" }}>
              Loaded from: <code>{filename}</code>
            </p>
          </>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={btn()}>Cancel</button>
          <button
            onClick={save}
            disabled={sections.length === 0 || !slug || !title}
            style={btn("primary")}
          >
            Save song
          </button>
        </div>
      </div>
    </div>
  );
}

function uniqueSlug(base: string, existing: Set<string>): string {
  if (!existing.has(base)) return base;
  let n = 2;
  while (existing.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

function Field({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <label style={{ width: 100, fontSize: 12, color: "var(--text-dim)" }}>
          {label}
        </label>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{ flex: 1 }}
        />
      </div>
      {hint && (
        <p style={{ fontSize: 11, color: "#f59e0b", marginLeft: 108, marginTop: 2 }}>
          {hint}
        </p>
      )}
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
