"use client";

import { useState } from "react";
import {
  parseSongSelectText,
  slugifyTitle,
  type Song,
} from "@overlaysys/core";
import { Button, Field, Input, Modal, colors } from "@overlaysys/ui";

interface Props {
  onSubmit: (song: Song) => void;
  onCancel: () => void;
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
    <Modal
      open
      onClose={onCancel}
      onCancel={onCancel}
      onConfirm={sections.length > 0 && slug && title ? save : undefined}
      size="md"
      title="Import song from file"
      footer={
        <>
          <Button onClick={onCancel} variant="ghost" size="sm">Cancel</Button>
          <Button
            onClick={save}
            disabled={sections.length === 0 || !slug || !title}
            variant="primary"
            size="sm"
          >
            Save song
          </Button>
        </>
      }
    >
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
        <p style={{ color: colors.errorText, fontSize: 12 }}>
          Parse failed: {parseError}
        </p>
      )}

      {sections.length > 0 && (
        <>
          <Field label="Title" layout="inline">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field
            label="Slug"
            layout="inline"
            hint={existingIds.has(slug) ? "⚠ slug collides with existing song" : undefined}
          >
            <Input
              value={slug}
              onChange={(e) => setSlug(e.target.value.replace(/\s+/g, "-").toLowerCase())}
            />
          </Field>
          <Field label="Author" layout="inline">
            <Input value={author} onChange={(e) => setAuthor(e.target.value)} />
          </Field>
          <Field label="CCLI #" layout="inline">
            <Input value={ccli} onChange={(e) => setCcli(e.target.value)} />
          </Field>
          <Field label="Copyright" layout="inline">
            <Input value={copyright} onChange={(e) => setCopyright(e.target.value)} />
          </Field>
          <p style={{ fontSize: 12, color: colors.textDim, marginTop: 8 }}>
            <strong>{sections.length}</strong> section(s) detected:{" "}
            {sections.map((s) => s.label).join(", ")}
          </p>
          <p style={{ fontSize: 11, color: colors.textDim }}>
            Loaded from: <code>{filename}</code>
          </p>
        </>
      )}
    </Modal>
  );
}

function uniqueSlug(base: string, existing: Set<string>): string {
  if (!existing.has(base)) return base;
  let n = 2;
  while (existing.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
