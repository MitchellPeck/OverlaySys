"use client";

import { useMemo, useState } from "react";
import type { Song } from "@overlaysys/core";
import { Button, Panel, Textarea, colors } from "@overlaysys/ui";
import { useDialog } from "@/lib/dialog";
import { parsePastedLyrics, type SongPatch } from "./pasteLyrics";

export type { SongPatch } from "./pasteLyrics";

interface Props {
  song: Song;
  onApply: (patch: SongPatch) => void;
  onClose: () => void;
}

/**
 * Inline panel (not a true modal) — rendered above the song editor for pasting
 * or dropping a lyric file. The name is historical: it's an inline drop zone
 * that replaces the song body, not a floating dialog. The parsed result is
 * previewed before anything is replaced; the page keeps one level of undo.
 */
export function PasteLyricsModal({ song, onApply, onClose }: Props) {
  const [text, setText] = useState("");
  const [updateMeta, setUpdateMeta] = useState(false);
  const { alert, dialog } = useDialog();
  const parsed = useMemo(
    () => parsePastedLyrics(song, text, updateMeta),
    [song.id, song.title, text, updateMeta], // eslint-disable-line react-hooks/exhaustive-deps -- only id/title feed the parser
  );

  async function readDroppedFile(file: File) {
    const t = await file.text();
    setText(t);
  }

  function onDrop(e: React.DragEvent<HTMLTextAreaElement>) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) void readDroppedFile(file);
  }

  async function apply() {
    if (!parsed.ok) {
      await alert({ title: "Couldn't read these lyrics", message: parsed.error });
      return;
    }
    onApply(parsed.patch);
    onClose();
  }

  const slideCount = parsed.ok ? parsed.patch.sections.reduce((n, s) => n + s.slides.length, 0) : 0;
  const labelOf = (id: string) =>
    parsed.ok ? (parsed.patch.sections.find((s) => s.id === id)?.label ?? id) : id;

  return (
    <Panel padding="md" style={{ marginBottom: 16 }}>
      <p style={{ fontSize: 12, color: colors.textDim, margin: "0 0 8px" }}>
        Paste plain text with <code>[Section Name]</code> headers, or drop a SongSelect <code>.txt</code> /
        ChordPro <code>.cho</code> file. Blank line = new slide within a section.
      </p>
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        rows={12}
        mono
        aria-label="Lyrics to paste"
      />
      {parsed.format === "songselect" && (
        <div style={{ marginTop: 8, fontSize: 12, color: colors.textDim }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              checked={updateMeta}
              onChange={(e) => setUpdateMeta(e.target.checked)}
            />
            Also update title / author / CCLI # / copyright from imported file
          </label>
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
          <span style={{ color: text.trim() ? colors.errorText : colors.textDim }}>
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
                    ({s.slides.length} slide{s.slides.length === 1 ? "" : "s"}) — {s.slides[0]?.lines[0] ?? ""}
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
        <Button onClick={apply} variant="primary" size="sm" disabled={!parsed.ok}>
          Replace song body{parsed.format === "songselect" ? " (SongSelect detected)" : ""}
        </Button>
        <Button onClick={onClose} size="sm">Cancel</Button>
      </div>
      {dialog}
    </Panel>
  );
}
