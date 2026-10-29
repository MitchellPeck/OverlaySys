"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BOOKS,
  parseReference,
  ScriptureRefError,
  splitIntoSlides,
  slidesToBreaks,
  type TranslationMeta,
} from "@overlaysys/scripture";
import {
  listTranslations,
  fetchPassage,
  type PassageResponse,
} from "@/lib/scriptureClient";
import { Button, Field, Input, Modal, Select, colors } from "@overlaysys/ui";
import { ScriptureIntroEditor, type IntroConfig } from "./ScriptureIntroEditor";
import { useScriptureSettings } from "@/lib/scriptureSettings";
import { ScriptureSlideEditor, type EditableSlide } from "./ScriptureSlideEditor";
import { useStore } from "@/lib/store";
import { useDialog } from "@/lib/dialog";
import {
  budgetChanged,
  budgetForPref,
  clampCustomChars,
  loadSlideSizePref,
  saveSlideSizePref,
  type SlideSizePref,
} from "@/lib/slideSizePref";
import type { ScriptureRow } from "@overlaysys/core";
import { templatesFor } from "@/lib/templateRoles";
import { TemplateSelect } from "@/app/shows/edit/TemplateSelect";

interface Props {
  open: boolean;
  onClose: () => void;
  onSave: (args: SaveArgs) => void;
  /** When set, modal opens at step 2 pre-loaded with this row's slides + template. */
  editingRow?: ScriptureRow;
  /**
   * When set, the modal edits this row's passage: it opens at step 1 with the
   * row's reference and translation, then re-splits the new passage. The
   * caller keeps the row id, length and notes link.
   */
  changePassageOf?: ScriptureRow;
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
  intro: IntroConfig & { skipIntro?: boolean };
}

