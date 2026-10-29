"use client";

import { useMemo, useState } from "react";
import type { ScriptureRow } from "@overlaysys/core";
import { Button, Select, colors, fontSize } from "@overlaysys/ui";
import { ScriptureRowModal } from "@/app/components/ScriptureRowModal";
import { ScriptureIntroEditor, type IntroConfig } from "@/app/components/ScriptureIntroEditor";
import { ScriptureSlideEditor } from "@/app/components/ScriptureSlideEditor";
import { isCloudMode } from "@/lib/mode";
import { useScriptureSettings } from "@/lib/scriptureSettings";
import { budgetForPref, loadSlideSizePref } from "@/lib/slideSizePref";
import { useStore } from "@/lib/store";
import { TemplateSelect } from "../TemplateSelect";
import type { ItemFormProps } from "./types";
import { FormRow, ItemCommonFields, ItemFormFrame } from "./ItemCommonFields";
import { applyPassage, patchRow, recentTemplateIds } from "./itemFormModel";

type IntroMode = "default" | "custom" | "none";

const CLEAR_INTRO = { introTemplateId: undefined, introFieldMap: undefined, introFieldLiterals: undefined };

export function ScriptureItemForm({ row, show, onChange }: ItemFormProps<ScriptureRow>) {
  const templates = useStore((s) => s.templates);
  const settings = useScriptureSettings();
  const [modalOpen, setModalOpen] = useState(false);
  const [introMode, setIntroMode] = useState<IntroMode>(row.skipIntro ? "none" : row.introTemplateId ? "custom" : "default");
  const budget = useMemo(() => budgetForPref(loadSlideSizePref()), []);
  const recent = useMemo(() => recentTemplateIds(show, "scripture"), [show]);
  const patch = (p: Record<string, unknown>) => onChange(patchRow(row, p));
  const translation = row.translationAbbreviation || row.translation.toUpperCase();
  const defaultIntroName = templates.find((t) => t.id === settings?.introTemplateId)?.name;

  function setMode(mode: IntroMode) {
    setIntroMode(mode);
    if (mode === "default") patch({ ...CLEAR_INTRO, skipIntro: undefined });
    else if (mode === "none") patch({ ...CLEAR_INTRO, skipIntro: true });
    else patch({ skipIntro: undefined });
  }

  return (
    <ItemFormFrame row={row} show={show} name={row.reference}>
      <FormRow label="Passage">
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: fontSize.md }}>
          <span>
            {row.reference} <span style={{ color: colors.textMuted }}>{translation}</span>
          </span>
          <Button size="sm" onClick={() => setModalOpen(true)}>
            Change passage…
          </Button>
        </div>
      </FormRow>
      <FormRow label="Template">
        <TemplateSelect label="Template" use="scripture" value={row.templateId} recentIds={recent} onChange={(id) => patch({ templateId: id })} />
      </FormRow>
      <FormRow label="Slides">
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span style={{ fontSize: fontSize.xs, color: colors.textMuted }}>
            {row.slides.length} slide{row.slides.length === 1 ? "" : "s"}. Click between words to add a break; drag a break to move it.
          </span>
          <ScriptureSlideEditor
            slides={row.slides.map((s) => ({ id: s.id, verses: s.verses }))}
            budget={budget}
            onChange={(next) =>
              // Keep each slide's other keys when its id survives the edit.
              patch({
                slides: next.map((s) => ({ ...(row.slides.find((o) => o.id === s.id) ?? {}), id: s.id, verses: s.verses })),
              })
            }
          />
        </div>
      </FormRow>
      <FormRow label="Intro">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Select aria-label="Intro" value={introMode} onChange={(e) => setMode(e.target.value as IntroMode)} style={{ maxWidth: 320 }}>
            <option value="default">Use default intro{defaultIntroName ? ` (${defaultIntroName})` : " (none set)"}</option>
            <option value="custom">Custom intro for this item</option>
            <option value="none">No intro</option>
          </Select>
          {introMode === "custom" && (
            <ScriptureIntroEditor
              value={{ introTemplateId: row.introTemplateId, introFieldMap: row.introFieldMap, introFieldLiterals: row.introFieldLiterals }}
              onChange={(next: IntroConfig) => patch({ ...CLEAR_INTRO, ...next })}
            />
          )}
        </div>
      </FormRow>
      <ItemCommonFields row={row} onChange={(p) => patch(p)} showSermonNotes sets={isCloudMode() ? [] : show.sermonNotes ?? []} />
      <ScriptureRowModal
        open={modalOpen}
        changePassageOf={row}
        onClose={() => setModalOpen(false)}
        onSave={(args) => {
          onChange(
            applyPassage(row, {
              reference: args.reference,
              translation: args.translation,
              translationAbbreviation: args.translationAbbreviation,
              attribution: args.attribution,
              source: args.passage.source,
              slides: args.slides,
              templateId: args.templateId,
              intro: args.intro,
            }),
          );
          setIntroMode(args.intro.skipIntro ? "none" : args.intro.introTemplateId ? "custom" : "default");
          setModalOpen(false);
        }}
      />
    </ItemFormFrame>
  );
}
