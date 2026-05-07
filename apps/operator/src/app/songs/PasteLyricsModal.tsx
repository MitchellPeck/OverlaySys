"use client";

import { useState } from "react";
import { parseSongFromText, type Song } from "@overlaysys/core";

interface Props {
  song: Song;
  onApply: (patch: Pick<Song, "sections" | "defaultArrangement">) => void;
  onClose: () => void;
}

export function PasteLyricsModal({ song, onApply, onClose }: Props) {
  const [text, setText] = useState("");

  function apply() {
    try {
      const parsed = parseSongFromText(song.id, song.title, text);
      onApply({
        sections: parsed.sections,
        defaultArrangement: parsed.defaultArrangement,
      });
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
        Paste plain text with <code>[Section Name]</code> headers. Blank line = new slide within a section.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={12}
        style={{ width: "100%", fontFamily: "ui-monospace, monospace", fontSize: 12 }}
      />
      <button
        onClick={apply}
        style={{
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
        Replace song body
      </button>
    </div>
  );
}
