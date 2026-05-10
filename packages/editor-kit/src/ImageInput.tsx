import { useRef, useState } from "react";

type Props = {
  value: string;
  onChange: (v: string) => void;
  /**
   * If provided, picked files are uploaded via this function and the returned
   * URL is stored. Without it, the file is read as a data URL (useful for
   * standalone editor-kit consumers and fixture work).
   */
  onUpload?: (file: File) => Promise<string>;
};

/**
 * Image source input. Accepts any URL the renderer can fetch (https://, file:,
 * data:, or relative paths). When `onUpload` is wired, picked files go through
 * that path; otherwise the file is embedded inline as a data URL.
 */
export function ImageInput({ value, onChange, onUpload }: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File) {
    setError(null);
    if (onUpload) {
      setUploading(true);
      try {
        const url = await onUpload(file);
        onChange(url);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setUploading(false);
      }
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") onChange(reader.result);
    };
    reader.readAsDataURL(file);
  }

  const isDataUrl = value.startsWith("data:");
  const previewSrc = value || null;

  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", width: "100%" }}>
      <div
        style={{
          width: 32,
          height: 24,
          background: "var(--panel, #14161a)",
          border: "1px solid var(--border, #2a2e36)",
          borderRadius: 3,
          overflow: "hidden",
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {previewSrc ? (
          <img
            src={previewSrc}
            alt=""
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <span style={{ color: "var(--text-dim, #9099a8)", fontSize: 14 }}>🖼</span>
        )}
      </div>
      <input
        value={isDataUrl ? "(data url)" : value}
        readOnly={isDataUrl}
        onChange={(e) => onChange(e.target.value)}
        placeholder="https://… or path"
        title={isDataUrl ? "Inline data URL — clear to paste a new URL" : undefined}
        style={{
          flex: 1,
          minWidth: 0,
          padding: "4px 8px",
          background: "var(--panel-2, #1c1f25)",
          border: "1px solid var(--border, #2a2e36)",
          borderRadius: 3,
          color: isDataUrl ? "var(--text-dim, #9099a8)" : "var(--text, #e9eaee)",
          fontSize: 12,
          outline: "none",
          fontFamily: isDataUrl ? "ui-monospace, monospace" : undefined,
        }}
      />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        title={onUpload ? "Upload file" : "Embed as data URL"}
        style={{
          width: 28,
          height: 24,
          background: "var(--panel-2, #1c1f25)",
          border: "1px solid var(--border, #2a2e36)",
          borderRadius: 3,
          cursor: uploading ? "wait" : "pointer",
          fontSize: 12,
          opacity: uploading ? 0.6 : 1,
        }}
      >
        {uploading ? "…" : "📁"}
      </button>
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          title="Clear"
          style={{
            width: 24,
            height: 24,
            background: "transparent",
            color: "var(--text-dim, #9099a8)",
            border: "1px solid var(--border, #2a2e36)",
            borderRadius: 3,
            cursor: "pointer",
            fontSize: 14,
          }}
        >
          ×
        </button>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
      {error && (
        <div
          style={{
            position: "absolute",
            marginTop: 28,
            padding: "2px 6px",
            background: "var(--red, #f87171)",
            color: "#0c0d10",
            fontSize: 10,
            borderRadius: 3,
            zIndex: 5,
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
