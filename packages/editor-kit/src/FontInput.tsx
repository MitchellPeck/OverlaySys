import { useEffect, useId, useRef, useState } from "react";
import { fontFamilyFromFilename, fontPickerOptions } from "./fontUtils";

type Props = {
  /** Currently selected font family (raw CSS string). */
  value: string;
  /** Fonts already attached to the template. */
  templateFonts: { family: string; src: string }[];
  /** Called when the user picks/types a different family. */
  onChange: (family: string) => void;
  /** Called when the user uploads a new font file. */
  onAddFont: (entry: { family: string; src: string }) => void;
  /** When provided, the picked font file is uploaded; else inline data URL. */
  onUpload?: (file: File) => Promise<string>;
};

/**
 * Family picker for text layers. Combines a free-text input bound to a
 * `<datalist>` of system fallbacks + template fonts with a "+ Add font"
 * popover that reads a picked file as a data URL.
 */
export function FontInput(props: Props) {
  const listId = useId();
  const fileInputId = useId();
  const familyInputId = useId();
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [pendingFamily, setPendingFamily] = useState("");
  const [pendingSrc, setPendingSrc] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const options = fontPickerOptions(props.templateFonts, props.value);

  function closePopover() {
    setPopoverOpen(false);
    setPendingFamily("");
    setPendingSrc(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  useEffect(() => {
    if (!popoverOpen) return;
    function onDocPointerDown(e: PointerEvent) {
      if (!popoverRef.current) return;
      if (e.target instanceof Node && popoverRef.current.contains(e.target)) {
        return;
      }
      closePopover();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closePopover();
    }
    document.addEventListener("pointerdown", onDocPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDocPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [popoverOpen]);

  useEffect(() => {
    if (popoverOpen) fileRef.current?.focus();
  }, [popoverOpen]);

  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File) {
    setError(null);
    // Auto-fill the family name regardless of upload mode.
    setPendingFamily((prev) =>
      prev ? prev : fontFamilyFromFilename(file.name),
    );
    if (props.onUpload) {
      setUploading(true);
      try {
        const url = await props.onUpload(file);
        setPendingSrc(url);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setUploading(false);
      }
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setPendingSrc(reader.result);
    };
    reader.readAsDataURL(file);
  }

  function onSubmit() {
    if (!pendingFamily.trim() || !pendingSrc) return;
    props.onAddFont({ family: pendingFamily.trim(), src: pendingSrc });
    props.onChange(pendingFamily.trim());
    closePopover();
  }

  const canSubmit = !!pendingFamily.trim() && !!pendingSrc && !uploading;

  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center", width: "100%", position: "relative" }}>
      <input
        list={listId}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder="Inter, system-ui, sans-serif"
        style={{
          flex: 1,
          background: "var(--panel, #14161a)",
          color: "var(--text, #e9eaee)",
          border: "1px solid var(--border, #2a2e36)",
          borderRadius: 3,
          padding: "4px 6px",
          fontSize: 12,
          fontFamily: "inherit",
        }}
      />
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
      <button
        type="button"
        onClick={() => setPopoverOpen((v) => !v)}
        title="Add font from file"
        style={{
          width: 24,
          height: 24,
          background: "var(--panel-2, #1c1f25)",
          color: "var(--text, #e9eaee)",
          border: "1px solid var(--border, #2a2e36)",
          borderRadius: 3,
          cursor: "pointer",
          fontSize: 14,
          lineHeight: "1",
          padding: 0,
        }}
      >
        +
      </button>

      {popoverOpen && (
        <div
          ref={popoverRef}
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            right: 0,
            zIndex: 10,
            background: "var(--panel, #14161a)",
            border: "1px solid var(--border, #2a2e36)",
            borderRadius: 4,
            padding: 8,
            display: "flex",
            flexDirection: "column",
            gap: 6,
            width: 240,
            boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
          }}
        >
          <label htmlFor={fileInputId} style={{ fontSize: 11, color: "var(--text-dim, #9099a8)" }}>Font file</label>
          <input
            ref={fileRef}
            id={fileInputId}
            type="file"
            accept=".woff2,.woff,.ttf,.otf"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
            }}
            style={{ fontSize: 12, color: "var(--text, #e9eaee)" }}
          />
          <label htmlFor={familyInputId} style={{ fontSize: 11, color: "var(--text-dim, #9099a8)" }}>Family name</label>
          <input
            id={familyInputId}
            value={pendingFamily}
            onChange={(e) => setPendingFamily(e.target.value)}
            placeholder="My Font"
            style={{
              background: "var(--panel-2, #1c1f25)",
              color: "var(--text, #e9eaee)",
              border: "1px solid var(--border, #2a2e36)",
              borderRadius: 3,
              padding: "4px 6px",
              fontSize: 12,
            }}
          />
          {(uploading || error) && (
            <div
              style={{
                fontSize: 11,
                color: error ? "var(--red, #f87171)" : "var(--text-dim, #9099a8)",
              }}
            >
              {error ? error : "Uploading…"}
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
            <button
              type="button"
              onClick={closePopover}
              style={{
                padding: "4px 8px",
                background: "transparent",
                color: "var(--text-dim, #9099a8)",
                border: "1px solid var(--border, #2a2e36)",
                borderRadius: 3,
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!canSubmit}
              onClick={onSubmit}
              style={{
                padding: "4px 8px",
                background: canSubmit ? "var(--accent, #4ade80)" : "var(--panel-2, #1c1f25)",
                color: canSubmit ? "#0c0d10" : "var(--text-dim, #9099a8)",
                border: "1px solid var(--border, #2a2e36)",
                borderRadius: 3,
                fontSize: 11,
                fontWeight: 600,
                cursor: canSubmit ? "pointer" : "not-allowed",
              }}
            >
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
