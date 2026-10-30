"use client";

import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_MEDIA_TRANSITION,
  type ChannelConfig,
  type MediaTransition,
  type MediaTransitionStyle,
  type VideoRow,
} from "@overlaysys/core";
import { VideoInput } from "@overlaysys/editor-kit";
import { Button, Field, Input, Modal, Select } from "@overlaysys/ui";
import { resolveAssetUrl, uploadAsset } from "@/lib/uploadAsset";

export type VideoRowSaveArgs = {
  assetUrl: string;
  label: string;
  durationSec?: number;
  volume: number;
  endAction: "clear" | "hold";
  transitionIn: MediaTransition;
  transitionOut: MediaTransition;
  channelHint: string;
};

const STYLE_LABELS: Record<MediaTransitionStyle, string> = {
  cut: "Cut",
  fade: "Fade",
  zoom: "Zoom",
  slide: "Slide",
};

/** Style picker plus duration in seconds (hidden for Cut). */
export function TransitionField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: MediaTransition;
  onChange: (t: MediaTransition) => void;
}) {
  return (
    <Field label={label}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <Select
          value={value.style}
          onChange={(e) => onChange({ ...value, style: e.target.value as MediaTransitionStyle })}
          style={{ flex: 1 }}
        >
          {(Object.keys(STYLE_LABELS) as MediaTransitionStyle[]).map((st) => (
            <option key={st} value={st}>{STYLE_LABELS[st]}</option>
          ))}
        </Select>
        {value.style !== "cut" && (
          <>
            <Input
              type="number"
              min={0.1}
              max={5}
              step={0.1}
              aria-label={`${label} duration (seconds)`}
              value={value.durationMs / 1000}
              onChange={(e) => {
                const sec = Number(e.target.value);
                if (!Number.isFinite(sec)) return;
                onChange({ ...value, durationMs: Math.round(Math.min(5, Math.max(0, sec)) * 1000) });
              }}
              style={{ width: 80 }}
            />
            <span style={{ fontSize: 12 }}>sec</span>
          </>
        )}
      </div>
    </Field>
  );
}

/** Read a video's duration in the browser; undefined if it can't load. */
export function probeDuration(url: string): Promise<number | undefined> {
  return new Promise((resolve) => {
    const v = document.createElement("video");
    v.preload = "metadata";
    v.muted = true;
    const done = (d: number | undefined) => {
      v.removeAttribute("src");
      v.load();
      resolve(d);
    };
    v.onloadedmetadata = () => done(Number.isFinite(v.duration) ? v.duration : undefined);
    v.onerror = () => done(undefined);
    setTimeout(() => done(undefined), 10_000);
    v.src = url;
  });
}

export function VideoRowModal({
  open,
  editingRow,
  channels,
  onClose,
  onSave,
}: {
  open: boolean;
  editingRow?: VideoRow;
  channels: ChannelConfig[];
  onClose: () => void;
  onSave: (args: VideoRowSaveArgs) => void;
}) {
  const [assetUrl, setAssetUrl] = useState("");
  const [label, setLabel] = useState("");
  const [volume, setVolume] = useState(1);
  const [endAction, setEndAction] = useState<"clear" | "hold">("clear");
  const [transitionIn, setTransitionIn] = useState<MediaTransition>(DEFAULT_MEDIA_TRANSITION);
  const [transitionOut, setTransitionOut] = useState<MediaTransition>(DEFAULT_MEDIA_TRANSITION);
  const [channelHint, setChannelHint] = useState("program");
  const [saving, setSaving] = useState(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!open) {
      cancelledRef.current = true;
      return;
    }
    cancelledRef.current = false;
    setSaving(false);
    setAssetUrl(editingRow?.assetUrl ?? "");
    setLabel(editingRow?.label ?? "");
    setVolume(editingRow?.volume ?? 1);
    setEndAction(editingRow?.endAction ?? "clear");
    setTransitionIn(editingRow?.transitionIn ?? DEFAULT_MEDIA_TRANSITION);
    setTransitionOut(editingRow?.transitionOut ?? DEFAULT_MEDIA_TRANSITION);
    setChannelHint(editingRow?.channelHint ?? "program");
  }, [open, editingRow]);

  async function save() {
    if (!assetUrl) return;
    setSaving(true);
    try {
      const unchanged = editingRow !== undefined && assetUrl === editingRow.assetUrl && editingRow.durationSec !== undefined;
      const durationSec = unchanged
        ? editingRow.durationSec
        : await probeDuration(resolveAssetUrl(assetUrl));
      if (cancelledRef.current) return;
      onSave({
        assetUrl,
        label: label.trim(),
        ...(durationSec !== undefined ? { durationSec } : {}),
        volume,
        endAction,
        transitionIn,
        transitionOut,
        channelHint,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      closeOnBackdrop={false}
      title={editingRow ? "Edit video" : "Add video"}
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()} disabled={!assetUrl || saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <Field label="Video">
        <VideoInput
          value={assetUrl}
          onChange={setAssetUrl}
          onUpload={async (file) => (await uploadAsset(file)).url}
          resolveUrl={resolveAssetUrl}
        />
      </Field>
      <Field label="Label">
        <Input value={label} placeholder="Giving video" onChange={(e) => setLabel(e.target.value)} />
      </Field>
      <Field label="Channel">
        <Select value={channelHint} onChange={(e) => setChannelHint(e.target.value)}>
          {channels.length === 0 && <option value="program">program</option>}
          {channels.map((c) => (
            <option key={c.id} value={c.id}>{c.name || c.id}</option>
          ))}
        </Select>
      </Field>
      <Field label={`Volume — ${Math.round(volume * 100)}%`}>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          style={{ width: "100%" }}
        />
      </Field>
      <Field label="When the video ends">
        <Select value={endAction} onChange={(e) => setEndAction(e.target.value as "clear" | "hold")}>
          <option value="clear">Clear when finished</option>
          <option value="hold">Hold last frame</option>
        </Select>
      </Field>
      <TransitionField label="Transition in" value={transitionIn} onChange={setTransitionIn} />
      <TransitionField label="Transition out" value={transitionOut} onChange={setTransitionOut} />
    </Modal>
  );
}
