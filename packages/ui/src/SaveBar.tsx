"use client";

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "./Button";
import { Kbd } from "./Kbd";
import { confirm } from "./Dialog";
import { colors, fontSize } from "./tokens";
import { saveBarState } from "./saveBarState";

export type SaveBarProps = {
  dirty: boolean;
  saving: boolean;
  onSave(): void;
  onRevert(): void;
  disabledReason?: string;
  // [P2a.20] editor-specific Revert confirm text, e.g. "Discard unsaved changes to this song?"
  revertMessage?: string;
  // [/P2a.20]
  // [P2a.17] Revert confirm title (default "Revert changes?").
  revertTitle?: string;
  // [/P2a.17]
};

function isMac(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);
}

export function SaveBar({ dirty, saving, onSave, onRevert, disabledReason, revertMessage, revertTitle }: SaveBarProps) {
  const [justSaved, setJustSaved] = useState(false);
  const wasSaving = useRef(false);
  useEffect(() => {
    const finishedSave = wasSaving.current && !saving && !dirty;
    wasSaving.current = saving;
    if (finishedSave) {
      setJustSaved(true);
      const t = setTimeout(() => setJustSaved(false), 2000);
      return () => clearTimeout(t);
    }
    if (dirty) setJustSaved(false);
    return undefined;
  }, [saving, dirty]);

  const s = saveBarState({ dirty, saving, disabledReason, justSaved });
  const latest = useRef({ onSave, enabled: s.saveEnabled });
  latest.current = { onSave, enabled: s.saveEnabled };
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (latest.current.enabled) latest.current.onSave();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const revert = async () => {
    const ok = await confirm({ title: revertTitle ?? "Revert changes?", message: revertMessage ?? "Your unsaved edits will be lost.", confirmLabel: "Revert", danger: true });
    if (ok) onRevert();
  };

  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span aria-live="polite" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: fontSize.sm, color: colors.textDim, minWidth: 0 }}>
        {s.status === "unsaved" ? <span aria-hidden style={{ width: 8, height: 8, borderRadius: 999, background: colors.warn, flexShrink: 0 }} /> : null}
        {s.status === "saved" ? <Check size={14} aria-hidden style={{ color: colors.ok }} /> : null}
        {s.statusText}
      </span>
      <Button size="sm" variant="ghost" disabled={!s.revertEnabled} onClick={revert}>
        Revert
      </Button>
      <Button size="sm" variant="primary" disabled={!s.saveEnabled} title={s.saveTitle} onClick={onSave}>
        Save <Kbd style={{ marginLeft: 2 }}>{isMac() ? "⌘S" : "Ctrl+S"}</Kbd>
      </Button>
    </div>
  );
}
