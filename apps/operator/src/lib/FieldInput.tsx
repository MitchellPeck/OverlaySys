"use client";

import { ColorInput, ImageInput, VideoInput } from "@overlaysys/editor-kit";
import type { Field } from "@overlaysys/core";

type Props = {
  field: Field;
  value: string | undefined;
  onChange: (v: string) => void;
};

/**
 * Renders the right input control for a Field's declared type. Used by both
 * the show rundown editor and the operator's manual TakePanel so the input
 * stays consistent everywhere a row's data is edited.
 */
export function FieldInput({ field, value, onChange }: Props) {
  const v = value ?? field.default ?? "";
  switch (field.type) {
    case "color":
      return <ColorInput value={v || "#ffffff"} onChange={onChange} />;
    case "image":
      return <ImageInput value={v} onChange={onChange} />;
    case "video":
      return <VideoInput value={v} onChange={onChange} />;
    case "number":
      return (
        <input
          type="number"
          value={value ?? field.default ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.default ?? ""}
          style={inputStyle}
        />
      );
    case "text":
    default:
      return (
        <input
          value={value ?? field.default ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.default ?? ""}
          style={inputStyle}
        />
      );
  }
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "4px 8px",
  background: "var(--panel-2)",
  border: "1px solid var(--border)",
  borderRadius: 3,
  color: "var(--text)",
  fontSize: 12,
  outline: "none",
};

// Video field input now uses the shared editor-kit VideoInput (file
// picker + drag-and-drop + thumbnail preview).
