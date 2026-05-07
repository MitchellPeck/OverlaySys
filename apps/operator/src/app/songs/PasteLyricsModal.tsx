"use client";

import { useState } from "react";
import {
  parseSongFromText,
  parseSongSelectText,
  type Song,
} from "@overlaysys/core";

type SongPatch =
  & Pick<Song, "sections" | "defaultArrangement">
  & Partial<Pick<Song, "title" | "author" | "ccliNumber" | "copyright">>;

interface Props {
  song: Song;
  onApply: (patch: SongPatch) => void;
  onClose: () => void;
}

function looksLikeSongSelect(text: string): boolean {
  if (/^CCLI Song #/im.test(text)) return true;
  if (/^For use solely with the SongSelect/im.test(text)) return true;
  if (/^©/m.test(text)) return true;
  if (/^(verse|chorus|bridge|tag|intro|outro|pre[- ]?chorus|interlude|ending|coda)(\s+\d+)?$/im.test(text))
    return true;
  if (/\[[A-Ga-g][#b]?[A-Za-z0-9]*(?:\/[A-Ga-g][#b]?)?\]/.test(text)) return true;
  return false;
}

export function PasteLyricsModal({ song, onApply, onClose }: Props) {
  const [text, setText] = useState("");
  const [updateMeta, setUpdateMeta] = useState(false);
  const detectedSongSelect = looksLikeSongSelect(text);

  async function readDroppedFile(file: File) {
    const t = await file.text();
    setText(t);
  }

  function onDrop(e: React.DragEvent<HTMLTextAreaElement>) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) readDroppedFile(file);
  }

  function apply() {
    try {
      if (detectedSongSelect) {
        const r = parseSongSelectText(text);
        const patch: SongPatch = {
          sections: r.sections,
          defaultArrangement: r.defaultArrangement,
        };
        if (updateMeta) {
          if (r.meta.title) patch.title = r.meta.title;
          if (r.meta.authors?.length) patch.author = r.meta.authors.join(", ");
          if (r.meta.ccliNumber) patch.ccliNumber = r.meta.ccliNumber;
          if (r.meta.copyright) patch.copyright = r.meta.copyright;
        }
        onApply(patch);
      } else {
        const parsed = parseSongFromText(song.id, song.title, text);
        onApply({
          sections: parsed.sections,
          defaultArrangement: parsed.defaultArrangement,
        });
      }
      onClose();
    } catch (err) {
      alert(`Parse failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return (
    <div
      style={{
        marginBottom: 16,
        padding: 12,
        border: "1px solid var(--border)",
        borderRadius: 4,
      }}
    >
      <p style={{ fontSize: 12, color: "var(--text-dim)", margin: "0 0 8px" }}>
        Paste plain text with <code>[Section Name]</code> headers, or drop a SongSelect <code>.txt</code> /
        ChordPro <code>.cho</code> file. Blank line = new slide within a section.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        rows={12}
        style={{ width: "100%", fontFamily: "ui-monospace, monospace", fontSize: 12 }}
      />
      {detectedSongSelect && (
        <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-dim)" }}>
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
      <button
        onClick={apply}
        style={{
          marginTop: 8,
          padding: "6px 10px",
          background: "var(--accent)",
          color: "#fff",
          border: "1px solid var(--border)",
          borderRadius: 4,
          fontWeight: 600,
          cursor: "pointer",
          fontSize: 12,
        }}
      >
        Replace song body{detectedSongSelect ? " (SongSelect detected)" : ""}
      </button>
    </div>
  );
}
