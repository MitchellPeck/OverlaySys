import { useRef, useState } from "react";

type Props = {
  value: string;
  onChange: (v: string) => void;
};

/**
 * Video source input. Mirrors ImageInput's UX: a small thumbnail-ish
 * preview, a path/URL field, a file-picker button, and a clear button.
 * Adds drag-and-drop — drop a video file anywhere on the control to
 * embed it as a data URL.
 *
 * Data URLs balloon the JSON quickly for full-length videos. For short
 * stings/idents this is fine; for actual clip-length content, type a
 * stable file path or URL into the text field instead so the show JSON
 * stays small.
 */
export function VideoInput({ value, onChange }: Props) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);

  function onFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") onChange(reader.result);
    };
    reader.readAsDataURL(file);
  }

  const isDataUrl = value.startsWith("data:");

  return (
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
        gap: 6,
        alignItems: "center",
        width: "100%",
        padding: dragOver ? 4 : 0,
        background: dragOver ? "rgba(74, 222, 128, 0.08)" : "transparent",
        border: dragOver ? "1px dashed #4ade80" : "1px solid transparent",
        borderRadius: 4,
        transition: "background 80ms, border-color 80ms",
      }}
    >
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
          position: "relative",
        }}
      >
        {value ? (
          // muted+playsInline gives us a reliable poster-style preview without
          // autoplay-block warnings; loop so the operator sees motion.
          <video
            src={value}
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
          <span style={{ color: "var(--text-dim, #9099a8)", fontSize: 14 }}>▶</span>
        )}
      </div>
      <input
        value={isDataUrl ? "(embedded video)" : value}
        readOnly={isDataUrl}
        onChange={(e) => onChange(e.target.value)}
        placeholder="https://… or path · drop a file"
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
        title="Pick file (embedded as data URL)"
        style={{
          width: 28,
          height: 24,
          background: "var(--panel-2, #1c1f25)",
          border: "1px solid var(--border, #2a2e36)",
          borderRadius: 3,
          cursor: "pointer",
          fontSize: 12,
        }}
      >
        📁
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
        accept="video/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
