"use client";

import { useEffect, useMemo, useState } from "react";
import {
  parseReference,
  ScriptureRefError,
  splitIntoSlides,
  DEFAULT_SLIDE_BUDGET,
  type TranslationMeta,
} from "@overlaysys/scripture";
import {
  listTranslations,
  fetchPassage,
  type PassageResponse,
} from "@/lib/scriptureClient";
import { Button, Field, Input, Modal, Select, colors } from "@overlaysys/ui";
import { ScriptureSlideEditor, type EditableSlide } from "./ScriptureSlideEditor";
import { useStore } from "@/lib/store";

interface Props {
  open: boolean;
  onClose: () => void;
  onSave: (args: SaveArgs) => void;
}

export interface SaveArgs {
  reference: string;
  translation: string;
  attribution: string;
  passage: PassageResponse;
  slides: EditableSlide[];
  templateId: string;
}

export function ScriptureRowModal({ open, onClose, onSave }: Props) {
  const [translations, setTranslations] = useState<TranslationMeta[]>([]);
  const [refInput, setRefInput] = useState("");
  const [translation, setTranslation] = useState<string>("");
  const [passage, setPassage] = useState<PassageResponse | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Load translations when modal opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listTranslations()
      .then((t) => {
        if (cancelled) return;
        setTranslations(t);
        setTranslation((cur) => cur || t[0]?.id || "");
      })
      .catch((e) => {
        if (!cancelled)
          setFetchError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Reset when modal closes so the next open starts fresh.
  useEffect(() => {
    if (!open) {
      setRefInput("");
      setPassage(null);
      setFetchError(null);
      setBusy(false);
    }
  }, [open]);

  const parseError = useMemo(() => {
    if (!refInput.trim()) return null;
    try {
      parseReference(refInput);
      return null;
    } catch (e) {
      return e instanceof ScriptureRefError ? e.hint : "Invalid reference";
    }
  }, [refInput]);

  const canContinue =
    refInput.trim().length > 0 &&
    !parseError &&
    translation.length > 0 &&
    !busy;

  async function onContinue() {
    setBusy(true);
    setFetchError(null);
    try {
      const p = await fetchPassage(refInput, translation);
      setPassage(p);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setFetchError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      onCancel={onClose}
      onConfirm={!passage && canContinue ? onContinue : undefined}
      size="sm"
      title="Add scripture"
      footer={
        !passage ? (
          <>
            <Button onClick={onClose} variant="ghost" size="sm">
              Cancel
            </Button>
            <Button
              onClick={onContinue}
              disabled={!canContinue}
              variant="primary"
              size="sm"
            >
              {busy ? "Loading…" : "Continue"}
            </Button>
          </>
        ) : undefined
      }
    >
      {!passage ? (
        <>
          <Field label="Reference">
            <Input
              value={refInput}
              onChange={(e) => setRefInput(e.target.value)}
              placeholder='e.g. "John 3:16-18" or "Rom 8:28; 1 Cor 13:4-7"'
              autoFocus
              invalid={!!parseError}
            />
          </Field>

          {parseError && (
            <p role="alert" style={{ color: colors.errorText, fontSize: 12, marginTop: 4 }}>
              {parseError}
            </p>
          )}

          <Field label="Translation" style={{ marginTop: 12 }}>
            <Select
              value={translation}
              onChange={(e) => setTranslation(e.target.value)}
            >
              {translations.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>

          {fetchError && (
            <p role="alert" style={{ color: colors.errorText, fontSize: 12, marginTop: 8 }}>
              {fetchError}
            </p>
          )}
        </>
      ) : (
        <Step2
          passage={passage}
          onCancel={() => setPassage(null)}
          onSave={(slides, templateId) => {
            onSave({
              reference: passage.reference,
              translation: passage.translation,
              attribution: passage.attribution,
              passage,
              slides,
              templateId,
            });
            onClose();
          }}
        />
      )}
    </Modal>
  );
}

function Step2({
  passage,
  onCancel,
  onSave,
}: {
  passage: PassageResponse;
  onCancel: () => void;
  onSave: (slides: EditableSlide[], templateId: string) => void;
}) {
  const templates = useStore((s) => s.templates);
  const [slides, setSlides] = useState<EditableSlide[]>(() =>
    splitIntoSlides(passage.verses, DEFAULT_SLIDE_BUDGET).map((s) => ({
      id: s.id,
      verses: s.verses,
    })),
  );
  const [templateId, setTemplateId] = useState<string>(templates[0]?.id ?? "");

  return (
    <>
      <Field label="Template">
        <Select
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
        >
          {templates.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </Select>
      </Field>
      <div style={{ marginTop: 12 }}>
        <ScriptureSlideEditor slides={slides} onChange={setSlides} />
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
        <Button variant="ghost" onClick={onCancel}>Back</Button>
        <Button
          variant="primary"
          disabled={!templateId || slides.length === 0}
          onClick={() => onSave(slides, templateId)}
        >
          Save
        </Button>
      </div>
    </>
  );
}
