"use client";

import { useMemo, useState } from "react";
import { Modal, Button, colors } from "@overlaysys/ui";
import type { Song } from "@overlaysys/core";

// Subtle accent per section kind, matching the app's token palette.
const KIND_ACCENT: Record<string, { bg: string; border: string }> = {
  chorus: { bg: "rgba(99,102,241,.16)", border: "rgba(99,102,241,.5)" },
  bridge: { bg: "rgba(245,158,11,.12)", border: "rgba(245,158,11,.5)" },
};

/** Compact "V1 · C · V2" summary of an arrangement, reused by both editors. */
export function arrangementSummary(ids: string[], song: Song): string {
  return ids
    .map((id) => song.sections.find((s) => s.id === id)?.label ?? id)
    .join(" · ");
}

export function ArrangementModal({
  song,
  level,
  value,
  inherited,
  onSave,
  onClose,
}: {
  song: Song;
  level: "show" | "row";
  value: string[] | undefined;
  inherited: string[];
  onSave: (next: string[] | undefined) => void;
  onClose: () => void;
}) {
  const validIds = useMemo(() => new Set(song.sections.map((s) => s.id)), [song]);
  const sectionById = useMemo(
    () => new Map(song.sections.map((s) => [s.id, s] as const)),
    [song],
  );

  // Seed from this level's override if present, else the inherited fallback.
  // Filter stale ids (a section may have been deleted from the song since).
  const seed = value ?? inherited;
  const droppedCount = seed.filter((id) => !validIds.has(id)).length;
  const [seq, setSeq] = useState<string[]>(() => seed.filter((id) => validIds.has(id)));
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const overriding = value !== undefined;
  const fallbackLabel = level === "show" ? "the song default" : "the show / song default";

  function append(id: string) {
    setSeq((s) => [...s, id]);
  }
  function removeAt(i: number) {
    setSeq((s) => s.filter((_, j) => j !== i));
  }
  function onDrop(target: number) {
    if (dragIdx === null || dragIdx === target) {
      setDragIdx(null);
      return;
    }
    setSeq((s) => {
      const next = [...s];
      const [moved] = next.splice(dragIdx, 1);
      next.splice(target, 0, moved!);
      return next;
    });
    setDragIdx(null);
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title={`Arrangement — ${level === "show" ? "Show override" : "This row"}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {overriding && (
            <Button
              variant="danger"
              onClick={() => {
                onSave(undefined);
                onClose();
              }}
            >
              Reset to inherited
            </Button>
          )}
          <Button
            variant="primary"
            disabled={seq.length === 0}
            onClick={() => {
              onSave(seq);
              onClose();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div
        style={{
          fontSize: 12.5,
          color: colors.textDim,
          background: colors.surface2,
          border: `1px solid ${colors.borderStrong}`,
          borderRadius: 8,
          padding: "8px 12px",
          marginBottom: 12,
        }}
      >
        {overriding
          ? `Overriding arrangement at the ${level} level.`
          : `Currently inheriting from ${fallbackLabel}. Editing here creates a ${level}-level override.`}
        {droppedCount > 0 && (
          <span style={{ color: colors.warn }}>
            {" "}
            {droppedCount} section(s) removed — no longer in the song.
          </span>
        )}
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 7,
          alignItems: "center",
          minHeight: 46,
          padding: 10,
          background: colors.bg,
          border: `1px dashed ${colors.borderStrong}`,
          borderRadius: 10,
        }}
      >
        {seq.length === 0 && (
          <span style={{ color: colors.textDim, fontSize: 12.5 }}>
            Empty — add sections below, or{" "}
            <button
              type="button"
              onClick={() => setSeq(inherited.filter((id) => validIds.has(id)))}
              style={{
                background: "none",
                border: "none",
                color: colors.brand,
                cursor: "pointer",
                textDecoration: "underline",
                padding: 0,
                font: "inherit",
              }}
            >
              start from inherited
            </button>
            .
          </span>
        )}
        {seq.map((id, i) => {
          const sec = sectionById.get(id);
          const accent = sec ? KIND_ACCENT[sec.kind] : undefined;
          return (
            <span
              key={i}
              draggable
              onDragStart={() => setDragIdx(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop(i)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                background: accent?.bg ?? colors.surface2,
                border: `1px solid ${accent?.border ?? colors.borderStrong}`,
                borderRadius: 8,
                padding: "6px 8px",
                fontSize: 12.5,
                fontWeight: 500,
              }}
            >
              <span style={{ cursor: "grab", color: colors.textMuted }}>⠿</span>
              {sec?.label ?? id}
              <span
                onClick={() => removeAt(i)}
                style={{ cursor: "pointer", color: colors.textMuted, fontWeight: 700 }}
              >
                ×
              </span>
            </span>
          );
        })}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12, alignItems: "center" }}>
        <span style={{ color: colors.textDim, fontSize: 12 }}>Add:</span>
        {song.sections.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => append(s.id)}
            style={{
              font: "inherit",
              fontSize: 12,
              fontWeight: 600,
              padding: "5px 10px",
              borderRadius: 7,
              border: `1px dashed ${colors.borderStrong}`,
              background: "transparent",
              color: colors.textDim,
              cursor: "pointer",
            }}
          >
            + {s.label}
          </button>
        ))}
      </div>
    </Modal>
  );
}
