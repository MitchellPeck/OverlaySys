import { useEffect, useId, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { Button, IconButton, Input, colors, radius, shadow } from "@overlaysys/ui";
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
  /** Id for the family field, so a FieldRow label focuses it. */
  id?: string;
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
    <div style={{ display: "flex", gap: 4, alignItems: "center", width: "100%", minWidth: 0, position: "relative" }}>
      <Input
        id={props.id}
        list={listId}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder="Inter, system-ui, sans-serif"
        title={props.value}
        style={{ flex: 1, minWidth: 0 }}
      />
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
      <IconButton
        size={24}
        onClick={() => setPopoverOpen((v) => !v)}
        aria-label="Add font from file"
        title="Add font from file"
        aria-expanded={popoverOpen}
      >
        <Plus size={14} aria-hidden />
      </IconButton>

      {popoverOpen && (
        <div
          ref={popoverRef}
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            right: 0,
            zIndex: 10,
            background: colors.surface2,
            border: `1px solid ${colors.borderStrong}`,
            borderRadius: radius.md,
            padding: 8,
            display: "flex",
            flexDirection: "column",
            gap: 6,
            width: 240,
            boxShadow: shadow.modal,
          }}
        >
          <label htmlFor={fileInputId} style={{ fontSize: 11, color: colors.textDim }}>Font file</label>
          <input
            ref={fileRef}
            id={fileInputId}
            type="file"
            accept=".woff2,.woff,.ttf,.otf"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
            }}
            style={{ fontSize: 12, color: colors.text, maxWidth: "100%" }}
          />
          <label htmlFor={familyInputId} style={{ fontSize: 11, color: colors.textDim }}>Family name</label>
          <Input
            id={familyInputId}
            value={pendingFamily}
            onChange={(e) => setPendingFamily(e.target.value)}
            placeholder="My Font"
          />
          {(uploading || error) && (
            <div role={error ? "alert" : undefined} style={{ fontSize: 11, color: error ? colors.dangerText : colors.textDim }}>
              {error ? error : "Uploading…"}
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
            <Button size="sm" variant="ghost" onClick={closePopover}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" disabled={!canSubmit} onClick={onSubmit}>
              Add
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
