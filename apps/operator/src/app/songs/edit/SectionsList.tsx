"use client";

import { ChevronDown, Plus } from "lucide-react";
import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { SectionKind, Song } from "@overlaysys/core";
import { Button, Pill, colors, radius, useContextMenu, type MenuItem } from "@overlaysys/ui";
import { addSongSection, appendToArrangement, firstLine, sectionsNotInArrangement } from "./songDraftOps";
import { moveSongSection } from "./songEditorModel";
import { sectionKindColor } from "./slides";

export const SECTION_KIND_NAMES: Record<SectionKind, string> = {
  verse: "Verse",
  chorus: "Chorus",
  bridge: "Bridge",
  tag: "Tag",
  intro: "Intro",
  outro: "Outro",
  other: "Other",
};

const KINDS = Object.keys(SECTION_KIND_NAMES) as SectionKind[];

/** The song's sections in order: select one to edit, drag to reorder, "+ Section" to add. */
export function SectionsList({
  song,
  selectedId,
  onSelect,
  onChange,
}: {
  song: Song;
  selectedId: string | null;
  onSelect(id: string): void;
  onChange: Dispatch<SetStateAction<Song>>;
}) {
  const ctx = useContextMenu();
  const dragFrom = useRef<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const unused = new Set(sectionsNotInArrangement(song));

  const kindItems = (): MenuItem[] =>
    KINDS.map((k) => ({
      id: k,
      label: SECTION_KIND_NAMES[k],
      onSelect: () => {
        // Computed against the current draft so the new id is the one we select.
        const r = addSongSection(song, k);
        onChange((d) => (d === song ? r.song : addSongSection(d, k).song));
        onSelect(r.sectionId);
      },
    }));

  return (
    <section style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8, borderTop: `1px solid ${colors.border}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600, flex: 1 }}>Sections</h2>
        <Button size="sm" variant="ghost" aria-label="Add section" aria-haspopup="menu" icon={<Plus size={14} />} onClick={(e) => ctx.open(e.currentTarget, kindItems())}>
          Section <ChevronDown size={12} aria-hidden style={{ marginLeft: 2 }} />
        </Button>
      </div>
      <ul role="listbox" aria-label="Sections" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 2 }}>
        {song.sections.map((s, i) => {
          const selected = s.id === selectedId;
          const notInArr = unused.has(s.id);
          const line = firstLine(s);
          return (
            <li
              key={s.id}
              role="option"
              aria-selected={selected}
              tabIndex={0}
              title={line ? `${s.label} · ${line}` : s.label}
              draggable
              onClick={() => onSelect(s.id)}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(s.id);
                }
              }}
              onDragStart={(e) => {
                dragFrom.current = i;
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", String(i));
              }}
              onDragOver={(e) => {
                if (dragFrom.current === null) return;
                e.preventDefault();
                setOverIdx(i);
              }}
              onDragLeave={() => setOverIdx((o) => (o === i ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                const from = dragFrom.current;
                dragFrom.current = null;
                setOverIdx(null);
                if (from !== null && from !== i) onChange((d) => moveSongSection(d, from, i));
              }}
              onDragEnd={() => {
                dragFrom.current = null;
                setOverIdx(null);
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                minHeight: 32,
                padding: "4px 8px 4px 0",
                borderRadius: radius.sm,
                background: selected ? colors.brandSubtle : "transparent",
                outline: overIdx === i ? `2px dashed ${colors.accent}` : undefined,
                cursor: "pointer",
                fontSize: 12,
                color: selected ? colors.text : colors.textDim,
              }}
            >
              <span aria-hidden style={{ width: 3, alignSelf: "stretch", borderRadius: 2, background: sectionKindColor[s.kind], flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: selected ? 600 : 400 }}>
                    {s.label}
                  </span>
                  <span style={{ color: colors.textMuted, fontVariantNumeric: "tabular-nums", flexShrink: 0 }} aria-label={`${s.slides.length} slides`}>
                    {s.slides.length}
                  </span>
                </div>
                {notInArr && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <Pill tone="warn">Not in arrangement</Pill>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Add ${s.label} to the end of the arrangement`}
                      onClick={(e) => {
                        e.stopPropagation();
                        onChange((d) => appendToArrangement(d, s.id));
                      }}
                    >
                      Add to end
                    </Button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {ctx.menu}
    </section>
  );
}
