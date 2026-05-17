import type {
  ParsedReference,
  ScripturePassage,
  ScriptureProvider,
  ScriptureVerse,
  TranslationMeta,
} from "../types";

export interface BundleFile {
  translation: TranslationMeta;
  /** books[bookId][chapterStr][verseStr] = text */
  books: Record<string, Record<string, Record<string, string>>>;
}

/**
 * Reads from one or more in-memory bundle JSON files. Each bundle is a full
 * translation (e.g. KJV). Provider response order matches the input
 * ParsedReference[] order and verse order within each range.
 */
export class BundledProvider implements ScriptureProvider {
  readonly translations: readonly TranslationMeta[];
  private readonly byId = new Map<string, BundleFile>();

  constructor(bundles: BundleFile[]) {
    const metas: TranslationMeta[] = [];
    for (const b of bundles) {
      if (this.byId.has(b.translation.id)) {
        throw new Error(
          `Duplicate translation id "${b.translation.id}" within BundledProvider`,
        );
      }
      this.byId.set(b.translation.id, b);
      metas.push(b.translation);
    }
    this.translations = metas;
  }

  async fetchPassage(
    references: ParsedReference[],
    translationId: string,
  ): Promise<ScripturePassage> {
    const bundle = this.byId.get(translationId);
    if (!bundle) {
      throw new Error(`Unknown translation "${translationId}"`);
    }
    const verses: ScriptureVerse[] = [];
    for (const ref of references) {
      const book = bundle.books[ref.book];
      if (!book) {
        throw new Error(`Book "${ref.book}" not present in this translation`);
      }
      for (const range of ref.ranges) {
        for (let ch = range.chapter; ch <= range.endChapter; ch++) {
          const chapter = book[String(ch)];
          if (!chapter) {
            throw new Error(
              `Chapter ${ch} not present for ${ref.book} in this translation`,
            );
          }
          const startV = ch === range.chapter ? range.startVerse : 1;
          const lastVerse = lastVerseOf(chapter);
          const endV = ch === range.endChapter ? range.endVerse : lastVerse;
          for (let v = startV; v <= endV; v++) {
            const text = chapter[String(v)];
            if (text === undefined) {
              throw new Error(
                `Verse ${ref.book} ${ch}:${v} not present in this translation`,
              );
            }
            verses.push({ book: ref.book, chapter: ch, verse: v, text });
          }
        }
      }
    }
    return { verses, attribution: bundle.translation.copyright };
  }
}

function lastVerseOf(chapter: Record<string, string>): number {
  let max = 0;
  for (const k of Object.keys(chapter)) {
    const n = Number(k);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}
