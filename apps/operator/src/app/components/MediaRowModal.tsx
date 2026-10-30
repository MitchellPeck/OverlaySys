"use client";

import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_MEDIA_TRANSITION,
  type ChannelConfig,
  type MediaRef,
  type MediaTransition,
  type MediaTransitionStyle,
} from "@overlaysys/core";
import { Button, Field, Input, Modal, SegmentedControl, Select, Switch } from "@overlaysys/ui";
import { resolveAssetUrl } from "@/lib/uploadAsset";
import { useStore } from "@/lib/store";
import { MediaSourceField, type SourcePick } from "@/app/media/MediaPicker";

export type PhotoFit = "cover" | "contain" | "fill";

/** Everything the Add media dialog chose. Video-only and photo-only settings are ignored for the other type. */
export type MediaRowSaveArgs = {
  source: MediaRef;
  label: string;
  durationSec?: number;
  channelHint: string;
  transitionIn: MediaTransition;
  transitionOut: MediaTransition;
  volume: number;
  endAction: "clear" | "hold";
  loop: boolean;
  muted: boolean;
  fit: PhotoFit;
};

export const PHOTO_FIT_OPTIONS: { value: PhotoFit; label: string; title: string }[] = [
  { value: "cover", label: "Cover", title: "Fill the frame; edges may be cropped" },
  { value: "contain", label: "Contain", title: "Show the whole photo" },
  { value: "fill", label: "Stretch", title: "Stretch to the frame" },
];

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

export function MediaRowModal({
  open,
  channels,
  onClose,
  onSave,
}: {
  open: boolean;
  channels: ChannelConfig[];
  onClose: () => void;
  onSave: (args: MediaRowSaveArgs) => void;
}) {
  const mediaItems = useStore((s) => s.mediaItems);
  const [source, setSource] = useState<SourcePick | null>(null);
  const [label, setLabel] = useState("");
  const [volume, setVolume] = useState(1);
  // New rows hold the last frame; the schema default stays "clear" for older rows.
  const [endAction, setEndAction] = useState<"clear" | "hold">("hold");
  const [loop, setLoop] = useState(false);
  const [muted, setMuted] = useState(false);
  const [fit, setFit] = useState<PhotoFit>("cover");
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
    setSource(null);
    setLabel("");
    setVolume(1);
    setEndAction("hold");
    setLoop(false);
    setMuted(false);
    setFit("cover");
    setTransitionIn(DEFAULT_MEDIA_TRANSITION);
    setTransitionOut(DEFAULT_MEDIA_TRANSITION);
    setChannelHint("program");
  }, [open]);

  const isVideo = source?.mediaType === "video";

  async function save() {
    if (!source) return;
    setSaving(true);
    try {
      const libraryDuration = mediaItems.find((m) => m.id === source.mediaItemId)?.durationSec;
      const durationSec = !isVideo
        ? undefined
        : (source.durationSec ?? libraryDuration ?? (await probeDuration(resolveAssetUrl(source.assetUrl))));
      if (cancelledRef.current) return;
      onSave({
        source: {
          ...(source.mediaItemId ? { mediaItemId: source.mediaItemId } : {}),
          assetUrl: source.assetUrl,
          mediaType: source.mediaType,
        },
        label: label.trim(),
        ...(durationSec !== undefined ? { durationSec } : {}),
        channelHint,
        transitionIn,
        transitionOut,
        volume,
        endAction,
        loop,
        muted,
        fit,
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
      title="Add media"
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()} disabled={!source || saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </>
      }
    >
      <Field label="Photo or video">
        <MediaSourceField
          assetUrl={source?.assetUrl ?? ""}
          mediaType={source?.mediaType ?? null}
          name={source?.name ?? ""}
          accept="any"
          onChange={setSource}
        />
      </Field>
      <Field label="Label">
        <Input value={label} placeholder={source?.name || "Giving video"} onChange={(e) => setLabel(e.target.value)} />
      </Field>
      <Field label="Channel">
        <Select value={channelHint} onChange={(e) => setChannelHint(e.target.value)}>
          {channels.length === 0 && <option value="program">program</option>}
          {channels.map((c) => (
            <option key={c.id} value={c.id}>{c.name || c.id}</option>
          ))}
        </Select>
      </Field>
      {source && !isVideo && (
        <Field label="Fit">
          <SegmentedControl<PhotoFit> size="sm" aria-label="Fit" value={fit} options={PHOTO_FIT_OPTIONS} onChange={setFit} />
        </Field>
      )}
      {isVideo && (
        <>
          <Field label="Playback">
            <div style={{ display: "flex", gap: 16 }}>
              <Switch checked={loop} onChange={setLoop} label="Loop" />
              <Switch checked={muted} onChange={setMuted} label="Mute" />
            </div>
          </Field>
          {!muted && (
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
          )}
          {!loop && (
            <Field label="When the video ends">
              <Select value={endAction} onChange={(e) => setEndAction(e.target.value as "clear" | "hold")}>
                <option value="hold">Hold last frame</option>
                <option value="clear">Clear</option>
              </Select>
            </Field>
          )}
        </>
      )}
      <TransitionField label="Transition in" value={transitionIn} onChange={setTransitionIn} />
      <TransitionField label="Transition out" value={transitionOut} onChange={setTransitionOut} />
    </Modal>
  );
}
