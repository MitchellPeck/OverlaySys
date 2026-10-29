"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { SermonNotes, Show } from "@overlaysys/core";
import { Input, KindBar, Select, Textarea, colors, fontSize, type ItemKind } from "@overlaysys/ui";
import { useResolvedChannelConfigs } from "@/lib/useResolvedChannels";
import { formatRowLength, parseRowLength } from "@/lib/rowLength";
import type { RowLike } from "@/lib/rowLike";
import { NotesSetPicker } from "../SermonNotesEditor";
import { ItemPreview } from "../ItemPreview";
import { cueNoteRows, itemHeading, lengthFieldHint, outputOptions } from "./itemFormModel";

/** A labelled form row: `90px 1fr` grid. */
export function FormRow({ label, children, htmlFor }: { label: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "90px 1fr", gap: 8, alignItems: "start" }}>
      <label htmlFor={htmlFor} style={{ fontSize: fontSize.sm, color: colors.textDim, paddingTop: 5 }}>
        {label}
      </label>
      <div style={{ minWidth: 0 }}>{children}</div>
    </div>
  );
}

/**
 * Item form layout: "<Kind> · <name>" header, the labelled fields on the left
 * and the live preview at the top right (46%).
 */
export function ItemFormFrame({
  row,
  show,
  name,
  children,
}: {
  row: RowLike;
  show: Show;
  name: string;
  children: ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h2 style={{ margin: 0, fontSize: fontSize.base, fontWeight: 600, display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <KindBar kind={(KIND_BARS.includes(row.kind) ? row.kind : "graphic") as ItemKind} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{itemHeading(row.kind, name)}</span>
      </h2>
      <div style={{ display: "flex", gap: 20, alignItems: "flex-start", minWidth: 0 }}>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>{children}</div>
        <aside style={{ flex: "0 0 46%", maxWidth: 380, minWidth: 0, position: "sticky", top: 0 }}>
          <ItemPreview row={row} show={show} />
        </aside>
      </div>
    </div>
  );
}

const KIND_BARS = ["graphic", "song", "scripture", "video", "slides"];

type CommonRow =RowLike & { channelHint?: string; lengthSec?: number; notes?: string; sermonNotesId?: string };

/** Output, Length, Cue note and (graphic/scripture) Sermon notes for any item. */
export function ItemCommonFields({
  row,
  onChange,
  showSermonNotes,
  sets,
  outputHint,
}: {
  row: RowLike;
  onChange(patch: Partial<RowLike> & Record<string, unknown>): void;
  showSermonNotes: boolean;
  sets: SermonNotes[];
  /** Muted note under Output, e.g. what an unset song output falls back to. */
  outputHint?: string | null;
}) {
  const r = row as CommonRow;
  const channels = useResolvedChannelConfigs();
  // Mirror channels show another channel's state; targeting one would do nothing.
  const takeable = useMemo(() => channels.filter((c) => !c.mirrorOf), [channels]);
  const options = outputOptions(takeable, r.channelHint);
  return (
    <>
      <FormRow label="Output" htmlFor={`out-${row.id}`}>
        <Select
          id={`out-${row.id}`}
          value={r.channelHint ?? ""}
          onChange={(e) => onChange({ channelHint: e.target.value || undefined })}
          style={{ maxWidth: 320, minWidth: 180 }}
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
        {outputHint && !r.channelHint && (
          <div style={{ fontSize: fontSize.xs, color: colors.textMuted, marginTop: 4 }}>{outputHint}</div>
        )}
      </FormRow>
      <FormRow label="Length" htmlFor={`len-${row.id}`}>
        <LengthInput
          id={`len-${row.id}`}
          value={r.lengthSec}
          onCommit={(lengthSec) => onChange({ lengthSec, lengthSecManual: true })}
        />
      </FormRow>
      <FormRow label="Cue note" htmlFor={`cue-${row.id}`}>
        <CueNote id={`cue-${row.id}`} value={r.notes ?? ""} onChange={(notes) => onChange({ notes: notes || undefined })} />
      </FormRow>
      {showSermonNotes && sets.length > 0 && (
        <FormRow label="Sermon notes">
          <NotesSetPicker sets={sets} value={r.sermonNotesId} onChange={(v) => onChange({ sermonNotesId: v })} />
        </FormRow>
      )}
    </>
  );
}

/** Cue note: grows with its text (lines and wrapping) from 1 to 4 rows, then scrolls. */
function CueNote({ id, value, onChange }: { id: string; value: string; onChange(v: string): void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current?.querySelector("textarea");
    if (!el) return;
    let rows = cueNoteRows(value);
    el.rows = rows;
    while (rows < 4 && el.scrollHeight > el.clientHeight + 1) el.rows = ++rows;
  }, [value]);
  return (
    <div ref={ref}>
      <Textarea
        id={id}
        value={value}
        rows={1}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Operator cue…"
        style={{ width: "100%", resize: "none", overflowX: "hidden", boxSizing: "border-box" }}
      />
    </div>
  );
}

/** "Length" text input: live echo, red border + "Use M:SS" when it can't parse; commits valid text on blur/Enter. */
function LengthInput({ id, value, onCommit }: { id: string; value: number | undefined; onCommit(sec: number | undefined): void }) {
  const [text, setText] = useState(formatRowLength(value));
  const focusedRef = useRef(false);
  // Follow the model (undo, video prefill) but never clobber typing.
  useEffect(() => {
    if (!focusedRef.current) setText(formatRowLength(value));
  }, [value]);
  const { invalid, hint } = lengthFieldHint(text);
  const commit = () => {
    const parsed = parseRowLength(text);
    if (!parsed.ok) return;
    if (parsed.sec !== value) onCommit(parsed.sec);
    setText(formatRowLength(parsed.sec));
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <Input
        id={id}
        value={text}
        invalid={invalid}
        aria-invalid={invalid || undefined}
        onChange={(e) => setText(e.target.value)}
        onFocus={() => {
          focusedRef.current = true;
        }}
        onBlur={() => {
          focusedRef.current = false;
          commit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
        }}
        placeholder="M:SS"
        title="Length (M:SS). Starts the item countdown when taken."
        style={{ width: 90 }}
      />
      {hint && (
        <span role={invalid ? "alert" : undefined} style={{ fontSize: fontSize.xs, color: invalid ? colors.dangerText : colors.textMuted }}>
          {hint}
        </span>
      )}
    </div>
  );
}
