"use client";

import type { Draft } from "immer";
import { useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { Field, Template } from "@overlaysys/core";
import { Button, IconButton, Input, NumberInput, Select, colors, fontFamily, fontSize, radius } from "@overlaysys/ui";
import { ColorInput } from "./ColorInput";
import { ImageInput } from "./ImageInput";
import { VideoInput } from "./VideoInput";
import type { PickFromLibraryFn } from "./PropertyInspector";
import { AutoTextarea } from "./AutoTextarea";
import { useEditCoalescer } from "./editCoalescer";
import { fieldKeyError, fieldUsage, removeField, renameFieldKey } from "./templateOps";

type Props = {
  template: Template;
  onCommit: (recipe: (d: Draft<Template>) => void) => void;
  /** Apply without a new undo step (typing coalesces into one step per field edit). */
  onLive?: (recipe: (d: Draft<Template>) => void) => void;
  /** Optional uploader for image/video field-default file pickers. Without
   * it, picked files fall back to inline data URLs. */
  onUpload?: (file: File) => Promise<string>;
  /** Turns a stored asset path into a URL this page can load (previews only). */
  resolveUrl?: (src: string) => string;
  /** When provided, image and video defaults offer "Choose from Media". */
  onPickFromLibrary?: PickFromLibraryFn;
};

/** Key | label | type | delete. The key and label columns share what's left of a 300 px inspector. */
const CARD_COLUMNS = "minmax(0, 1fr) minmax(0, 1fr) 84px 24px";

const TYPE_OPTIONS: { value: Field["type"]; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "image", label: "Image" },
  { value: "video", label: "Video" },
  { value: "color", label: "Color" },
  { value: "number", label: "Number" },
  { value: "time", label: "Time" },
];

