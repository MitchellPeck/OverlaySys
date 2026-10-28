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
  init?: { headers?: Record<string, string>; signal?: AbortSignal },
) => Promise<{ status: number; ok: boolean; json(): Promise<unknown> }>;

export const API_BIBLE_BASE_URL = "https://rest.api.bible/v1";

const PASSAGE_QUERY =
  "content-type=text&include-notes=false&include-titles=false&include-chapter-numbers=false&include-verse-numbers=true&include-verse-spans=false&fums-version=3";

const MAX_VERSES_PER_REQUEST = 200;

/** A request that hasn't answered by now is treated as offline (hung Wi-Fi, proxies). */
export const API_BIBLE_TIMEOUT_MS = 8_000;

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
  timeoutMs: number = API_BIBLE_TIMEOUT_MS,
): Promise<unknown> {
  const offline = () => new ScriptureProviderError("offline", "Couldn't reach API.Bible");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await (fetchImpl ?? defaultFetch())(`${baseUrl}${path}`, {
      headers: { "api-key": apiKey },
      signal: controller.signal,
    });
  } catch (e) {
    if (e instanceof ScriptureProviderError) throw e;
    throw offline();
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401 || res.status === 403) {
    throw new ScriptureProviderError("rejected", "API.Bible key rejected — check Settings");
  }
  if (res.status === 400 || res.status === 404) {
    throw new ScriptureProviderError("out_of_range", "That passage isn't available in this translation");
  }
  if (!res.ok) throw new ScriptureProviderError("upstream", `API.Bible error ${res.status}`);
  try {
    return await res.json();
  } catch {
    // A 200 that isn't JSON is almost always a captive portal or proxy page.
    throw offline();
  }
}

/** A Bible the API.Bible key can read, as listed by `GET /bibles`. */
export interface ApiBibleSummary {
  bibleId: string;
  /** API.Bible's local abbreviation ("NIV", "ESV", "RVR1960"). */
  abbreviation: string;
  name: string;
  /** ISO 639-3 language id from API.Bible ("eng", "spa"). */
  language: string;
  languageName?: string;
}

/** Every Bible the key licenses, sorted by language then name. */
export async function listApiBibles(apiKey: string, fetchImpl?: FetchLike): Promise<ApiBibleSummary[]> {
  const body = (await apiBibleGet(apiKey, "/bibles", fetchImpl)) as {
    data?: {
      id?: string;
      abbreviation?: string;
      abbreviationLocal?: string;
      name?: string;
      nameLocal?: string;
      language?: { id?: string; name?: string };
    }[];
  } | null;
  const list = Array.isArray(body?.data) ? body.data : [];
  return list
    .filter((b) => typeof b.id === "string" && b.id)
    .map((b) => ({
      bibleId: b.id!,
      abbreviation: (b.abbreviationLocal || b.abbreviation || b.id!).trim(),
      name: (b.name || b.nameLocal || b.abbreviationLocal || b.id!).trim(),
      language: b.language?.id ?? "",
      ...(b.language?.name ? { languageName: b.language.name } : {}),
    }))
    .sort((a, b) => a.language.localeCompare(b.language) || a.name.localeCompare(b.name));
}

/**
 * Translation id for an API.Bible Bible. NIV keeps its historic id "NIV" so
 * saved rows keep resolving; anything else uses its abbreviation unless that
 * collides with an id already taken (e.g. a bundled KJV), then a suffixed one.
 */
export function apiBibleTranslationId(abbreviation: string, taken: ReadonlySet<string>): string {
  const base = abbreviation.trim().toUpperCase().replace(/\s+/g, "-") || "BIBLE";
  if (!taken.has(base)) return base;
  let id = `${base}-API`;
  for (let n = 2; taken.has(id); n++) id = `${base}-API${n}`;
  return id;
}

/** TranslationMeta for a licensed (non-NIV) API.Bible Bible. */
export function apiBibleTranslationMeta(b: ApiBibleSummary, id: string): TranslationMeta {
  return {
    id,
    name: b.name,
    abbreviation: b.abbreviation,
    language: b.language,
    // Real attribution arrives with each passage (data.copyright).
    copyright: `${b.name} (via API.Bible)`,
    isPublicDomain: false,
  };
}

export async function findNivBible(apiKey: string, fetchImpl?: FetchLike): Promise<{ bibleId: string } | null> {
  const body = (await apiBibleGet(apiKey, "/bibles?abbreviation=NIV", fetchImpl)) as {
    data?: { id: string; abbreviation?: string; abbreviationLocal?: string }[];
  } | null;
  const list = Array.isArray(body?.data) ? body.data : [];
  const hit =
    list.find((b) => b.abbreviationLocal === "NIV") ?? list.find((b) => (b.abbreviation ?? "").startsWith("NIV"));
  return hit ? { bibleId: hit.id } : null;
}

export interface ApiBibleEntry {
  bibleId: string;
  translation: TranslationMeta;
}

type ApiBibleProviderOpts = {
  apiKey: string;
  fetch?: FetchLike;
  baseUrl?: string;
} & (
  | { bibleId: string; translation: TranslationMeta }
  | { bibles: readonly ApiBibleEntry[] }
);

/**
 * Serves one or more API.Bible translations through one key. The
 * single-Bible form ({ bibleId, translation }) is the original NIV-only
 * shape and still answers any translation id with that Bible.
 */
export class ApiBibleProvider implements ScriptureProvider {
  readonly translations: readonly TranslationMeta[];
  private readonly bibles: readonly ApiBibleEntry[];
  private readonly single: boolean;

  constructor(private readonly opts: ApiBibleProviderOpts) {
    this.single = "bibleId" in opts;
    this.bibles = "bibleId" in opts ? [{ bibleId: opts.bibleId, translation: opts.translation }] : [...opts.bibles];
    this.translations = this.bibles.map((b) => b.translation);
  }

  async fetchPassage(references: ParsedReference[], translationId: string): Promise<ScripturePassage> {
    const entry = this.single ? this.bibles[0] : this.bibles.find((b) => b.translation.id === translationId);
    if (!entry) {
      throw new ScriptureProviderError("out_of_range", `${translationId} isn't enabled for this API.Bible key`);
    }
    const bibleId = entry.bibleId;
    const verses: ScriptureVerse[] = [];
    const usageTokens: string[] = [];
    let attribution = entry.translation.copyright;

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
          `/bibles/${bibleId}/passages/${passageId(ref.book, r)}?${PASSAGE_QUERY}`,
          this.opts.fetch,
          this.opts.baseUrl,
        )) as { data?: { content?: string; copyright?: string }; meta?: { fumsToken?: string } };
        verses.push(...parseApiBibleText(body.data?.content ?? "", ref.book, r.chapter));
        if (body.data?.copyright) attribution = body.data.copyright;
        if (body.meta?.fumsToken) usageTokens.push(body.meta.fumsToken);
      }
    }

    return { verses, attribution, source: { provider: "api.bible", bibleId, usageTokens } };
  }
}
