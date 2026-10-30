"use client";

import { useState } from "react";
import {
  slugifyTitle,
  type Song,
  type SongMeta,
} from "@overlaysys/core";
import { Button, Field, FileDrop, Input, Modal, colors } from "@overlaysys/ui";
import { parsePastedLyrics } from "./pasteLyrics";
import { findCcliDuplicate, parseSongImportJson, resolveImportId, stripServerFields, uniqueSlug, finalSlug, slugInput, type ImportChoice } from "./songImport";

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
  const [file, setFile] = useState<File | null>(null);
  /** The parsed song.json, so keys we don't edit survive the import. */
  const [base, setBase] = useState<Song | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** The CCLI duplicate being asked about; null when no choice is pending. */
  const [duplicate, setDuplicate] = useState<SongMeta | null>(null);

  function reset() {
    setSections([]);
    setArrangement([]);
    setBase(null);
    setNotice(null);
  }

  async function readFile(f: File) {
    setFile(f);
    setFilename(f.name);
    setParseError(null);
    setDuplicate(null);
    const text = await f.text();
    const stem = f.name.replace(/\.[^.]+$/, "");
    const fill = (t: string, a: string, c: string, cr: string) => {
      setTitle(t);
      setSlug(uniqueSlug(slugifyTitle(t), existingIds));
      setAuthor(a);
      setCcli(c);
      setCopyright(cr);
    };
    reset();
    if (/\.json$/i.test(f.name)) {
      const r = parseSongImportJson(text);
      if (!r.ok) {
        setParseError(r.error);
        return;
      }
      const s = r.song;
      fill(s.title || stem, s.author ?? "", s.ccliNumber ?? "", s.copyright ?? "");
      setBase(s);
      setSections(s.sections);
      setArrangement(s.defaultArrangement);
      return;
    }
    const r = parsePastedLyrics({ id: slugifyTitle(stem), title: stem }, text, true, f.name);
    if (!r.ok) {
      setParseError(r.error);
      return;
    }
    fill(r.patch.title ?? stem, r.patch.author ?? "", r.patch.ccliNumber ?? "", r.patch.copyright ?? "");
    setNotice(r.notice);
    setSections(r.patch.sections);
    setArrangement(r.patch.defaultArrangement);
  }

  function save(choice?: ImportChoice) {
    if (sections.length === 0) {
      setParseError("Couldn't find any verses or choruses in this file.");
      return;
    }
    if (!title) {
      setParseError("Add a title before saving.");
      return;
    }
    const cleanSlug = finalSlug(slug);
    if (!cleanSlug) {
      setParseError("The slug needs at least one letter or number (a-z, 0-9).");
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
      customFields: {},
      ...(base ? stripServerFields(base, dup && choice === "replace" ? dup : null) : {}),
      id: resolveImportId(cleanSlug, existingIds, dup, choice ?? "copy"),
      title,
      sections,
      defaultArrangement: arrangement,
    };
    if (author) song.author = author; else delete song.author;
    if (ccli) song.ccliNumber = ccli; else delete song.ccliNumber;
    if (copyright) song.copyright = copyright; else delete song.copyright;
    onSubmit(song);
  }

  return (
    <Modal
      open
      onClose={onCancel}
      onCancel={onCancel}
      onConfirm={sections.length > 0 && slug && title && !duplicate ? () => save() : undefined}
      size="md"
      containerStyle={{ width: 560, minWidth: 560, maxWidth: 560 }}
      closeOnBackdrop={false}
      title="Import song from file"
      footer={
        duplicate ? (
          <>
            <Button onClick={() => setDuplicate(null)} variant="ghost" size="sm">Back</Button>
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
      <div style={{ marginBottom: 12 }}>
        <FileDrop
          accept=".txt,.cho,.chordpro,.chopro,.json"
          hint="Drop a SongSelect .txt, ChordPro .cho or song .json file, or browse"
          file={file}
          onFile={(f) => void readFile(f)}
          onClear={() => {
            setFile(null);
            setFilename("");
            setParseError(null);
            setDuplicate(null);
            reset();
          }}
        />
      </div>

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
          {parseError}
        </p>
      )}

      {sections.length > 0 && (
        <>
          <Field label="Title" layout="inline">
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
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
          {notice && <p style={{ fontSize: 12, color: colors.textDim, marginTop: 8 }}>{notice}</p>}
          <p style={{ fontSize: 12, color: colors.textDim, marginTop: 8 }}>
            <strong>{sections.length}</strong> section{sections.length === 1 ? "" : "s"} found:
          </p>
          <ul style={{ fontSize: 12, color: colors.textDim, margin: "0 0 8px", paddingLeft: 16 }}>
            {sections.map((s) => (
              <li key={s.id}>
                <strong style={{ color: colors.text }}>{s.label}</strong> {s.slides[0]?.lines[0] ?? ""}
              </li>
            ))}
          </ul>
          <details style={{ fontSize: 12, color: colors.textDim }}>
            <summary style={{ cursor: "pointer", minHeight: 24 }}>Advanced</summary>
            <div style={{ marginTop: 6 }}>
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
                    setSlug(slugInput(e.target.value));
                    setDuplicate(null);
                  }}
                />
              </Field>
            </div>
          </details>
          <p style={{ fontSize: 11, color: colors.textDim }}>
            Loaded from: <code>{filename}</code>
          </p>
        </>
      )}
    </Modal>
  );
}
