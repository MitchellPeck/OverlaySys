"use client";
import { useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "./Button";
import { IconButton } from "./IconButton";
import { acceptsFile } from "./fileAccept";
import { colors, fontSize, radius } from "./tokens";

type Props = {
  accept: string;
  onFile(f: File): void;
  hint?: ReactNode;
  buttonLabel?: string;
  file?: File | null;
  onClear?(): void;
};

export function FileDrop({ accept, onFile, hint, buttonLabel = "Choose file…", file, onClear }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [rejected, setRejected] = useState(false);

  function take(f: File | undefined) {
    if (!f) return;
    if (!acceptsFile(f.name, f.type, accept)) {
      setRejected(true);
      return;
    }
    setRejected(false);
    onFile(f);
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        take(e.dataTransfer.files?.[0]);
      }}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
        padding: 16,
        border: `1px dashed ${over ? colors.brand : colors.borderStrong}`,
        borderRadius: radius.lg,
        background: over ? colors.brandSubtle : colors.surface2,
        fontSize: fontSize.sm,
        color: colors.textDim,
        textAlign: "center",
      }}
    >
      <input
        ref={input}
        type="file"
        accept={accept}
        hidden
        onChange={(e) => {
          take(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {file ? (
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "0 4px 0 10px",
            background: colors.surface3,
            border: `1px solid ${colors.border}`,
            borderRadius: radius.md,
            color: colors.text,
          }}
        >
          <span>{file.name}</span>
          <IconButton size={28} aria-label={`Remove ${file.name}`} onClick={onClear} style={{ border: "none" }}>
            <X size={14} aria-hidden />
          </IconButton>
        </span>
      ) : (
        <>
          {hint !== undefined && <div>{hint}</div>}
          <Button size="sm" onClick={() => input.current?.click()}>
            {buttonLabel}
          </Button>
        </>
      )}
      {rejected && (
        <div role="alert" style={{ color: colors.dangerText, fontSize: fontSize.xs }}>
          That file type isn&apos;t supported here.
        </div>
      )}
    </div>
  );
}
