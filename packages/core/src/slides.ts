import { z } from "zod";
import type { Template } from "./template";
import type { Deck, DeckLicensing, DeckSlide, SlidesRowFields } from "./deck";

export type ResolvedSlide = {
  key: string;
  slideId: string;
  position: number;
  templateId: string;
  data: Record<string, string>;
  label?: string;
};

export type SlidesRowView = {
  title: string;
  detail: string;
  slides: ResolvedSlide[];
  missingDeck: boolean;
  missingSlides: number;
  licensing: DeckLicensing["kind"] | null;
};

export const SLIDES_END_OF_DECK = "End of deck · Space again to clear";

/** slide → row → deck; "" when nothing resolves. */
export function resolveSlideTemplateId(
  slide: DeckSlide,
  row: Pick<SlidesRowFields, "templateId">,
  deck: Pick<Deck, "defaultTemplateId"> | null,
): string {
  return slide.templateId || row.templateId || deck?.defaultTemplateId || "";
}

function sourceSlides(row: SlidesRowFields, deck: Deck | null): DeckSlide[] | null {
  if (row.deckId) return deck ? deck.slides : null;
  return row.localSlides ?? null;
}

export function resolveSlidesRow(
  row: SlidesRowFields,
  deck: Deck | null,
): { slides: ResolvedSlide[]; missingSlides: number } {
  const source = sourceSlides(row, deck);
  if (!source) return { slides: [], missingSlides: 0 };
  const byId = new Map(source.map((s) => [s.id, s] as const));
  const ids = row.slideIds ?? source.map((s) => s.id);
  const slides: ResolvedSlide[] = [];
  let missingSlides = 0;
  for (const id of ids) {
    const s = byId.get(id);
    if (!s) {
      missingSlides++;
      continue;
    }
    const position = slides.length;
    const out: ResolvedSlide = {
      key: `${row.id}:${position}:${s.id}`,
      slideId: s.id,
      position,
      templateId: resolveSlideTemplateId(s, row, row.deckId ? deck : null),
      data: { ...s.data, ...(row.fieldOverrides?.[s.id] ?? {}) },
    };
    if (s.label !== undefined) out.label = s.label;
    slides.push(out);
  }
  return { slides, missingSlides };
}

const plural = (n: number) => `${n} slide${n === 1 ? "" : "s"}`;

export function slidesRowView(
  row: SlidesRowFields,
  deck: Deck | null | undefined,
): SlidesRowView {
  if (row.deckId && deck === undefined) {
    return { title: "Slides deck", detail: "Loading…", slides: [], missingDeck: false, missingSlides: 0, licensing: null };
  }
  const d = deck ?? null;
  const source = sourceSlides(row, d);
  if (!source) {
    return { title: "Missing deck", detail: "Deck deleted or not synced", slides: [], missingDeck: true, missingSlides: 0, licensing: null };
  }
  const { slides, missingSlides } = resolveSlidesRow(row, d);
  const detail =
    row.slideIds && row.deckId && d
      ? `${new Set(slides.map((s) => s.slideId)).size} of ${source.length} slides` // distinct: repeats don't count twice
      : plural(slides.length);
  return {
    title: row.deckId && d ? d.name : "One-off slides",
    detail,
    slides,
    missingDeck: false,
    missingSlides,
    licensing: row.deckId && d ? d.licensing.kind : null,
  };
}

/**
 * The field data a slides-row slide is rendered with (program, preview and
 * every thumbnail). Every field the design declares gets an explicit value, so
 * a same-design slide advance (a data update, which merges on the server and in
 * the renderer's mount) never carries a previous slide's value over:
 * - text fields the slide doesn't supply → "" (the design's sample text never airs);
 * - non-text fields (image, colour, video, …) the slide doesn't supply → the
 *   design's own default for that field, or "" when it declares none.
 */
export function slideAirData(
  data: Record<string, string>,
  template: Pick<Template, "fields"> | null | undefined,
): Record<string, string> {
  if (!template) return data;
  const out = { ...data };
  for (const f of template.fields) {
    if (out[f.key] !== undefined) continue;
    out[f.key] = f.type === "text" ? "" : (f.default ?? "");
  }
  return out;
}

export function slideTextLines(
  data: Record<string, string>,
  template?: Pick<Template, "fields">,
): string[] {
  const values = template
    ? template.fields.filter((f) => f.type === "text").map((f) => data[f.key] ?? "")
    : Object.values(data);
  return values.flatMap((v) => v.split("\n")).filter((l) => l.trim() !== "");
}

export function deckTextToSlides(text: string, fieldKey: string, newId: () => string): DeckSlide[] {
  return text
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter((b) => b !== "")
    .map((b) => ({ id: newId(), data: { [fieldKey]: b } }));
}

export const SlidesSessionSummarySchema = z.object({
  rowId: z.string(),
  deckId: z.string().optional(),
  title: z.string(),
  slideIdx: z.number().int().nonnegative(),
  slideCount: z.number().int().positive(),
  label: z.string().optional(),
  lines: z.array(z.string()),
  nextLines: z.array(z.string()).optional(),
  nextLabel: z.string().optional(),
  blanked: z.boolean(),
  atEnd: z.boolean(),
});
export type SlidesSessionSummary = z.infer<typeof SlidesSessionSummarySchema>;
