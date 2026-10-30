import { useRef, useState } from "react";
import { Play, X } from "lucide-react";
import { Button, IconButton, Input, colors, fontFamily, radius } from "@overlaysys/ui";

type Props = {
  value: string;
  onChange: (v: string) => void;
  /** When provided, picked/dropped files upload via this; else inline data URL. */
  onUpload?: (file: File) => Promise<string>;
  // [P2a.18] preview src for stored paths ("/assets/…" on the server's origin); the text field still shows `value`.
  resolveUrl?: (v: string) => string;
  // [/P2a.18]
  /** Id for the path field, so a FieldRow label focuses it. */
  id?: string;
  /** When provided, a "Choose from Media" button sets the value to the picked video's URL (null = cancelled). */
  onPickFromLibrary?: () => Promise<{ url: string } | null>;
};

/**
 * Video source input. Mirrors ImageInput's UX: a small thumbnail-ish
 * preview, a path/URL field, a file-picker button, and a clear button.
 * Adds drag-and-drop — drop a video file anywhere on the control to
 * upload it (or embed as a data URL when onUpload isn't wired).
 */
export function VideoInput({ value, onChange, onUpload, resolveUrl, id, onPickFromLibrary }: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
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
  const previewSrc = value ? (resolveUrl ? resolveUrl(value) : value) : "";

  return (
    <div style={{ position: "relative", minWidth: 0 }}>
      <div
        onDragOver={(e) => {
          // Has to happen on dragover (not just drop) for the drop event to fire.
          e.preventDefault();
          e.stopPropagation();
          if (!dragOver) setDragOver(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragOver(false);
          const f = e.dataTransfer?.files?.[0];
          if (f && (f.type.startsWith("video/") || /\.(mp4|webm|mov|m4v|ogv)$/i.test(f.name))) {
            onFile(f);
          }
        }}
        style={{
          display: "flex",
          gap: 4,
          alignItems: "center",
          width: "100%",
          minWidth: 0,
          boxSizing: "border-box",
          padding: dragOver ? 3 : 0,
          background: dragOver ? colors.brandSubtle : "transparent",
          border: dragOver ? `1px dashed ${colors.accent}` : "1px solid transparent",
          borderRadius: radius.md,
          transition: "background 80ms, border-color 80ms",
        }}
      >
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
            // muted+playsInline gives a reliable poster-style preview without
            // autoplay-block warnings; loop so the operator sees motion.
            <video
              key={previewSrc}
              src={previewSrc}
              muted
              playsInline
              loop
              autoPlay
              preload="metadata"
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
              onError={(e) => {
                (e.target as HTMLVideoElement).style.display = "none";
              }}
            />
          ) : (
            <Play size={12} aria-hidden color="currentColor" style={{ color: colors.textMuted }} />
          )}
        </div>
        <Input
          id={id}
          value={isDataUrl ? "(embedded video)" : value}
          readOnly={isDataUrl}
          onChange={(e) => onChange(e.target.value)}
          placeholder="URL or path · drop a file"
          title={isDataUrl ? "Inline data URL — clear to paste a new URL" : value || undefined}
          style={{
            flex: 1,
            minWidth: 0,
            color: isDataUrl ? colors.textDim : colors.text,
            fontFamily: isDataUrl ? fontFamily.mono : undefined,
          }}
        />
        {value && (
          <IconButton size={24} onClick={() => onChange("")} aria-label="Clear video" title="Clear">
            <X size={14} aria-hidden />
          </IconButton>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="video/*"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = "";
          }}
        />
      </div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 4 }}>
        {onPickFromLibrary && (
          <Button
            size="sm"
            variant="secondary"
            disabled={uploading}
            onClick={async () => {
              setError(null);
              const picked = await onPickFromLibrary();
              if (picked) onChange(picked.url);
            }}
          >
            Choose from Media
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          title={onUpload ? undefined : "Embed as data URL"}
        >
          {uploading ? "Uploading…" : "Upload"}
        </Button>
      </div>
      {error && (
        <div role="alert" style={{ marginTop: 4, fontSize: 11, color: colors.dangerText }}>
          {error}
        </div>
      )}
    </div>
  );
}
