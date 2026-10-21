import {
  ScriptureProviderError,
  type ParsedReference,
  type RefRange,
  type ScripturePassage,
  type ScriptureProvider,
  type ScriptureVerse,
  type TranslationMeta,
} from "../types";

/** Minimal fetch shape so the package doesn't depend on DOM/Node fetch typings. */
export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<{ status: number; ok: boolean; json(): Promise<unknown> }>;

export const API_BIBLE_BASE_URL = "https://rest.api.bible/v1";

const PASSAGE_QUERY =
  "content-type=text&include-notes=false&include-titles=false&include-chapter-numbers=false&include-verse-numbers=true&include-verse-spans=false&fums-version=3";

const MAX_VERSES_PER_REQUEST = 200;

export const NIV_TRANSLATION: TranslationMeta = {
  id: "NIV",
  name: "New International Version",
  abbreviation: "NIV",
  language: "en",
  copyright:
    "The Holy Bible, New International Version® NIV® Copyright © 1973, 1978, 1984, 2011 by Biblica, Inc.® Used by Permission of Biblica, Inc.® All rights reserved worldwide.",
  isPublicDomain: false,
};

const defaultFetch = (): FetchLike => {
  const f = (globalThis as { fetch?: FetchLike }).fetch;
  if (!f) throw new ScriptureProviderError("offline", "Couldn't reach API.Bible");
  return f;
};

export function passageId(book: string, r: RefRange): string {
  return `${book}.${r.chapter}.${r.startVerse}-${book}.${r.endChapter}.${r.endVerse}`;
}

/**
 * Parse API.Bible `content-type=text` output. Each `[n]` starts a verse;
 * text before the first marker (e.g. "Psalm 23") is ignored; a verse number
 * that doesn't increase means the passage crossed into the next chapter.
 * Whitespace runs collapse to one space (display only — words unchanged).
 */
export function parseApiBibleText(content: string, book: string, startChapter: number): ScriptureVerse[] {
  const marks = [...content.matchAll(/\[(\d+)\]/g)];
  const verses: ScriptureVerse[] = [];
  let chapter = startChapter;
  let prev = -1;
  marks.forEach((m, i) => {
    const verse = Number(m[1]);
    if (prev >= 0 && verse <= prev) chapter++;
    prev = verse;
    const start = m.index! + m[0].length;
    const end = marks[i + 1]?.index ?? content.length;
    const text = content.slice(start, end).replace(/\s+/g, " ").trim();
    if (text) verses.push({ book, chapter, verse, text });
  });
  return verses;
}

export async function apiBibleGet(
  apiKey: string,
  path: string,
  fetchImpl?: FetchLike,
  baseUrl: string = API_BIBLE_BASE_URL,
): Promise<unknown> {
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await (fetchImpl ?? defaultFetch())(`${baseUrl}${path}`, { headers: { "api-key": apiKey } });
  } catch (e) {
    if (e instanceof ScriptureProviderError) throw e;
    throw new ScriptureProviderError("offline", "Couldn't reach API.Bible");
  }
  if (res.status === 401 || res.status === 403) {
    throw new ScriptureProviderError("rejected", "API.Bible key rejected — check Settings");
  }
  if (res.status === 400 || res.status === 404) {
    throw new ScriptureProviderError("out_of_range", "That passage isn't available in this translation");
  }
  if (!res.ok) throw new ScriptureProviderError("upstream", `API.Bible error ${res.status}`);
  return res.json();
}

export async function findNivBible(apiKey: string, fetchImpl?: FetchLike): Promise<{ bibleId: string } | null> {
  const body = (await apiBibleGet(apiKey, "/bibles?abbreviation=NIV", fetchImpl)) as {
    data?: { id: string; abbreviation?: string; abbreviationLocal?: string }[];
  };
  const list = body.data ?? [];
  const hit =
    list.find((b) => b.abbreviationLocal === "NIV") ?? list.find((b) => (b.abbreviation ?? "").startsWith("NIV"));
  return hit ? { bibleId: hit.id } : null;
}

export class ApiBibleProvider implements ScriptureProvider {
  readonly translations: readonly TranslationMeta[];

  constructor(
    private readonly opts: {
      apiKey: string;
      bibleId: string;
      translation: TranslationMeta;
      fetch?: FetchLike;
      baseUrl?: string;
    },
  ) {
    this.translations = [opts.translation];
  }

  async fetchPassage(references: ParsedReference[], _translationId: string): Promise<ScripturePassage> {
    const verses: ScriptureVerse[] = [];
    const usageTokens: string[] = [];
    let attribution = this.opts.translation.copyright;

    for (const ref of references) {
      for (const r of ref.ranges) {
        if (r.chapter === r.endChapter && r.endVerse - r.startVerse + 1 > MAX_VERSES_PER_REQUEST) {
          throw new ScriptureProviderError(
            "out_of_range",
            `Passage too long — API.Bible allows at most ${MAX_VERSES_PER_REQUEST} verses at a time`,
          );
        }
        const body = (await apiBibleGet(
          this.opts.apiKey,
          `/bibles/${this.opts.bibleId}/passages/${passageId(ref.book, r)}?${PASSAGE_QUERY}`,
          this.opts.fetch,
          this.opts.baseUrl,
        )) as { data?: { content?: string; copyright?: string }; meta?: { fumsToken?: string } };
        verses.push(...parseApiBibleText(body.data?.content ?? "", ref.book, r.chapter));
        if (body.data?.copyright) attribution = body.data.copyright;
        if (body.meta?.fumsToken) usageTokens.push(body.meta.fumsToken);
      }
    }

    return { verses, attribution, source: { provider: "api.bible", bibleId: this.opts.bibleId, usageTokens } };
  }
}
