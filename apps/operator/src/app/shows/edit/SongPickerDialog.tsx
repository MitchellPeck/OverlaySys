"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Button, Checkbox, Input, Modal, colors, fontSize } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { rankSongs } from "./songPicker";
import { addSongsLabel, pickRange, toggleSongPick } from "./forms/itemFormModel";

/**
 * Pick songs from the library. Type-ahead over title, author and CCLI number
 * (recent first). Multi mode: tick songs (click, or Enter on the highlighted
 * row) and "Add N songs" inserts them in the picked order. Single mode: a
 * click or Enter picks the song at once.
 */
export function SongPickerDialog({
  open,
  onClose,
  onAdd,
  single = false,
  recentIds = [],
  title,
}: {
  open: boolean;
  onClose(): void;
  onAdd(songIds: string[]): void;
  single?: boolean;
  recentIds?: string[];
  title?: string;
}) {
  const songs = useStore((s) => s.songs);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  // Last picked row: shift-click (or shift-Enter) picks the range from it.
  const anchorRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setPicked([]);
    setActive(0);
    anchorRef.current = null;
  }, [open]);

  const results = useMemo(() => rankSongs(songs, query, recentIds), [songs, query, recentIds]);
  const activeId = results[Math.min(active, results.length - 1)]?.id;

  useEffect(() => {
    if (!activeId) return;
    listRef.current?.querySelector(`[data-song-id="${CSS.escape(activeId)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  function choose(id: string, index: number, shift = false) {
    if (single) {
      onAdd([id]);
      return;
    }
    const anchor = anchorRef.current;
    if (shift && anchor !== null && anchor !== index) {
      const ids = results.map((s) => s.id);
      setPicked((p) => pickRange(p, ids, anchor, index));
    } else {
      setPicked((p) => toggleSongPick(p, id));
    }
    anchorRef.current = index;
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(results.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      if ((e.metaKey || e.ctrlKey) && !single && picked.length > 0) {
        onAdd(picked);
        return;
      }
      if (activeId) choose(activeId, Math.min(active, results.length - 1), e.shiftKey);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title ?? (single ? "Change song" : "Add songs")}
      size="md"
      footer={
        single ? (
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        ) : (
          <>
            <span style={{ marginRight: "auto", fontSize: fontSize.xs, color: colors.textMuted }}>
              Enter ticks · Shift-click picks a range · ⌘Enter adds
            </span>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" disabled={picked.length === 0} onClick={() => onAdd(picked)}>
              {addSongsLabel(picked.length)}
            </Button>
          </>
        )
      }
    >
      <div onKeyDown={onKeyDown} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <Input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          placeholder="Search title, author or CCLI number"
          aria-label="Search songs"
          aria-controls="song-picker-list"
          aria-activedescendant={activeId ? `song-opt-${activeId}` : undefined}
        />
        <div
          ref={listRef}
          id="song-picker-list"
          role="listbox"
          aria-multiselectable={!single || undefined}
          aria-label="Songs"
          style={{ maxHeight: 360, overflowY: "auto", border: `1px solid ${colors.border}`, borderRadius: 6 }}
        >
          {results.length === 0 && (
            <p style={{ margin: 0, padding: 12, color: colors.textMuted, fontSize: fontSize.sm }}>
              {songs.length === 0 ? "No songs in the library yet." : "No songs match."}
            </p>
          )}
          {results.map((s, i) => {
            const order = picked.indexOf(s.id);
            const isActive = s.id === activeId;
            return (
              <div
                key={s.id}
                id={`song-opt-${s.id}`}
                data-song-id={s.id}
                role="option"
                aria-selected={single ? isActive : order >= 0}
                onMouseEnter={() => setActive(i)}
                onClick={(e) => choose(s.id, i, e.shiftKey)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "6px 10px",
                  cursor: "pointer",
                  background: isActive ? colors.control : "transparent",
                  borderBottom: `1px solid ${colors.border}`,
                }}
              >
                {!single && (
                  // The row's click picks (shift-click too); the box only shows the state.
                  <span aria-hidden style={{ display: "flex", pointerEvents: "none" }}>
                    <Checkbox checked={order >= 0} onChange={() => undefined} aria-label={`Pick ${s.title}`} />
                  </span>
                )}
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {s.title}
                  {s.author && <span style={{ color: colors.textMuted, fontSize: fontSize.xs }}> · {s.author}</span>}
                </span>
                {s.ccliNumber && <span style={{ color: colors.textMuted, fontSize: fontSize.xs }}>CCLI {s.ccliNumber}</span>}
                {order >= 0 && (
                  <span aria-hidden style={{ fontSize: fontSize.xs, color: colors.textDim, width: 18, textAlign: "right" }}>
                    {order + 1}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
