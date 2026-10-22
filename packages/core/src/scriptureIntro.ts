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

const TITLE_ALIASES = new Set(["title", "heading", "name", "header"]);
const SUBTITLE_ALIASES = new Set(["subtitle", "subheading", "sub title", "sub-title"]);

/**
 * Suggest a template-field -> scripture-field map. Exact key matches win; then
 * title-like fields (by key or label) alias to `reference` and subtitle-like
 * to `translation` (first such field claims each); the rest use the shared
 * key/label matcher over whatever scripture fields remain.
 */
export function suggestScriptureFieldMap(templateFields: TemplateFieldLike[]): Record<string, SuggestedFieldMatch> {
  const result: Record<string, SuggestedFieldMatch> = {};
  const claimed = new Set<string>();
  const scriptureByLowerKey = new Map(SCRIPTURE_FIELD_DESCRIPTORS.map((d) => [d.key.toLowerCase(), d.key]));
  const rest: TemplateFieldLike[] = [];
  for (const tf of templateFields) {
    const key = scriptureByLowerKey.get(tf.key.toLowerCase());
    if (key && !claimed.has(key)) {
      result[tf.key] = { kind: "exact", songFieldKey: key };
      claimed.add(key);
    } else {
      rest.push(tf);
    }
  }
  const remaining: TemplateFieldLike[] = [];
  for (const tf of rest) {
    const names = [tf.key, tf.label].map((n) => (n ?? "").trim().toLowerCase());
    const target = names.some((n) => TITLE_ALIASES.has(n))
      ? "reference"
      : names.some((n) => SUBTITLE_ALIASES.has(n))
        ? "translation"
        : null;
    if (target && !claimed.has(target)) {
      result[tf.key] = { kind: "suggested", songFieldKey: target };
      claimed.add(target);
    } else {
      remaining.push(tf);
    }
  }
  Object.assign(
    result,
    suggestFieldMap(remaining, SCRIPTURE_FIELD_DESCRIPTORS.filter((d) => !claimed.has(d.key))),
  );
  return result;
}
