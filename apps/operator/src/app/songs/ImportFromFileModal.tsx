"use client";

import { useState } from "react";
import {
  parseSongSelectText,
  slugifyTitle,
  type Song,
  type SongMeta,
} from "@overlaysys/core";
import { Button, Field, Input, Modal, colors } from "@overlaysys/ui";
import { findCcliDuplicate, resolveImportId, uniqueSlug, type ImportChoice } from "./songImport";

interface Props {
  /** Receives the song with its final id already resolved (replace or suffixed copy). */
  onSubmit: (song: Song) => void;
  onCancel: () => void;
  /** Every id in use, including trashed songs, so an import never overwrites one. */
  existingIds: Set<string>;
  /** Live songs, for the CCLI duplicate check. */
  existingSongs: readonly SongMeta[];
}

export function ImportFromFileModal({ onSubmit, onCancel, existingIds, existingSongs }: Props) {
  const [parseError, setParseError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [author, setAuthor] = useState("");
  const [ccli, setCcli] = useState("");
  const [copyright, setCopyright] = useState("");
  const [sections, setSections] = useState<Song["sections"]>([]);
  const [arrangement, setArrangement] = useState<string[]>([]);
  const [filename, setFilename] = useState<string>("");
  /** The CCLI duplicate being asked about; null when no choice is pending. */
  const [duplicate, setDuplicate] = useState<SongMeta | null>(null);

  async function readFile(file: File) {
    setFilename(file.name);
    setParseError(null);
    setDuplicate(null);
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

  function save(choice?: ImportChoice) {
    if (!slug || !title || sections.length === 0) {
      setParseError("title, slug, and at least one section are required");
      return;
    }
    const dup = findCcliDuplicate(ccli, existingSongs);
    if (dup && !choice) {
      // Ask inline: Replace / Import as copy / Cancel. Closing the modal is
      // Cancel — nothing is imported without an explicit choice.
      setDuplicate(dup);
      return;
    }
    const song: Song = {
      id: resolveImportId(slug, existingIds, dup, choice ?? "copy"),
      title,
      sections,
      defaultArrangement: arrangement,
      customFields: {},
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
      onConfirm={sections.length > 0 && slug && title && !duplicate ? () => save() : undefined}
      size="md"
      title="Import song from file"
      footer={
        duplicate ? (
          <>
            <Button onClick={() => setDuplicate(null)} variant="ghost" size="sm">Cancel</Button>
            <Button onClick={() => save("copy")} size="sm">Import as copy</Button>
            <Button onClick={() => save("replace")} variant="destructive" size="sm">Replace</Button>
          </>
        ) : (
          <>
            <Button onClick={onCancel} variant="ghost" size="sm">Cancel</Button>
            <Button
              onClick={() => save()}
              disabled={sections.length === 0 || !slug || !title}
              variant="primary"
              size="sm"
            >
              Save song
            </Button>
          </>
        )
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

      {duplicate && (
        <div
          role="alert"
          style={{
            padding: "8px 12px",
            marginBottom: 12,
            border: `1px solid ${colors.warn}`,
            borderRadius: 6,
            fontSize: 13,
          }}
        >
          A song with CCLI # <strong>{ccli.trim()}</strong> already exists:{" "}
          <strong>{duplicate.title || duplicate.id}</strong>.
          <br />
          <strong>Replace</strong> overwrites that song&apos;s lyrics and details.{" "}
          <strong>Import as copy</strong> adds this one as{" "}
          <code>{uniqueSlug(slug, existingIds)}</code>.
        </div>
      )}

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
            hint={
              existingIds.has(slug)
                ? `In use — will be saved as ${uniqueSlug(slug, existingIds)}`
                : undefined
            }
          >
            <Input
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value.replace(/\s+/g, "-").toLowerCase());
                setDuplicate(null);
              }}
            />
          </Field>
          <Field label="Author" layout="inline">
            <Input value={author} onChange={(e) => setAuthor(e.target.value)} />
          </Field>
          <Field label="CCLI #" layout="inline">
            <Input
              value={ccli}
              onChange={(e) => {
                setCcli(e.target.value);
                setDuplicate(null);
              }}
            />
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