export function ScriptureRowModal({ open, onClose, onSave, editingRow, changePassageOf }: Props) {
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
            // Merge mid-verse portions back into whole verses.
            verses: slidesToBreaks(editingRow.slides).verses,
          };
          setPassage(synthesized);
        } else if (changePassageOf) {
          setRefInput(changePassageOf.reference);
          setTranslation(changePassageOf.translation || t[0]?.id || "");
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
  }, [open, editingRow, changePassageOf]);

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
      title={editingRow || changePassageOf ? "Edit scripture" : "Add scripture"}
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
          seedTemplateId={(editingRow ?? changePassageOf)?.templateId}
          seedIntro={
            editingRow ?? changePassageOf
              ? {
                  introTemplateId: (editingRow ?? changePassageOf)!.introTemplateId,
                  introFieldMap: (editingRow ?? changePassageOf)!.introFieldMap,
                  introFieldLiterals: (editingRow ?? changePassageOf)!.introFieldLiterals,
                  skipIntro: (editingRow ?? changePassageOf)!.skipIntro,
                }
              : undefined
          }
          backLabel={editingRow ? "Cancel" : "Back"}
          onCancel={() => {
            if (editingRow) {
              onClose();
            } else {
              setPassage(null);
            }
          }}
          onSave={(slides, templateId, intro) => {
            const meta = translations.find((t) => t.id === passage.translation);
            onSave({
              reference: passage.reference,
              translation: passage.translation,
              translationAbbreviation: meta?.abbreviation,
              attribution: passage.attribution,
              passage,
              slides,
              templateId,
              intro,
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
  seedIntro,
  backLabel = "Back",
  onCancel,
  onSave,
}: {
  passage: PassageResponse;
  seedSlides?: EditableSlide[];
  seedTemplateId?: string;
  seedIntro?: IntroConfig & { skipIntro?: boolean };
  backLabel?: string;
  onCancel: () => void;
  onSave: (slides: EditableSlide[], templateId: string, intro: IntroConfig & { skipIntro?: boolean }) => void;
}) {
  const { confirm, dialog } = useDialog();
  const templates = useStore((s) => s.templates);
  const [sizePref, setSizePref] = useState<SlideSizePref>(() => loadSlideSizePref());
  const [customDraft, setCustomDraft] = useState<string>(() =>
    sizePref.kind === "custom" ? String(sizePref.maxChars) : "",
  );
  const budget = budgetForPref(sizePref);
  const [slides, setSlides] = useState<EditableSlide[]>(() =>
    seedSlides && seedSlides.length > 0
      ? seedSlides
      : splitIntoSlides(passage.verses, budget).map((s) => ({ id: s.id, verses: s.verses })),
  );
  // Saved rows count as hand-edited: their breaks may have been placed manually.
  const [manualEdits, setManualEdits] = useState<boolean>(!!seedSlides && seedSlides.length > 0);
  // Fallback: the first suggested scripture template (contracts: templatesFor).
  const [templateId, setTemplateId] = useState<string>(
    seedTemplateId || templatesFor(templates, "scripture").suggested[0]?.id || templates[0]?.id || "",
  );

  const [introMode, setIntroMode] = useState<"default" | "custom" | "none">(
    seedIntro?.skipIntro ? "none" : seedIntro?.introTemplateId ? "custom" : "default",
  );
  const [introCfg, setIntroCfg] = useState<IntroConfig>({
    introTemplateId: seedIntro?.introTemplateId,
    introFieldMap: seedIntro?.introFieldMap,
    introFieldLiterals: seedIntro?.introFieldLiterals,
  });
  const settings = useScriptureSettings();
  // New rows start on the Settings default template (settings load async, so
  // apply it once they arrive — unless the operator already picked one).
  const [templatePicked, setTemplatePicked] = useState(false);
  useEffect(() => {
    if (seedTemplateId || templatePicked) return;
    const def = settings?.defaultTemplateId;
    if (def && templates.some((t) => t.id === def)) setTemplateId(def);
  }, [seedTemplateId, templatePicked, settings, templates]);
  const defaultName = templates.find((t) => t.id === settings?.introTemplateId)?.name;

  /** Switch slide size, re-splitting only if the budget actually changes. Returns false if the operator cancels. */
  async function applySize(next: SlideSizePref): Promise<boolean> {
    const nextBudget = budgetForPref(next);
    const resplit = budgetChanged(budget, nextBudget);
    if (
      resplit &&
      manualEdits &&
      !(await confirm({
        title: "Re-split slides?",
        message: "Changing the slide size re-splits the passage and discards your manual breaks.",
        confirmLabel: "Re-split",
        destructive: true,
      }))
    ) {
      return false;
    }
    setSizePref(next);
    saveSlideSizePref(next);
    if (next.kind === "custom") setCustomDraft(String(nextBudget.maxChars));
    if (resplit) {
      setSlides(
        splitIntoSlides(passage.verses, nextBudget).map((s) => ({ id: s.id, verses: s.verses })),
      );
      setManualEdits(false);
    }
    return true;
  }

  const customDraftChars = clampCustomChars(Number(customDraft));
  const customPending = sizePref.kind === "custom" && customDraftChars !== budget.maxChars;
  async function applyCustomDraft() {
    if (!(await applySize({ kind: "custom", maxChars: customDraftChars }))) {
      setCustomDraft(String(budget.maxChars));
    }
  }

  return (
    <>
      {dialog}
      <Field label="Template">
        <TemplateSelect
          label="Template"
          use="scripture"
          value={templateId}
          onChange={(id) => {
            setTemplatePicked(true);
            setTemplateId(id);
          }}
          style={{ maxWidth: "none" }}
        />
      </Field>
      <Field label="Text per slide" style={{ marginTop: 12 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <Select
            value={sizePref.kind}
            onChange={(e) => {
              const kind = e.target.value as SlideSizePref["kind"];
              if (kind === "custom") {
                // Start Custom at the current size: reveals the input without re-splitting.
                applySize({ kind: "custom", maxChars: budget.maxChars });
              } else {
                applySize({ kind });
              }
            }}
          >
            <option value="short">Short (~120 chars)</option>
            <option value="medium">Medium (~240 chars)</option>
            <option value="long">Long (~360 chars)</option>
            <option value="custom">Custom…</option>
          </Select>
          {sizePref.kind === "custom" && (
            <Input
              type="number"
              min={40}
              max={2000}
              aria-label="Max characters per slide"
              value={customDraft}
              onChange={(e) => setCustomDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && customPending) applyCustomDraft();
              }}
              style={{ width: 100 }}
            />
          )}
          {customPending && (
            <Button size="sm" variant="primary" onClick={applyCustomDraft}>
              Apply
            </Button>
          )}
        </div>
      </Field>
      <Field label="Intro" style={{ marginTop: 12 }}>
        <Select value={introMode} onChange={(e) => setIntroMode(e.target.value as "default" | "custom" | "none")}>
          <option value="default">Use default intro{defaultName ? ` (${defaultName})` : " (none set)"}</option>
          <option value="custom">Custom intro for this row</option>
          <option value="none">No intro</option>
        </Select>
      </Field>
      {introMode === "custom" && (
        <div style={{ marginTop: 8 }}>
          <ScriptureIntroEditor value={introCfg} onChange={setIntroCfg} />
        </div>
      )}
      <p style={{ fontSize: 12, color: colors.textDim, marginTop: 8 }}>
        Click between words to add a slide break; drag a break to move it.
      </p>
      <div style={{ marginTop: 8 }}>
        <ScriptureSlideEditor
          slides={slides}
          budget={budget}
          onChange={(next) => {
            setSlides(next);
            setManualEdits(true);
          }}
        />
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
        <Button variant="ghost" onClick={onCancel}>{backLabel}</Button>
        <Button
          variant="primary"
          disabled={!templateId || slides.length === 0}
          onClick={() =>
            onSave(
              slides,
              templateId,
              introMode === "custom"
                ? { ...introCfg, skipIntro: false }
                : introMode === "none"
                  ? { skipIntro: true }
                  : {},
            )
          }
        >
          Save
        </Button>
      </div>
    </>
  );
}
