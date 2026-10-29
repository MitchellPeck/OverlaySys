"use client";

import { useEffect, useMemo, useState } from "react";
import { v4 as uuid } from "uuid";
import type { Deck, DeckLicensing } from "@overlaysys/core";
import { Button, Dialog, Input, Select, Tooltip, colors, fontSize, radius } from "@overlaysys/ui";
import { useStore } from "../../lib/store";
import { getClient } from "../../lib/useWs";
import { templatesFor } from "../../lib/templateRoles";
import { LicensingField } from "./LicensingField";
import { buildNewDeck, defaultDeckTemplateId, newDeckBlocker } from "./libraryConfig";

/** Built-in lyric template; used when no template list has loaded. */
const FALLBACK_TEMPLATE_ID = "lyric-default";

/**
 * Name, licensing (no default, Q8) and default design for a new deck. Builds a
 * deck with one empty slide and hands it to `onCreate`, which saves and opens it.
 */
export function NewDeckDialog({
  open,
  onClose,
  onCreate,
  initialName = "",
  initialTemplateId,
  title = "New deck",
  createLabel = "Create",
}: {
  open: boolean;
  onClose(): void;
  onCreate(deck: Deck): void | Promise<void>;
  initialName?: string;
  /** Preselected design (e.g. a one-off row's design for "Save to library…"). */
  initialTemplateId?: string;
  title?: string;
  createLabel?: string;
}) {
  const templates = useStore((s) => s.templates);
  const templatesLoaded = useStore((s) => s.templatesLoaded);
  const [name, setName] = useState(initialName);
  const [licensing, setLicensing] = useState<DeckLicensing | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Fresh form every time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setName(initialName);
    setLicensing(null);
    setTemplateId(initialTemplateId ?? null);
    setBusy(false);
    if (!useStore.getState().templatesLoaded && getClient().getStatus() === "open") {
      getClient().send({ type: "list_templates" });
    }
  }, [open, initialName, initialTemplateId]);

  const groups = useMemo(() => templatesFor(templates, "lyric"), [templates]);
  const chosen = templateId ?? defaultDeckTemplateId(templates) ?? FALLBACK_TEMPLATE_ID;
  const blocker = newDeckBlocker(name, licensing);

  const create = async () => {
    if (blocker || !licensing || busy) return;
    setBusy(true);
    try {
      await onCreate(
        buildNewDeck({
          name,
          licensing,
          templateId: chosen,
          deckId: `deck-${uuid().slice(0, 8)}`,
          slideId: `s-${uuid().slice(0, 8)}`,
          now: new Date().toISOString(),
        }),
      );
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
      {busy ? (createLabel === "Create" ? "Creating…" : "Saving…") : createLabel}
    </Button>
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      onConfirm={() => void create()}
      footer={
        <>
          <Button variant="secondary" size="md" onClick={onClose}>
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
          <label htmlFor="new-deck-name" style={{ fontSize: fontSize.sm, color: colors.textDim }}>
            Name
          </label>
          <Input
            id="new-deck-name"
            size="md"
            autoFocus
            value={name}
            placeholder="Deck name"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <LicensingField value={licensing} onChange={setLicensing} />
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <label htmlFor="new-deck-design" style={{ fontSize: fontSize.sm, color: colors.textDim }}>
            Design
          </label>
          <Select
              id="new-deck-design"
              size="md"
              value={chosen}
              disabled={!templatesLoaded && templates.length === 0}
              onChange={(e) => setTemplateId(e.target.value)}
            >
              {templates.length === 0 ? <option value={chosen}>Default lyric design</option> : null}
              {templates.length > 0 && !templates.some((t) => t.id === chosen) ? (
                <option value={chosen}>(missing design)</option>
              ) : null}
              {groups.suggested.length > 0 ? (
                <optgroup label="Suggested">
                  {groups.suggested.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {groups.others.length > 0 ? (
                <optgroup label="Other designs">
                  {groups.others.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </Select>
          <div style={{ fontSize: fontSize.xs, color: colors.textMuted }}>
            Each slide can use a different design later.
          </div>
        </div>
      </div>
    </Dialog>
  );
}
