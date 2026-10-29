import { useRef, useState } from "react";
import { FolderOpen, Image as ImageIcon, X } from "lucide-react";
import { IconButton, Input, colors, fontFamily, radius } from "@overlaysys/ui";

type Props = {
  value: string;
  onChange: (v: string) => void;
  /**
   * If provided, picked files are uploaded via this function and the returned
   * URL is stored. Without it, the file is read as a data URL (useful for
   * standalone editor-kit consumers and fixture work).
   */
  onUpload?: (file: File) => Promise<string>;
  /** Turns the stored value into a URL this page can load, for the preview only. */
  resolveUrl?: (src: string) => string;
  /** Id for the path field, so a FieldRow label focuses it. */
  id?: string;
};

/**
 * Image source input. Accepts any URL the renderer can fetch (https://, file:,
 * data:, or relative paths). When `onUpload` is wired, picked files go through
 * that path; otherwise the file is embedded inline as a data URL.
 */
export function ImageInput({ value, onChange, onUpload, resolveUrl, id }: Props) {
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
  const previewSrc = value ? (resolveUrl ? resolveUrl(value) : value) : null;

  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: "flex", gap: 4, alignItems: "center", width: "100%", minWidth: 0 }}>
        <div
          style={{
            width: 32,
            height: 24,
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: radius.sm,
            overflow: "hidden",
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {previewSrc ? (
            <img
              key={previewSrc}
              src={previewSrc}
              alt=""
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
              onError={(e) => {
                (e.target as HTMLImageElement).style.display = "none";
              }}
            />
          ) : (
            <ImageIcon size={12} aria-hidden style={{ color: colors.textMuted }} />
          )}
        </div>
        <Input
          id={id}
          value={isDataUrl ? "(embedded image)" : value}
          readOnly={isDataUrl}
          onChange={(e) => onChange(e.target.value)}
          placeholder="URL or path"
          title={isDataUrl ? "Inline data URL — clear to paste a new URL" : value || undefined}
          style={{
            flex: 1,
            minWidth: 0,
            color: isDataUrl ? colors.textDim : colors.text,
            fontFamily: isDataUrl ? fontFamily.mono : undefined,
          }}
        />
        <IconButton
          size={24}
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          aria-label={onUpload ? "Upload image" : "Embed image file"}
          title={onUpload ? "Upload file" : "Embed as data URL"}
        >
          {uploading ? "…" : <FolderOpen size={14} aria-hidden />}
        </IconButton>
        {value && (
          <IconButton size={24} onClick={() => onChange("")} aria-label="Clear image" title="Clear">
            <X size={14} aria-hidden />
          </IconButton>
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
      </div>
      {error && (
        <div role="alert" style={{ marginTop: 4, fontSize: 11, color: colors.dangerText }}>
          {error}
        </div>
      )}
    </div>
  );
}
