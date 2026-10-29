"use client";

import { Plus, X } from "lucide-react";
import { useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { Song } from "@overlaysys/core";
import { IconButton, Tooltip, colors, radius, useContextMenu, type MenuItem } from "@overlaysys/ui";
import { sectionShortLabel } from "@/lib/rowView";
import { appendToArrangement, firstLine, moveArrangementChip, removeArrangementAt } from "./songDraftOps";
import { sectionChipTextColor, sectionKindColor } from "./slides";

/** A chip whose section is gone (deleted elsewhere, bad import) uses the neutral "other" colour. */
const MISSING_BG = sectionKindColor.other;

/** The default arrangement as coloured chips: drag to reorder, × to remove, "+" to append any section. */
export function ArrangementChips({ song, onChange }: { song: Song; onChange: Dispatch<SetStateAction<Song>> }) {
  const arrangement = song.defaultArrangement ?? [];
  const ctx = useContextMenu();
  const dragFrom = useRef<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  const addItems = (): MenuItem[] =>
    song.sections.map((s) => {
      const line = firstLine(s);
      return {
        id: s.id,
        label: line ? `${s.label} · ${line}` : s.label,
        onSelect: () => onChange((d) => appendToArrangement(d, s.id)),
      };
    });

  return (
    <section style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <h2 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Arrangement</h2>
      <div role="list" aria-label="Arrangement" style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
        {arrangement.length === 0 && (
          <span style={{ fontSize: 12, color: colors.textMuted }}>Empty. Add sections with +.</span>
        )}
        {arrangement.map((sectionId, i) => {
          const section = song.sections.find((s) => s.id === sectionId);
          const bg = section ? sectionKindColor[section.kind] : MISSING_BG;
          const fg = sectionChipTextColor(bg);
          const label = section?.label ?? `${sectionId} (missing)`;
          const short = section ? sectionShortLabel(section, song.sections) : "?";
          const line = section ? firstLine(section) : "";
          return (
            <div
              key={`${sectionId}@${i}`}
              role="listitem"
              draggable
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
                if (from !== null && from !== i) onChange((d) => moveArrangementChip(d, from, i));
              }}
              onDragEnd={() => {
                dragFrom.current = null;
                setOverIdx(null);
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                height: 28,
                paddingLeft: 8,
                borderRadius: radius.pill,
                background: bg,
                color: fg,
                fontSize: 12,
                fontWeight: 600,
                cursor: "grab",
                outline: overIdx === i ? `2px solid ${colors.accent}` : undefined,
                outlineOffset: 1,
              }}
            >
              <Tooltip content={line ? `${label} · ${line}` : label}>
                <span tabIndex={0} aria-label={`${label}, position ${i + 1}`} style={{ outlineOffset: 2 }}>
                  {short}
                </span>
              </Tooltip>
              <IconButton
                aria-label={`Remove ${label} from arrangement`}
                onClick={() => onChange((d) => removeArrangementAt(d, i))}
                style={{ background: "transparent", color: fg, border: 0 }}
              >
                <X size={12} aria-hidden />
              </IconButton>
            </div>
          );
        })}
        <IconButton
          aria-label="Add a section to the arrangement"
          title="Add a section to the arrangement"
          disabled={song.sections.length === 0}
          onClick={(e) => ctx.open(e.currentTarget, addItems())}
        >
          <Plus size={14} aria-hidden />
        </IconButton>
      </div>
      {ctx.menu}
    </section>
  );
}
