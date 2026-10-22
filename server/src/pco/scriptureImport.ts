import type { RowSourceRef, RundownRow, ScriptureRow } from "@overlaysys/core";
import { DEFAULT_SLIDE_BUDGET, parseReference, splitIntoSlides } from "@overlaysys/scripture";
import { ensureApiBible } from "../apiBible/config";
import { reportViews } from "../apiBible/fums";
import { formatNormalizedReference, getScriptureRegistry } from "../scripture";

export interface BuildImportedScriptureRowArgs {
  rowId: string;
  reference: string;
  translation: string;
  templateId: string;
  slideMaxChars?: number;
  notes?: string;
  sourceRef: RowSourceRef;
  /** The row this import previously produced, if any (re-import). */
  existing?: RundownRow;
}

/**
 * Fetch a passage and build an auto-split scripture row for a PCO plan item.
 * Re-importing an unchanged reference+translation keeps the existing row's
 * slides and intro overrides (operator edits) and only refreshes template,
 * sourceRef and notes. Reference/provider/unknown-translation errors propagate.
 */
export async function buildImportedScriptureRow(
  args: BuildImportedScriptureRowArgs,
): Promise<ScriptureRow> {
  const parsed = parseReference(args.reference);
  const reference = formatNormalizedReference(parsed);
  const { existing } = args;

  if (existing?.kind === "scripture" && existing.reference === reference && existing.translation === args.translation) {
    return { ...existing, templateId: args.templateId, sourceRef: args.sourceRef, notes: args.notes };
  }

  await ensureApiBible();
  const registry = getScriptureRegistry();
  const provider = registry.providerFor(args.translation);
  if (!provider) throw new Error(`Translation "${args.translation}" is not registered`);

  const passage = await provider.fetchPassage(parsed, args.translation);
  if (passage.source) void reportViews(passage.source.usageTokens);

  const abbreviation = registry.listTranslations().find((t) => t.id === args.translation)?.abbreviation;
  const slides = splitIntoSlides(passage.verses, {
    maxChars: args.slideMaxChars ?? DEFAULT_SLIDE_BUDGET.maxChars,
  }).map((s) => ({ id: s.id, verses: s.verses }));

  return {
    kind: "scripture",
    id: args.rowId,
    reference,
    translation: args.translation,
    ...(abbreviation ? { translationAbbreviation: abbreviation } : {}),
    attribution: passage.attribution,
    slides,
    templateId: args.templateId,
    ...(args.notes !== undefined ? { notes: args.notes } : {}),
    sourceRef: args.sourceRef,
    ...(passage.source
      ? { source: { ...passage.source, fetchedAt: new Date().toISOString() } }
      : {}),
  };
}
