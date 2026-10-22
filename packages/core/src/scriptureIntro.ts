import type { ScriptureRow } from "./show";
import type { ScriptureSettings } from "./scriptureSettings";
import {
  interpolateWith,
  suggestFieldMap,
  type FieldDescriptor,
  type ResolvedTake,
  type SuggestedFieldMatch,
  type TemplateFieldLike,
} from "./songResolution";

/** Fields a scripture intro template can map to or interpolate. */
export const SCRIPTURE_FIELD_DESCRIPTORS: FieldDescriptor[] = [
  { key: "reference", label: "Reference", type: "text" },
  { key: "book", label: "Book", type: "text" },
  { key: "translation", label: "Translation", type: "text" },
  { key: "translationName", label: "Translation name", type: "text" },
  { key: "attribution", label: "Attribution", type: "text" },
];

/** Values core can't derive itself (book names and translation names live in @overlaysys/scripture). */
export interface ScriptureIntroContext {
  bookName?: string;
  translationName?: string;
}

export function scriptureFieldValues(row: ScriptureRow, ctx: ScriptureIntroContext): Record<string, string> {
  return {
    reference: row.reference,
    book: ctx.bookName ?? "",
    translation: row.translationAbbreviation ?? row.translation,
    translationName: ctx.translationName ?? "",
    attribution: row.attribution ?? "",
  };
}

export function introTemplateIdFor(row: ScriptureRow, settings: ScriptureSettings): string | null {
  if (row.skipIntro) return null;
  return row.introTemplateId ?? settings.introTemplateId ?? null;
}

export function hasScriptureIntro(row: ScriptureRow, settings: ScriptureSettings): boolean {
  return introTemplateIdFor(row, settings) !== null;
}

export function resolveScriptureIntro(
  row: ScriptureRow,
  settings: ScriptureSettings,
  templates: Array<{ id: string; fields: Array<{ key: string; default?: string }> }>,
  ctx: ScriptureIntroContext,
): ResolvedTake | null {
  const templateId = introTemplateIdFor(row, settings);
  if (!templateId) return null;
  const template = templates.find((t) => t.id === templateId);
  if (!template) return null;
  const fieldMap = row.introFieldMap ?? settings.introFieldMap ?? {};
  const literals = row.introFieldLiterals ?? settings.introFieldLiterals ?? {};
  const values = scriptureFieldValues(row, ctx);

  const fieldValues: Record<string, string> = {};
  for (const field of template.fields) {
    const literal = literals[field.key];
    if (literal !== undefined) {
      fieldValues[field.key] = interpolateWith(literal, (k) => values[k]);
      continue;
    }
    const mapped = fieldMap[field.key];
    fieldValues[field.key] = mapped !== undefined ? (values[mapped] ?? "") : (field.default ?? "");
  }
  return { templateId, fieldValues };
}

export function suggestScriptureFieldMap(templateFields: TemplateFieldLike[]): Record<string, SuggestedFieldMatch> {
  return suggestFieldMap(templateFields, SCRIPTURE_FIELD_DESCRIPTORS);
}
