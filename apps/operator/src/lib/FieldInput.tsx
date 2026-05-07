"use client";

import { useRef } from "react";
import { ColorInput, ImageInput } from "@overlaysys/editor-kit";
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

/**
 * Operator-side video field input. Accepts either a path/URL typed in,
 * or a local file dropped/selected (encoded as a `data:` URL — fine for
 * short stings, less ideal for full videos which should sit on disk and
 * be referenced by path).
 */
function VideoInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  function pickFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const r = reader.result;
      if (typeof r === "string") onChange(r);
    };
    reader.readAsDataURL(file);
  }
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
      <input
        value={value.startsWith("data:") ? "(embedded video)" : value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="path/url or pick file →"
        readOnly={value.startsWith("data:")}
        style={{ ...inputStyle, flex: 1 }}
      />
      <button
        onClick={() => fileRef.current?.click()}
        style={{
          padding: "4px 8px",
          background: "var(--panel-2)",
          color: "var(--text)",
          border: "1px solid var(--border)",
          borderRadius: 3,
          fontSize: 11,
          cursor: "pointer",
        }}
      >
        Pick…
      </button>
      {value && (
        <button
          onClick={() => onChange("")}
          title="Clear"
          style={{
            padding: "4px 8px",
            background: "transparent",
            color: "var(--text-dim)",
            border: "1px solid var(--border)",
            borderRadius: 3,
            fontSize: 11,
            cursor: "pointer",
          }}
        >
          ×
        </button>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="video/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) pickFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
