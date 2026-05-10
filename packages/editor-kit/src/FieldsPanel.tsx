import type { Draft } from "immer";
import type { Field, Template } from "@overlaysys/core";
import { ColorInput } from "./ColorInput";
import { ImageInput } from "./ImageInput";
import { VideoInput } from "./VideoInput";

type Props = {
  template: Template;
  onCommit: (recipe: (d: Draft<Template>) => void) => void;
  /** Optional uploader for image/video field-default file pickers. Without
   * it, picked files fall back to inline data URLs. */
  onUpload?: (file: File) => Promise<string>;
};

export function FieldsPanel({ template, onCommit, onUpload }: Props) {
  function add() {
    const key = uniqueKey(template.fields);
    onCommit((d) => {
      d.fields.push({ key, label: key, type: "text", default: "" });
    });
  }
  function remove(key: string) {
    onCommit((d) => {
      d.fields = d.fields.filter((f) => f.key !== key);
    });
  }
  function patch(key: string, patch: Partial<Field>) {
    onCommit((d) => {
      const f = d.fields.find((f) => f.key === key);
      if (!f) return;
      Object.assign(f, patch);
    });
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: "var(--text-dim, #9099a8)", textTransform: "uppercase", letterSpacing: 1.2 }}>
          Fields ({template.fields.length})
        </span>
        <button onClick={add} style={btnStyle}>+ Add field</button>
      </div>
      {template.fields.length === 0 ? (
        <p style={{ color: "var(--text-dim, #9099a8)", fontSize: 12, marginTop: 8 }}>
          No fields declared. Add a field to make a property data-driven (e.g. operator-typed name).
        </p>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {template.fields.map((f, i) => (
            // Use index, not f.key, as the React key. Typing in the field-key
            // input mutates f.key, which would otherwise remount this <li>
            // (and unmount its inputs) on every keystroke, killing cursor
            // position. Index is stable while editing a single field.
            <li
              key={i}
              style={{
                marginBottom: 6,
                padding: 8,
                background: "var(--panel-2, #1c1f25)",
                border: "1px solid var(--border, #2a2e36)",
                borderRadius: 4,
              }}
            >
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 6 }}>
                <input
                  value={f.key}
                  onChange={(e) => patch(f.key, { key: e.target.value })}
                  style={{ ...inputStyle, fontFamily: "ui-monospace, monospace", fontSize: 11 }}
                  title="Field key (used by template authors and CSV import)"
                />
                <input
                  value={f.label}
                  onChange={(e) => patch(f.key, { label: e.target.value })}
                  style={inputStyle}
                  title="Human-readable label shown in operator UI"
                />
                <select
                  value={f.type}
                  onChange={(e) => {
                    const next = e.target.value as Field["type"];
                    // Reset the default when switching type so we don't carry a
                    // hex string into a number field, etc.
                    patch(f.key, { type: next, default: defaultForType(next) });
                  }}
                  style={inputStyle}
                >
                  <option value="text">text</option>
                  <option value="image">image</option>
                  <option value="video">video</option>
                  <option value="color">color</option>
                  <option value="number">number</option>
                </select>
              </div>
              <div style={{ marginTop: 6, display: "grid", gridTemplateColumns: "60px 1fr auto", gap: 6, alignItems: "center" }}>
                <span style={{ fontSize: 11, color: "var(--text-dim, #9099a8)" }}>default</span>
                <DefaultEditor field={f} onChange={(v) => patch(f.key, { default: v })} onUpload={onUpload} />
                <button onClick={() => remove(f.key)} style={delBtnStyle}>×</button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DefaultEditor({
  field,
  onChange,
  onUpload,
}: {
  field: Field;
  onChange: (v: string) => void;
  onUpload?: (file: File) => Promise<string>;
}) {
  const v = field.default ?? "";
  switch (field.type) {
    case "color":
      return <ColorInput value={v || "#ffffff"} onChange={onChange} />;
    case "image":
      return <ImageInput value={v} onChange={onChange} onUpload={onUpload} />;
    case "video":
      return <VideoInput value={v} onChange={onChange} onUpload={onUpload} />;
    case "number":
      return (
        <input
          type="number"
          value={v}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0"
          style={inputStyle}
        />
      );
    case "text":
    default:
      return (
        <input
          value={v}
          onChange={(e) => onChange(e.target.value)}
          placeholder="default value"
          style={inputStyle}
        />
      );
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

const inputStyle: React.CSSProperties = {
  padding: "4px 6px",
  background: "var(--panel, #14161a)",
  border: "1px solid var(--border, #2a2e36)",
  borderRadius: 3,
  color: "var(--text, #e9eaee)",
  fontSize: 12,
  outline: "none",
  width: "100%",
};
const btnStyle: React.CSSProperties = {
  padding: "4px 8px",
  background: "var(--panel-2, #1c1f25)",
  color: "var(--text, #e9eaee)",
  border: "1px solid var(--border, #2a2e36)",
  borderRadius: 3,
  fontSize: 11,
  cursor: "pointer",
};
const delBtnStyle: React.CSSProperties = {
  padding: "4px 10px",
  background: "transparent",
  color: "var(--red, #f87171)",
  border: "1px solid var(--red, #f87171)",
  borderRadius: 3,
  fontSize: 12,
  cursor: "pointer",
};
