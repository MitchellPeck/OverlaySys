"use client";

import { ColorInput, ImageInput, VideoInput } from "@overlaysys/editor-kit";
import { Input, colors } from "@overlaysys/ui";
import type { Field } from "@overlaysys/core";
import { decodeTimerValue, encodeTimerValue } from "@overlaysys/core";
import { useEffect, useState } from "react";
import { useStore } from "./store";
import { countdownTimerValue, remainingDurationText } from "./timeFieldValue";
import { resolveAssetUrl } from "./uploadAsset";
import { useMediaSourceChoice } from "../app/media/useMediaSourceChoice";

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
      // Resolve `/assets/...` paths against the WS server's HTTP origin so
      // the editor's `<img>` preview loads in dev mode (operator @ :3000,
      // server @ :4000). In Electron production the operator is served by
      // the asset server itself so this is a no-op.
      // [P2b.9] resolve for the preview only, so the stored path is shown and kept as is.
      return <MediaFieldInput kind="image" value={v} onChange={onChange} />;
    case "video":
      return <MediaFieldInput kind="video" value={v} onChange={onChange} />;
    // [/P2b.9]
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
 * An image or video field: "Choose from Media" (show computer) and "Upload"
 * (joins Media, then used). The stored value stays the asset URL string.
 */
function MediaFieldInput({ kind, value, onChange }: { kind: "image" | "video"; value: string; onChange: (v: string) => void }) {
  const { pickFromLibrary, uploadFor, picker } = useMediaSourceChoice();
  const Control = kind === "image" ? ImageInput : VideoInput;
  return (
    <>
      <Control
        value={value}
        resolveUrl={resolveAssetUrl}
        onChange={onChange}
        onUpload={uploadFor(kind)}
        onPickFromLibrary={pickFromLibrary && (() => pickFromLibrary(kind))}
      />
      {picker}
    </>
  );
}

/**
 * Mode-aware UI for a time field. The stored value is always an epoch-ms
 * timestamp on the server clock (local Date.now() + serverTimeOffsetMs, as
 * the stage timers and Active timers panel use), as a string. What the
 * operator *types* depends on mode:
 *
 *  - countdown: a duration like "10:00" or "1:30:00" — converted to
 *    `serverNow + ms` only when the operator confirms.
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
  const offset = useStore((s) => s.serverTimeOffsetMs);

  if (mode === "clock") {
    return (
      <span style={{ fontSize: 11, color: colors.textDim, fontStyle: "italic" }}>
        live clock — no input needed
      </span>
    );
  }

  if (mode === "countup") {
    const { anchor } = decodeTimerValue(value);
    // The anchor is server time; show it on this console's wall clock.
    const stamp = Number.isFinite(anchor) ? new Date(anchor - offset).toLocaleTimeString() : "(unset)";
    return (
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <button
          onClick={() => onChange(encodeTimerValue({ anchor: Date.now() + offset }))}
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
  return <DurationInput value={value} onChange={onChange} offset={offset} />;
}

/**
 * Free-text duration input ("10:00", "1:30:00"). Keeps the typed text in
 * local state so it doesn't tick down while the operator is still editing.
 * Commits an epoch-ms anchor on blur / Enter when parseable.
 */
function DurationInput({
  value,
  onChange,
  offset,
}: {
  value: string | undefined;
  onChange: (v: string) => void;
  /** serverTimeOffsetMs: anchors are read and stamped on the server clock. */
  offset: number;
}) {
  const [text, setText] = useState<string>(() => remainingDurationText(value, Date.now() + offset));

  // If the parent rotates the stored anchor (e.g. switching rows), pull the
  // new derived text in. We don't sync while the user is mid-edit since
  // that would erase their keystrokes every time the parent re-rendered.
  useEffect(() => {
    setText(remainingDurationText(value, Date.now() + offset));
    // Only re-derive when the anchor actually changes — text edits don't.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function commit(): void {
    const next = countdownTimerValue(text, Date.now() + offset);
    if (next != null) onChange(next);
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

const smallBtnStyle: React.CSSProperties = {
  padding: "4px 10px",
  background: "var(--panel-2)",
  color: "var(--text)",
  border: `1px solid var(--border)`,
  borderRadius: 4,
  fontSize: 12,
  cursor: "pointer",
};
