"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BOOKS,
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
import type { ScriptureRow } from "@overlaysys/core";

interface Props {
  open: boolean;
  onClose: () => void;
  onSave: (args: SaveArgs) => void;
  /** When set, modal opens at step 2 pre-loaded with this row's slides + template. */
  editingRow?: ScriptureRow;
}

export interface SaveArgs {
  reference: string;
  translation: string;
  /** Abbreviation of the selected translation (e.g. "KJV"), cached at save time. */
  translationAbbreviation: string | undefined;
  attribution: string;
  passage: PassageResponse;
  slides: EditableSlide[];
  templateId: string;
}

export function ScriptureRowModal({ open, onClose, onSave, editingRow }: Props) {
  const [translations, setTranslations] = useState<TranslationMeta[]>([]);
  const [refInput, setRefInput] = useState("");
  const [translation, setTranslation] = useState<string>("");
  const [passage, setPassage] = useState<PassageResponse | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Structured picker state
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerBook, setPickerBook] = useState<string>("GEN");
  const [pickerChapter, setPickerChapter] = useState<number>(1);
  const [pickerVerseStart, setPickerVerseStart] = useState<number>(1);
  const [pickerVerseEnd, setPickerVerseEnd] = useState<number | "">("");

  // Load translations when modal opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listTranslations()
      .then((t) => {
        if (cancelled) return;
        setTranslations(t);
        if (editingRow) {
          setTranslation(editingRow.translation);
          // Synthesize a PassageResponse so Step2 renders with the saved slides.
          const synthesized: PassageResponse = {
            reference: editingRow.reference,
            translation: editingRow.translation,
            attribution: editingRow.attribution ?? "",
            verses: editingRow.slides.flatMap((s) => s.verses),
          };
          setPassage(synthesized);
        } else {
          setTranslation((cur) => cur || t[0]?.id || "");
        }
      })
      .catch((e) => {
        if (!cancelled)
          setFetchError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [open, editingRow]);

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

  function insertFromPicker() {
    const book = BOOKS.find((b) => b.id === pickerBook);
    if (!book) return;
    const v =
      pickerVerseEnd && pickerVerseEnd > pickerVerseStart
        ? `${pickerVerseStart}-${pickerVerseEnd}`
        : `${pickerVerseStart}`;
    setRefInput(`${book.name} ${pickerChapter}:${v}`);
    setPickerOpen(false);
  }

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
              list="scripture-books"
            />
            <datalist id="scripture-books">
              {BOOKS.map((b) => (
                <option key={b.id} value={b.name} />
              ))}
            </datalist>
          </Field>

          {parseError && (
            <p role="alert" style={{ color: colors.errorText, fontSize: 12, marginTop: 4 }}>
              {parseError}
            </p>
          )}

          <div style={{ marginTop: 8 }}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPickerOpen((o) => !o)}
            >
              {pickerOpen ? "− Hide structured picker" : "+ Use structured picker"}
            </Button>
          </div>

          {pickerOpen && (
            <div
              style={{
                marginTop: 8,
                padding: "10px 12px",
                background: colors.panel2,
                borderRadius: 6,
                border: `1px solid ${colors.border}`,
                display: "grid",
                gridTemplateColumns: "1fr 80px 80px 80px",
                gap: 8,
                alignItems: "end",
              }}
            >
              <Field label="Book">
                <Select
                  value={pickerBook}
                  onChange={(e) => {
                    setPickerBook(e.target.value);
                    const bookEntry = BOOKS.find((b) => b.id === e.target.value);
                    if (bookEntry && pickerChapter > bookEntry.chapters) {
                      setPickerChapter(bookEntry.chapters);
                    }
                  }}
                >
                  {BOOKS.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Chapter">
                <Input
                  type="number"
                  min={1}
                  max={BOOKS.find((b) => b.id === pickerBook)?.chapters ?? 1}
                  value={pickerChapter}
                  onChange={(e) =>
                    setPickerChapter(Math.max(1, parseInt(e.target.value, 10) || 1))
                  }
                />
              </Field>
              <Field label="Verse">
                <Input
                  type="number"
                  min={1}
                  value={pickerVerseStart}
                  onChange={(e) =>
                    setPickerVerseStart(Math.max(1, parseInt(e.target.value, 10) || 1))
                  }
                />
              </Field>
              <Field label="End verse">
                <Input
                  type="number"
                  min={1}
                  value={pickerVerseEnd}
                  placeholder="—"
                  onChange={(e) => {
                    const v = e.target.value;
                    setPickerVerseEnd(v === "" ? "" : Math.max(1, parseInt(v, 10) || 1));
                  }}
                />
              </Field>
              <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
                <Button variant="primary" size="sm" onClick={insertFromPicker}>
                  Insert into reference
                </Button>
              </div>
            </div>
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
          seedSlides={
            editingRow
              ? editingRow.slides.map((s) => ({ id: s.id, verses: s.verses }))
              : undefined
          }
          seedTemplateId={editingRow?.templateId}
          backLabel={editingRow ? "Cancel" : "Back"}
          onCancel={() => {
            if (editingRow) {
              onClose();
            } else {
              setPassage(null);
            }
          }}
          onSave={(slides, templateId) => {
            const meta = translations.find((t) => t.id === passage.translation);
            onSave({
              reference: passage.reference,
              translation: passage.translation,
              translationAbbreviation: meta?.abbreviation,
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
  seedSlides,
  seedTemplateId,
  backLabel = "Back",
  onCancel,
  onSave,
}: {
  passage: PassageResponse;
  seedSlides?: EditableSlide[];
  seedTemplateId?: string;
  backLabel?: string;
  onCancel: () => void;
  onSave: (slides: EditableSlide[], templateId: string) => void;
}) {
  const templates = useStore((s) => s.templates);
  const [slides, setSlides] = useState<EditableSlide[]>(() =>
    seedSlides && seedSlides.length > 0
      ? seedSlides
      : splitIntoSlides(passage.verses, DEFAULT_SLIDE_BUDGET).map((s) => ({
          id: s.id,
          verses: s.verses,
        })),
  );
  const [templateId, setTemplateId] = useState<string>(
    seedTemplateId || templates[0]?.id || "",
  );

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
        <Button variant="ghost" onClick={onCancel}>{backLabel}</Button>
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
