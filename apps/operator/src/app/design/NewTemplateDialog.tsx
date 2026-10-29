"use client";

import { useEffect, useState } from "react";
import { TEMPLATE_STARTERS } from "@overlaysys/editor-kit";
import { Button, Dialog, Input, Tooltip, colors, fontSize, fontWeight, radius } from "@overlaysys/ui";

/** Starter cards plus a required name. Create stays disabled until a name is typed. */
export function NewTemplateDialog({
  open,
  onCancel,
  onCreate,
}: {
  open: boolean;
  onCancel(): void;
  onCreate(name: string, starterId: string): void | Promise<void>;
}) {
  const [name, setName] = useState("");
  const [starterId, setStarterId] = useState(TEMPLATE_STARTERS[0]?.id ?? "blank");
  const [busy, setBusy] = useState(false);

  // Fresh form every time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setName("");
    setStarterId(TEMPLATE_STARTERS[0]?.id ?? "blank");
    setBusy(false);
  }, [open]);

  const blocker = name.trim() ? null : "Name the template";
  const create = async () => {
    if (blocker || busy) return;
    setBusy(true);
    try {
      await onCreate(name.trim(), starterId);
    } finally {
      setBusy(false);
    }
  };

  const createButton = (
    <Button
      variant="primary"
      size="md"
      disabled={!!blocker || busy}
      onClick={() => void create()}
      style={blocker ? { pointerEvents: "none" } : undefined}
    >
      {busy ? "Creating…" : "Create"}
    </Button>
  );

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title="New template"
      size="sm"
      onConfirm={() => void create()}
      footer={
        <>
          <Button variant="secondary" size="md" onClick={onCancel}>
            Cancel
          </Button>
          {blocker ? (
            <Tooltip content={blocker} side="top">
              <span tabIndex={0} style={{ display: "inline-flex", borderRadius: radius.md, outline: "none" }}>
                {createButton}
              </span>
            </Tooltip>
          ) : (
            createButton
          )}
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label htmlFor="new-template-name" style={{ fontSize: fontSize.sm, color: colors.textDim }}>
            Name
          </label>
          <Input
            id="new-template-name"
            size="md"
            autoFocus
            value={name}
            placeholder="Template name"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span id="new-template-starter" style={{ fontSize: fontSize.sm, color: colors.textDim }}>
            Start from
          </span>
          <div
            role="radiogroup"
            aria-labelledby="new-template-starter"
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}
          >
            {TEMPLATE_STARTERS.map((s) => {
              const on = s.id === starterId;
              return (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setStarterId(s.id)}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                    alignItems: "flex-start",
                    textAlign: "left",
                    padding: 8,
                    cursor: "pointer",
                    background: on ? colors.surface3 : colors.surface,
                    color: colors.text,
                    border: `1px solid ${on ? colors.brand : colors.border}`,
                    borderRadius: radius.md,
                    fontFamily: "inherit",
                  }}
                >
                  <span style={{ fontSize: fontSize.md, fontWeight: fontWeight.medium }}>{s.label}</span>
                  <span style={{ fontSize: fontSize.xs, color: colors.textDim }}>{s.description}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </Dialog>
  );
}
