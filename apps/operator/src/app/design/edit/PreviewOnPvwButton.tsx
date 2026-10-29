"use client";

import { useEffect, useRef, useState } from "react";
import type { Template } from "@overlaysys/core";
import { Button, Tooltip, colors, confirm, toast } from "@overlaysys/ui";
import { useStore } from "@/lib/store";
import { isCloudMode } from "@/lib/mode";
import {
  DRAFT_PREVIEW_THROTTLE_MS,
  draftIdFor,
  draftPreviewDecision,
  postDraftPreview,
  stopDraftPreview,
} from "./draftPreview";

type Props = {
  /** The saved template's id; the server cues it as `__draft__<id>`. */
  sourceId: string;
  /** The unsaved draft, as the designer holds it. */
  draft: Template;
  /** Field values to show (the designer's field defaults). */
  data: Record<string, string>;
  offline: boolean;
};

/**
 * "Preview on PVW": puts the unsaved draft on the preview channel only (the
 * server refuses a draft anywhere else). Hidden in cloud mode.
 */
export function PreviewOnPvwButton(p: Props) {
  if (isCloudMode()) return null;
  return <PreviewOnPvwInner {...p} />;
}

function PreviewOnPvwInner({ sourceId, draft, data, offline }: Props) {
  const [active, setActive] = useState(false);
  const draftId = draftIdFor(sourceId);
  const previewActive = useStore((s) => s.channelStates["preview"]?.active ?? null);
  const previewTemplateId = previewActive && previewActive.phase !== "out" ? previewActive.templateId : null;

  // Latest values for the throttled sender, which runs outside a render.
  const live = useRef({ draft, data });
  live.current = { draft, data };
  const lastSentRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** True once preview has been seen showing our draft; a later change means someone replaced it. */
  const seenRef = useRef(false);

  function cancelTimer() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }

  function send() {
    cancelTimer();
    lastSentRef.current = Date.now();
    postDraftPreview(live.current.draft, live.current.data).catch((err: unknown) => {
      toast({ tone: "error", message: `Preview failed: ${err instanceof Error ? err.message : String(err)}` });
      setActive(false);
    });
  }

  function stop() {
    cancelTimer();
    seenRef.current = false;
    setActive(false);
    stopDraftPreview(sourceId);
  }

  async function start() {
    const decision = draftPreviewDecision({
      previewTemplateId,
      previewName: previewTemplateId ? previewName(previewTemplateId) : null,
      sourceId,
    });
    if (decision === "confirm-replace") {
      const ok = await confirm({
        title: "Replace what's on preview?",
        message: `Preview has "${previewName(previewTemplateId!)}" cued. Replace it with this unsaved draft?`,
        confirmLabel: "Replace",
      });
      if (!ok) return;
    }
    seenRef.current = false;
    setActive(true);
    send();
  }

  // Draft edits re-post, throttled (leading + trailing).
  useEffect(() => {
    if (!active) return;
    const wait = lastSentRef.current + DRAFT_PREVIEW_THROTTLE_MS - Date.now();
    if (wait <= 0) send();
    else if (!timerRef.current) timerRef.current = setTimeout(send, wait);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, data]);

  // Someone else cued or cleared preview: we are no longer previewing.
  useEffect(() => {
    if (!active) return;
    if (previewTemplateId === draftId) seenRef.current = true;
    else if (seenRef.current) stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, previewTemplateId, draftId]);

  // Unmount, a switch to another template (route change) and page unload all stop it.
  const activeRef = useRef(active);
  activeRef.current = active;
  useEffect(() => {
    const onHide = () => {
      if (activeRef.current) stopDraftPreview(sourceId);
    };
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      cancelTimer();
      if (activeRef.current) stopDraftPreview(sourceId);
      activeRef.current = false;
      setActive(false);
    };
  }, [sourceId]);

  if (active) {
    return (
      <Button variant="secondary" size="sm" onClick={stop} aria-pressed>
        <span
          aria-hidden
          style={{ width: 8, height: 8, borderRadius: "50%", background: colors.ok, flexShrink: 0 }}
        />
        Stop preview
      </Button>
    );
  }
  const button = (
    <Button variant="secondary" size="sm" disabled={offline} onClick={() => void start()}>
      Preview on PVW
    </Button>
  );
  if (!offline) return button;
  return (
    <Tooltip content="Reconnect to preview">
      <span tabIndex={0} aria-label="Preview on PVW: Reconnect to preview" style={{ display: "inline-flex" }}>
        {button}
      </span>
    </Tooltip>
  );
}

function previewName(templateId: string): string {
  const s = useStore.getState();
  return s.templates.find((t) => t.id === templateId)?.name ?? s.templateCache[templateId]?.name ?? templateId;
}
