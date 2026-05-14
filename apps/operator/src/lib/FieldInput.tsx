"use client";

import { ColorInput, ImageInput, VideoInput } from "@overlaysys/editor-kit";
import { Input, colors } from "@overlaysys/ui";
import type { Field } from "@overlaysys/core";
import { parseDuration } from "@overlaysys/core";
import { useEffect, useState } from "react";
import { uploadAsset, resolveAssetUrl } from "./uploadAsset";

type Props = {
  field: Field;
  value: string | undefined;
  onChange: (v: string) => void;
};

const upload = async (file: File): Promise<string> => (await uploadAsset(file)).url;

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
      // Resolve `/assets/...` paths against the WS server's HTTP origin so
      // the editor's `<img>` preview loads in dev mode (operator @ :3000,
      // server @ :4000). In Electron production the operator is served by
      // the asset server itself so this is a no-op.
      return <ImageInput value={resolveAssetUrl(v)} onChange={onChange} onUpload={upload} />;
    case "video":
      return <VideoInput value={resolveAssetUrl(v)} onChange={onChange} onUpload={upload} />;
    case "number":
      return (
        <Input
          type="number"
          value={value ?? field.default ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.default ?? ""}
        />
      );
    case "time":
      return <TimeFieldInput field={field} value={value} onChange={onChange} />;
    case "text":
    default:
      return (
        <Input
          value={value ?? field.default ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.default ?? ""}
        />
      );
  }
}

/**
 * Mode-aware UI for a time field. The stored value is always an epoch-ms
 * timestamp as a string (so the renderer can subtract `Date.now()` directly
 * at tick time). What the operator *types* depends on mode:
 *
 *  - countdown: a duration like "10:00" or "1:30:00" — converted to
 *    `Date.now() + ms` only when the operator confirms.
 *  - countup:   a "Use now" button stamps the current time. We don't expose
 *    a free-text past-time picker for v1 — it's almost never useful and
 *    invites bad input.
 *  - clock:     no input; the field is ignored at render time.
 *
 * The countdown duration is held in local component state so the operator
 * sees what they typed rather than the live remaining time. That's the
 * difference between editing a take and watching it run.
 */
function TimeFieldInput({ field, value, onChange }: Props) {
  const mode = field.timeMode ?? "countdown";

  if (mode === "clock") {
    return (
      <span style={{ fontSize: 11, color: colors.textDim, fontStyle: "italic" }}>
        live clock — no input needed
      </span>
    );
  }

  if (mode === "countup") {
    const anchor = value ? Number(value) : NaN;
    const stamp = Number.isFinite(anchor) ? new Date(anchor).toLocaleTimeString() : "(unset)";
    return (
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <button
          onClick={() => onChange(String(Date.now()))}
          style={smallBtnStyle}
          title="Set the count-up start to right now"
        >
          Use now
        </button>
        <span style={{ fontSize: 11, color: colors.textDim }}>{stamp}</span>
      </div>
    );
  }

  // countdown
  return <DurationInput value={value} onChange={onChange} />;
}

/**
 * Free-text duration input ("10:00", "1:30:00"). Keeps the typed text in
 * local state so it doesn't tick down while the operator is still editing.
 * Commits an epoch-ms anchor on blur / Enter when parseable.
 */
function DurationInput({
  value,
  onChange,
}: {
  value: string | undefined;
  onChange: (v: string) => void;
}) {
  const [text, setText] = useState<string>(() => deriveDurationText(value));

  // If the parent rotates the stored anchor (e.g. switching rows), pull the
  // new derived text in. We don't sync while the user is mid-edit since
  // that would erase their keystrokes every time the parent re-rendered.
  useEffect(() => {
    setText(deriveDurationText(value));
    // Only re-derive when the anchor actually changes — text edits don't.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function commit(): void {
    const ms = parseDuration(text);
    if (ms == null) return;
    onChange(String(Date.now() + ms));
  }

  return (
    <Input
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
      }}
      placeholder="10:00"
      title="Duration to count down. Format: SS, MM:SS, or HH:MM:SS. Press Enter or blur to set."
    />
  );
}

/**
 * If `value` is an epoch-ms anchor in the future, render it as a remaining
 * duration string ("10:00"). Past anchors and unset values render as the
 * empty string so the field reads as "ready to type."
 */
function deriveDurationText(value: string | undefined): string {
  if (!value) return "";
  const anchor = Number(value);
  if (!Number.isFinite(anchor)) return "";
  const remainingMs = anchor - Date.now();
  if (remainingMs <= 0) return "";
  const totalSec = Math.round(remainingMs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const smallBtnStyle: React.CSSProperties = {
  padding: "4px 10px",
  background: "var(--panel-2)",
  color: "var(--text)",
  border: `1px solid var(--border)`,
  borderRadius: 4,
  fontSize: 12,
  cursor: "pointer",
};
