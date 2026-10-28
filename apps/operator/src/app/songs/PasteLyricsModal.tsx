"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Song } from "@overlaysys/core";
import { Button, Checkbox, Panel, Textarea, colors } from "@overlaysys/ui";
import { parsePastedLyrics, type LyricsParse, type SongPatch } from "./pasteLyrics";
import { parseSongImportJson } from "./songImport";

export type { SongPatch } from "./pasteLyrics";

interface Props {
  song: Song;
  onApply: (patch: SongPatch) => void;
  onClose: () => void;
}

const FORMAT_LABEL = { chordpro: "ChordPro", songselect: "SongSelect", plain: "Plain text" } as const;

/** An exported song .json dropped or pasted here: use its sections as the patch. */
function parseJsonPatch(text: string, updateMeta: boolean): LyricsParse | null {
  if (!text.trimStart().startsWith("{")) return null;
  const r = parseSongImportJson(text);
  if (!r.ok) return { ok: false, error: r.error, format: "plain" };
  const s = r.song;
  const patch: SongPatch = { sections: s.sections, defaultArrangement: s.defaultArrangement };
  if (updateMeta) {
    if (s.title) patch.title = s.title;
    if (s.author) patch.author = s.author;
    if (s.ccliNumber) patch.ccliNumber = s.ccliNumber;
    if (s.copyright) patch.copyright = s.copyright;
  }
  return { ok: true, patch, format: "plain", notice: null, warnings: [] };
}

/**
 * Inline panel (not a true modal) — rendered above the song editor for pasting
 * or dropping a lyric file. The parsed result is previewed before anything is
 * replaced; the page keeps one level of undo.
 */
export function PasteLyricsModal({ song, onApply, onClose }: Props) {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | undefined>(undefined);
  const [updateMeta, setUpdateMeta] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => root.current?.querySelector("textarea")?.focus(), []);

  const isJson = text.trimStart().startsWith("{");
  const parsed = useMemo(
    () => parseJsonPatch(text, updateMeta) ?? parsePastedLyrics(song, text, updateMeta, fileName),
    [song.id, song.title, text, updateMeta, fileName], // eslint-disable-line react-hooks/exhaustive-deps -- only id/title feed the parser
  );

  async function readDroppedFile(file: File) {
    const t = await file.text();
    setFileName(file.name);
    setText(t);
  }

  function onDrop(e: React.DragEvent<HTMLTextAreaElement>) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) void readDroppedFile(file);
  }

  const patch = parsed.ok ? parsed.patch : null;
  const slideCount = patch ? patch.sections.reduce((n, s) => n + s.slides.length, 0) : 0;
  const labelOf = (id: string) => patch?.sections.find((s) => s.id === id)?.label ?? id;
  const showMeta = isJson || parsed.format === "songselect" || parsed.format === "chordpro";

  return (
    <div
      ref={root}
      onKeyDown={(e) => {
        if (e.key === "Escape" && root.current?.contains(document.activeElement)) {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <Panel padding="md" style={{ marginBottom: 16 }}>
        <p style={{ fontSize: 12, color: colors.textDim, margin: "0 0 8px" }}>
          Paste plain text with <code>[Section Name]</code> headers, or drop a SongSelect <code>.txt</code>,
          ChordPro <code>.cho</code> or song <code>.json</code> file. Blank line = new slide within a section.
        </p>
        <Textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setFileName(undefined);
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          rows={12}
          mono
          aria-label="Lyrics to paste"
        />
        {text.trim() && !isJson && (
          <div style={{ marginTop: 6, fontSize: 11, color: colors.textMuted }}>
            Format: {FORMAT_LABEL[parsed.format]}
          </div>
        )}
        {showMeta && (
          <div style={{ marginTop: 8 }}>
            <Checkbox
              checked={updateMeta}
              onChange={setUpdateMeta}
              label="Also update title, author, CCLI number and copyright"
            />
          </div>
        )}

        <div
          aria-live="polite"
          style={{
            marginTop: 8,
            padding: 8,
            border: `1px solid ${colors.border}`,
            borderRadius: 4,
            fontSize: 12,
            maxHeight: 220,
            overflow: "auto",
          }}
        >
          {!parsed.ok ? (
            <span style={{ color: text.trim() ? colors.dangerText : colors.textDim }}>
              {text.trim() ? `Can't parse yet: ${parsed.error}` : parsed.error}
            </span>
          ) : (
            <>
              <div style={{ marginBottom: 6 }}>
                <strong>Preview:</strong> {parsed.patch.sections.length} section
                {parsed.patch.sections.length === 1 ? "" : "s"}, {slideCount} slide{slideCount === 1 ? "" : "s"}
                {" — replaces "}
                {song.sections.length} section{song.sections.length === 1 ? "" : "s"} in this song.
              </div>
              {parsed.notice && <div style={{ color: colors.textDim, marginBottom: 6 }}>{parsed.notice}</div>}
              {parsed.warnings.map((w) => (
                <div key={w} role="alert" style={{ color: colors.dangerText, marginBottom: 6 }}>
                  {w}
                </div>
              ))}
              {(parsed.patch.title || parsed.patch.author || parsed.patch.ccliNumber) && (
                <div style={{ color: colors.textDim, marginBottom: 6 }}>
                  Metadata:{" "}
                  {[
                    parsed.patch.title && `title “${parsed.patch.title}”`,
                    parsed.patch.author && `author ${parsed.patch.author}`,
                    parsed.patch.ccliNumber && `CCLI ${parsed.patch.ccliNumber}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              )}
              <ul style={{ margin: 0, paddingLeft: 16 }}>
                {parsed.patch.sections.map((s) => (
                  <li key={s.id}>
                    <strong>{s.label}</strong>{" "}
                    <span style={{ color: colors.textDim }}>
                      {s.slides[0]?.lines[0] ?? ""} ({s.slides.length} slide{s.slides.length === 1 ? "" : "s"})
                    </span>
                  </li>
                ))}
              </ul>
              <div style={{ color: colors.textDim, marginTop: 6 }}>
                Arrangement: {parsed.patch.defaultArrangement.map(labelOf).join(" → ") || "(empty)"}
              </div>
            </>
          )}
        </div>

        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <Button
            onClick={() => {
              if (!parsed.ok) return;
              onApply(parsed.patch);
              onClose();
            }}
            variant="primary"
            size="sm"
            disabled={!parsed.ok}
          >
            Replace song body
          </Button>
          <Button onClick={onClose} size="sm">Cancel</Button>
        </div>
      </Panel>
    </div>
  );
}