export function FieldsPanel({ template, onCommit: commitStep, onLive, onUpload, resolveUrl, onPickFromLibrary }: Props) {
  const { commit: onCommit, handlers } = useEditCoalescer(commitStep, onLive);
  function add() {
    const key = uniqueKey(template.fields);
    onCommit((d) => {
      d.fields.push({ key, label: key, type: "text", default: "" });
    });
  }
  // Bound layers keep showing the field's default as a literal.
  function remove(key: string) {
    onCommit(removeField(key));
  }
  function patch(key: string, patch: Partial<Field>) {
    onCommit((d) => {
      const f = d.fields.find((f) => f.key === key);
      if (!f) return;
      Object.assign(f, patch);
    });
  }

  return (
    <div style={{ minWidth: 0 }} {...handlers}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <h4 style={sectionHeading}>Fields ({template.fields.length})</h4>
        <Button size="sm" variant="ghost" icon={<Plus size={14} aria-hidden />} onClick={add}>
          Add field
        </Button>
      </div>
      {template.fields.length === 0 ? (
        <p style={{ color: colors.textDim, fontSize: fontSize.sm, margin: "4px 0 0", lineHeight: 1.4 }}>
          No fields yet. Add one to fill a layer from the rundown (for example, a name typed by the operator).
        </p>
      ) : (
        <>
          <div
            aria-hidden
            style={{ display: "grid", gridTemplateColumns: CARD_COLUMNS, gap: 4, padding: "0 7px 2px", fontSize: fontSize["2xs"], color: colors.textMuted }}
          >
            <span>Key</span>
            <span>Label</span>
            <span>Type</span>
          </div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
            {template.fields.map((f, i) => {
              const usedBy = fieldUsage(template, f.key);
              const name = f.label || f.key;
              return (
                // Index, not f.key, as the React key: a rename must not remount
                // the row (and drop focus) when it commits.
                <li
                  key={i}
                  style={{
                    padding: 6,
                    background: colors.surface2,
                    border: `1px solid ${colors.border}`,
                    borderRadius: radius.md,
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    minWidth: 0,
                  }}
                >
                  <div style={{ display: "grid", gridTemplateColumns: CARD_COLUMNS, gap: 4, alignItems: "center" }}>
                    <FieldKeyInput
                      fields={template.fields}
                      index={i}
                      value={f.key}
                      onRename={(next) => onCommit(renameFieldKey(f.key, next))}
                    />
                    <Input
                      aria-label={`Label of field ${f.key}`}
                      value={f.label}
                      onChange={(e) => patch(f.key, { label: e.target.value })}
                      title="Shown to the operator in the rundown"
                    />
                    <Select
                      aria-label={`Type of field ${f.key}`}
                      value={f.type}
                      onChange={(e) => {
                        const next = e.target.value as Field["type"];
                        // Reset the default when switching type so we don't carry a
                        // hex string into a number field, etc. Time-specific
                        // sub-config (timeMode/timeFormat) gets seeded with sane
                        // defaults so the field works without further configuration.
                        const patchObj: Partial<Field> =
                          next === "time"
                            ? { type: next, default: "", timeMode: f.timeMode ?? "countdown", timeFormat: f.timeFormat ?? "MM:SS" }
                            : { type: next, default: defaultForType(next), timeMode: undefined, timeFormat: undefined };
                        patch(f.key, patchObj);
                      }}
                    >
                      {TYPE_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                    <DeleteFieldButton
                      label={name}
                      title={
                        usedBy.length > 0
                          ? `Delete — ${usedBy.join(", ")} will keep its current default as fixed content`
                          : "Delete field"
                      }
                      onClick={() => remove(f.key)}
                    />
                  </div>
                  {f.type === "time" && (
                    <div
                      style={{ display: "grid", gridTemplateColumns: "48px minmax(0, 1fr) minmax(0, 1fr)", gap: 4, alignItems: "center" }}
                      title="The mode is fixed in the template. Operators only supply the duration or start time."
                    >
                      <span style={rowLabel}>Mode</span>
                      <Select
                        aria-label={`Mode of field ${f.key}`}
                        value={f.timeMode ?? "countdown"}
                        onChange={(e) => patch(f.key, { timeMode: e.target.value as NonNullable<Field["timeMode"]> })}
                      >
                        <option value="countdown">Countdown</option>
                        <option value="countup">Count up</option>
                        <option value="clock">Clock</option>
                      </Select>
                      <Select
                        aria-label={`Format of field ${f.key}`}
                        value={f.timeFormat ?? "MM:SS"}
                        onChange={(e) => patch(f.key, { timeFormat: e.target.value as NonNullable<Field["timeFormat"]> })}
                        title="Display format"
                      >
                        <option value="MM:SS">MM:SS</option>
                        <option value="M:SS">M:SS</option>
                        <option value="HH:MM:SS">HH:MM:SS</option>
                        <option value="H:MM:SS">H:MM:SS</option>
                        <option value="HH:MM">HH:MM</option>
                        <option value="H:MM">H:MM</option>
                      </Select>
                    </div>
                  )}
                  <div style={{ display: "grid", gridTemplateColumns: "48px minmax(0, 1fr)", gap: 4, alignItems: "start" }}>
                    <span style={{ ...rowLabel, lineHeight: "24px" }}>Default</span>
                    <DefaultEditor
                      field={f}
                      onChange={(v) => patch(f.key, { default: v })}
                      onUpload={onUpload}
                      resolveUrl={resolveUrl}
                      onPickFromLibrary={onPickFromLibrary}
                    />
                  </div>
                  {usedBy.length > 0 && (
                    <div style={{ fontSize: fontSize["2xs"], color: colors.textMuted, overflowWrap: "anywhere" }}>Used by {usedBy.join(", ")}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

/** A ghost trash icon that turns red on hover or focus. */
function DeleteFieldButton({ label, title, onClick }: { label: string; title: string; onClick: () => void }) {
  const [hot, setHot] = useState(false);
  return (
    <IconButton
      size={24}
      aria-label={"Delete field " + label}
      title={title}
      onClick={onClick}
      onMouseEnter={() => setHot(true)}
      onMouseLeave={() => setHot(false)}
      onFocus={() => setHot(true)}
      onBlur={() => setHot(false)}
      style={{ border: "none", color: hot ? colors.dangerText : colors.textMuted }}
    >
      <Trash2 size={14} aria-hidden />
    </IconButton>
  );
}

/**
 * Field key editor. Commits on blur / Enter (not per keystroke, which would
 * break every binding mid-word), rewrites the layers bound to the old key,
 * and refuses empty, malformed or duplicate keys. Escape reverts.
 */
function FieldKeyInput({
  fields,
  index,
  value,
  onRename,
}: {
  fields: readonly Field[];
  index: number;
  value: string;
  onRename: (next: string) => void;
}) {
  const [text, setText] = useState(value);
  const skipRef = useRef(false);
  useEffect(() => setText(value), [value]);
  const next = text.trim();
  const error = next === value ? null : fieldKeyError(fields, index, next);

  function commit() {
    if (skipRef.current) {
      skipRef.current = false;
      setText(value);
      return;
    }
    if (next === value || error) {
      setText(value);
      return;
    }
    onRename(next);
  }

  return (
    <Input
      aria-label={`Key of field ${value}`}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          skipRef.current = true;
          e.currentTarget.blur();
        }
      }}
      invalid={!!error}
      aria-invalid={!!error}
      style={{ fontFamily: fontFamily.mono, fontSize: fontSize.xs }}
      title={error ?? "Field key (used by bindings and CSV import). Renaming updates bound layers."}
    />
  );
}

function DefaultEditor({
  field,
  onChange,
  onUpload,
  resolveUrl,
  onPickFromLibrary,
}: {
  field: Field;
  onChange: (v: string) => void;
  onUpload?: (file: File) => Promise<string>;
  resolveUrl?: (src: string) => string;
  onPickFromLibrary?: PickFromLibraryFn;
}) {
  const v = field.default ?? "";
  const label = `Default of field ${field.key}`;
  switch (field.type) {
    case "color":
      return <ColorInput label={label} value={v || "#ffffff"} onChange={onChange} />;
    case "image":
      return <ImageInput value={v} onChange={onChange} onUpload={onUpload} resolveUrl={resolveUrl} onPickFromLibrary={onPickFromLibrary && (() => onPickFromLibrary("image"))} />;
    case "video":
      return <VideoInput value={v} onChange={onChange} onUpload={onUpload} resolveUrl={resolveUrl} onPickFromLibrary={onPickFromLibrary && (() => onPickFromLibrary("video"))} />;
    case "number":
      return (
        <NumberInput
          size="sm"
          aria-label={label}
          value={Number.isFinite(Number(v)) ? Number(v) : 0}
          onCommit={(n) => onChange(String(n))}
        />
      );
    case "time":
      // No useful "default" for a time field — operators always supply the
      // anchor at take time.
      return <span style={{ fontSize: fontSize.xs, color: colors.textMuted, lineHeight: "24px" }}>Set when it's taken</span>;
    case "text":
    default:
      return <AutoTextarea aria-label={label} value={v} onChange={onChange} placeholder="Default text" />;
  }
}

function defaultForType(t: Field["type"]): string {
  switch (t) {
    case "color":
      return "#ffffff";
    case "number":
      return "0";
    case "text":
    case "image":
    case "video":
    default:
      return "";
  }
}

function uniqueKey(fields: Field[]): string {
  let i = fields.length + 1;
  while (fields.some((f) => f.key === `field${i}`)) i++;
  return `field${i}`;
}

const sectionHeading: React.CSSProperties = {
  margin: 0,
  fontSize: fontSize.xs,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: colors.textMuted,
};

const rowLabel: React.CSSProperties = { fontSize: fontSize.xs, color: colors.textDim };
