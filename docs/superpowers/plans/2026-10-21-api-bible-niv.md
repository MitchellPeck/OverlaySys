# NIV via API.Bible Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Operators can import NIV scripture through the church's API.Bible key, with usage reporting (FUMS) and a 14-day background refresh of stored text.

**Architecture:** A network-backed `ApiBibleProvider` in `@overlaysys/scripture` plugs into the existing `ProviderRegistry` next to KJV/WEB. The server owns the key (env or `<dataRoot>/settings/api-bible.json`), registers NIV when the key resolves, reports FUMS views over HTTP, and runs a daily refresh job over saved shows. Rows record their source in a new optional `ScriptureRow.source` field.

**Tech Stack:** TypeScript, Fastify (server), zod (core schemas), React/Next (operator), vitest (root config, Node environment).

**Spec:** `docs/superpowers/specs/2026-10-21-api-bible-niv-design.md`

## Global Constraints

- Base URL `https://rest.api.bible/v1`; auth header `api-key: <key>`.
- Passage query string, verbatim: `content-type=text&include-notes=false&include-titles=false&include-chapter-numbers=false&include-verse-numbers=true&include-verse-spans=false&fums-version=3`
- NIV match: `abbreviationLocal === "NIV"`, fallback `abbreviation` starting with `NIV`.
- Translation id/abbreviation exposed to the app: `"NIV"`.
- Key priority: env `OVERLAYSYS_API_BIBLE_KEY` > `<dataRoot>/settings/api-bible.json` (`{ "apiKey": "..." }`, mode `0600`). The key is never returned by any route or logged.
- FUMS: `GET https://fums.api.bible/f3?t=<token>[&t=…]&dId=<deviceId>&sId=<sessionId>`; device id persisted at `<dataRoot>/settings/api-bible-device.json`; fire-and-forget, never throws.
- Refresh: rows older than 14 days; job at startup + every 24 h; never concurrent.
- Max 200 verses per API request.
- Operator copy, verbatim: `Couldn't reach API.Bible`, `API.Bible key rejected — check Settings`, `NIV found ✓`, `Key rejected`, `Key works but no NIV`, `Can't reach API.Bible`, `No key set`, `Set by environment (OVERLAYSYS_API_BIBLE_KEY)`.
- Work happens on a branch cut from `feat/scripture-slide-splitting` (uses `slidesToBreaks`, `breaksToSlides`, `tokenize`).
- Stage only the files named in each task (`git add <paths>`), never `git add -A`.
- Run tests from the worktree root: `pnpm vitest run <path>`.

## Review Focus

1. **Server starts offline, network returns later** — NIV should become available without a restart. Pinned in Task 4 (`ensureApiBible` retries after 60 s when state is `offline`).
2. **Key removed while NIV rows exist** — rows still render and take; refresh skips them quietly. Pinned in Task 5 (no provider → 0 refreshed, rows untouched).
3. **Refresh returns a different number of words** — slide breaks clamp into range, no empty slides, slide ids stay unique. Pinned in Task 5.
4. **Usage reporting while offline / FUMS down** — take still succeeds; nothing thrown. Pinned in Task 3.
5. **Key leaks** — status JSON and PUT/DELETE responses never contain the key. Pinned in Task 4.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/scripture/src/types.ts` (modify) | `ScripturePassageSource`, `ScripturePassage.source`, `ScriptureProviderError` |
| `packages/scripture/src/providers/apiBible.ts` (create) | HTTP client, text parser, NIV lookup, provider |
| `packages/scripture/src/providers/apiBible.test.ts` (create) | Offline tests with recorded responses |
| `packages/scripture/src/providers/registry.ts` (modify) | `unregister()` |
| `packages/scripture/src/index.ts` (modify) | export apiBible |
| `packages/core/src/show.ts` (modify) | `ScriptureRow.source` |
| `server/src/apiBible/fums.ts` (create) | FUMS HTTP reporting |
| `server/src/apiBible/config.ts` (create) | Key storage, status, NIV registration |
| `server/src/apiBible/routes.ts` (create) | Status / key / usage routes |
| `server/src/apiBible/refresh.ts` (create) | Stale-row refresh (pure core + runner) |
| `server/src/scripture.ts` (modify) | `getScriptureRegistry()`, provider-error mapping, `source` + FUMS on passage |
| `server/src/index.ts` (modify) | wiring |
| `apps/operator/src/lib/scriptureClient.ts` (modify) | `source` type, API.Bible + usage calls |
| `apps/operator/src/app/shows/edit/page.tsx` (modify) | copy `source` onto new rows |
| `apps/operator/src/app/components/ScriptureTakeStrip.tsx` (modify) | report usage on take |
| `apps/operator/src/app/settings/scripture/page.tsx` (create) | API.Bible settings panel |
| `apps/operator/src/app/shell/areas.ts` (modify) | nav entry |

---

### Task 1: API.Bible provider in `@overlaysys/scripture`

**Files:**
- Modify: `packages/scripture/src/types.ts`, `packages/scripture/src/providers/registry.ts`, `packages/scripture/src/index.ts`
- Create: `packages/scripture/src/providers/apiBible.ts`
- Test: `packages/scripture/src/providers/apiBible.test.ts`, `packages/scripture/src/providers/registry.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // types.ts
  export interface ScripturePassageSource { provider: "api.bible"; bibleId: string; usageTokens: string[] }
  export interface ScripturePassage { verses: ScriptureVerse[]; attribution: string; source?: ScripturePassageSource }
  export type ScriptureProviderErrorCode = "offline" | "rejected" | "out_of_range" | "upstream";
  export class ScriptureProviderError extends Error { code: ScriptureProviderErrorCode }
  // apiBible.ts
  export type FetchLike = (url: string, init?: { headers?: Record<string, string> }) =>
    Promise<{ status: number; ok: boolean; json(): Promise<unknown> }>;
  export const API_BIBLE_BASE_URL: string;
  export const NIV_TRANSLATION: TranslationMeta;          // id "NIV"
  export function passageId(book: string, r: RefRange): string;
  export function parseApiBibleText(content: string, book: string, startChapter: number): ScriptureVerse[];
  export function apiBibleGet(apiKey: string, path: string, fetchImpl?: FetchLike, baseUrl?: string): Promise<unknown>;
  export function findNivBible(apiKey: string, fetchImpl?: FetchLike): Promise<{ bibleId: string } | null>;
  export class ApiBibleProvider implements ScriptureProvider {
    constructor(opts: { apiKey: string; bibleId: string; translation: TranslationMeta; fetch?: FetchLike; baseUrl?: string });
  }
  // registry.ts
  ProviderRegistry.unregister(provider: ScriptureProvider): void
  ```

- [ ] **Step 1: Write the failing tests** — `packages/scripture/src/providers/apiBible.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  ApiBibleProvider, NIV_TRANSLATION, findNivBible, parseApiBibleText, passageId, type FetchLike,
} from "./apiBible";
import { ScriptureProviderError } from "../types";
import { parseReference } from "../reference";

// Recorded from rest.api.bible on 2026-10-21 (content trimmed to what the tests need).
const JHN_3_16_17 =
  "     [16] For God so loved the world that he gave his one and only Son, that whoever believes in him shall not perish but have eternal life.  [17] For God did not send his Son into the world to condemn the world, but to save the world through him.\n";
const JHN_3_36_4_2 =
  "     [36] Whoever believes in the Son has eternal life, but whoever rejects the Son will not see life, for God’s wrath remains on them.\n     [1] Now Jesus learned that the Pharisees had heard that he was gaining and baptizing more disciples than John—  [2] although in fact it was not Jesus who baptized, but his disciples. \n";
const PSA_23_1_3 =
  "    Psalm 23\n   [1] The Lord is my shepherd, I lack nothing.\n     [2] He makes me lie down in green pastures,\n  he leads me beside quiet waters,\n     [3] he refreshes my soul.\n  He guides me along the right paths\n    for his name’s sake.\n";
const COPYRIGHT = "The Holy Bible, New International Version® NIV® Copyright © 1973, 1978, 1984, 2011 by Biblica, Inc.® Used by Permission of Biblica, Inc.® All rights reserved worldwide.";

function fakeFetch(routes: Record<string, { status?: number; body?: unknown } | Error>) {
  const calls: { url: string; headers?: Record<string, string> }[] = [];
  const f: FetchLike = async (url, init) => {
    calls.push({ url, headers: init?.headers });
    const key = Object.keys(routes).find((k) => url.includes(k));
    const r = key ? routes[key]! : { status: 404, body: {} };
    if (r instanceof Error) throw r;
    const status = r.status ?? 200;
    return { status, ok: status >= 200 && status < 300, json: async () => r.body };
  };
  return { f, calls };
}

const passageBody = (content: string, token: string) => ({
  data: { content, copyright: COPYRIGHT },
  meta: { fumsToken: token },
});

describe("parseApiBibleText", () => {
  it("splits on [n] markers and collapses whitespace", () => {
    const v = parseApiBibleText(JHN_3_16_17, "JHN", 3);
    expect(v.map((x) => [x.chapter, x.verse])).toEqual([[3, 16], [3, 17]]);
    expect(v[0]!.text).toBe("For God so loved the world that he gave his one and only Son, that whoever believes in him shall not perish but have eternal life.");
  });

  it("advances the chapter when verse numbers restart", () => {
    const v = parseApiBibleText(JHN_3_36_4_2, "JHN", 3);
    expect(v.map((x) => `${x.chapter}:${x.verse}`)).toEqual(["3:36", "4:1", "4:2"]);
  });

  it("ignores headings before the first marker and joins poetry lines", () => {
    const v = parseApiBibleText(PSA_23_1_3, "PSA", 23);
    expect(v[0]!.text).toBe("The Lord is my shepherd, I lack nothing.");
    expect(v[1]!.text).toBe("He makes me lie down in green pastures, he leads me beside quiet waters,");
    expect(v).toHaveLength(3);
  });
});

describe("passageId", () => {
  it("formats single- and cross-chapter ranges", () => {
    expect(passageId("JHN", { chapter: 3, startVerse: 16, endChapter: 3, endVerse: 21 })).toBe("JHN.3.16-JHN.3.21");
    expect(passageId("JHN", { chapter: 3, startVerse: 36, endChapter: 4, endVerse: 2 })).toBe("JHN.3.36-JHN.4.2");
  });
});

describe("findNivBible", () => {
  it("matches abbreviationLocal NIV and sends the api-key header", async () => {
    const { f, calls } = fakeFetch({
      "/bibles?abbreviation=NIV": {
        body: { data: [{ id: "78a9f6124f344018-01", abbreviation: "NIV11", abbreviationLocal: "NIV" }] },
      },
    });
    expect(await findNivBible("k", f)).toEqual({ bibleId: "78a9f6124f344018-01" });
    expect(calls[0]!.headers).toEqual({ "api-key": "k" });
    expect(calls[0]!.url).toBe("https://rest.api.bible/v1/bibles?abbreviation=NIV");
  });

  it("returns null when no NIV is available", async () => {
    const { f } = fakeFetch({ "/bibles?abbreviation=NIV": { body: { data: [] } } });
    expect(await findNivBible("k", f)).toBeNull();
  });

  it("throws rejected on 401 and offline when fetch throws", async () => {
    const rejected = fakeFetch({ "/bibles": { status: 401, body: {} } });
    await expect(findNivBible("k", rejected.f)).rejects.toMatchObject({ code: "rejected" });
    const offline = fakeFetch({ "/bibles": new TypeError("fetch failed") });
    const err = await findNivBible("k", offline.f).catch((e) => e);
    expect(err).toBeInstanceOf(ScriptureProviderError);
    expect(err.code).toBe("offline");
    expect(err.message).toBe("Couldn't reach API.Bible");
  });
});

describe("ApiBibleProvider", () => {
  const make = (routes: Parameters<typeof fakeFetch>[0]) => {
    const ff = fakeFetch(routes);
    return { ...ff, p: new ApiBibleProvider({ apiKey: "k", bibleId: "B", translation: NIV_TRANSLATION, fetch: ff.f }) };
  };

  it("fetches a passage with the required query and returns source + attribution", async () => {
    const { p, calls } = make({ "/passages/JHN.3.16-JHN.3.17": { body: passageBody(JHN_3_16_17, "tok1") } });
    const out = await p.fetchPassage(parseReference("John 3:16-17"), "NIV");
    expect(out.verses).toHaveLength(2);
    expect(out.attribution).toBe(COPYRIGHT);
    expect(out.source).toEqual({ provider: "api.bible", bibleId: "B", usageTokens: ["tok1"] });
    expect(calls[0]!.url).toBe(
      "https://rest.api.bible/v1/bibles/B/passages/JHN.3.16-JHN.3.17?content-type=text&include-notes=false&include-titles=false&include-chapter-numbers=false&include-verse-numbers=true&include-verse-spans=false&fums-version=3",
    );
  });

  it("collects one token per range for multi-range references", async () => {
    const { p } = make({
      "/passages/JHN.3.16-JHN.3.17": { body: passageBody(JHN_3_16_17, "a") },
      "/passages/JHN.3.36-JHN.4.2": { body: passageBody(JHN_3_36_4_2, "b") },
    });
    const out = await p.fetchPassage(parseReference("John 3:16-17, 3:36-4:2"), "NIV");
    expect(out.source!.usageTokens).toEqual(["a", "b"]);
    expect(out.verses.map((v) => `${v.chapter}:${v.verse}`)).toEqual(["3:16", "3:17", "3:36", "4:1", "4:2"]);
  });

  it("maps 404 to out_of_range and rejects >200-verse single-chapter ranges without a request", async () => {
    const { p, calls } = make({});
    await expect(p.fetchPassage(parseReference("John 3:16-17"), "NIV")).rejects.toMatchObject({ code: "out_of_range" });
    expect(calls).toHaveLength(1);
    await expect(
      p.fetchPassage([{ book: "PSA", ranges: [{ chapter: 119, startVerse: 1, endChapter: 119, endVerse: 201 }] }], "NIV"),
    ).rejects.toMatchObject({ code: "out_of_range" });
    expect(calls).toHaveLength(1);
  });
});
```

And append to `packages/scripture/src/providers/registry.test.ts` (inside the file, after existing tests; reuse its imports, adding `type ScriptureProvider` from `../types` if not imported):

```ts
describe("ProviderRegistry.unregister", () => {
  it("removes a provider's translations", () => {
    const r = new ProviderRegistry();
    const p: ScriptureProvider = {
      translations: [{ id: "X", name: "X", abbreviation: "X", language: "en", copyright: "", isPublicDomain: true }],
      fetchPassage: async () => ({ verses: [], attribution: "" }),
    };
    r.register(p);
    r.unregister(p);
    expect(r.providerFor("X")).toBeNull();
    expect(r.listTranslations()).toEqual([]);
    r.register(p); // re-registering after unregister must not throw
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run packages/scripture/src/providers`
Expected: FAIL — cannot resolve `./apiBible`; `unregister is not a function`.

- [ ] **Step 3: Implement types** — append to `packages/scripture/src/types.ts`, and change `ScripturePassage` to:

```ts
/** Where a passage came from, when it isn't bundled. Copied onto saved rows. */
export interface ScripturePassageSource {
  provider: "api.bible";
  bibleId: string;
  /** API.Bible FUMS tokens — one per request that produced this passage. */
  usageTokens: string[];
}

/** Provider response for one or more parsed references. */
export interface ScripturePassage {
  verses: ScriptureVerse[];
  /** License/attribution text. Pinned into the row at fetch time. */
  attribution: string;
  source?: ScripturePassageSource;
}

export type ScriptureProviderErrorCode = "offline" | "rejected" | "out_of_range" | "upstream";

/** Thrown by network-backed providers; `message` is operator-facing. */
export class ScriptureProviderError extends Error {
  code: ScriptureProviderErrorCode;

  constructor(code: ScriptureProviderErrorCode, message: string) {
    super(message);
    this.name = "ScriptureProviderError";
    this.code = code;
  }
}
```

- [ ] **Step 4: Implement `unregister`** — in `registry.ts` add:

```ts
  unregister(provider: ScriptureProvider): void {
    const idx = this.providers.indexOf(provider);
    if (idx < 0) return;
    this.providers.splice(idx, 1);
    for (const t of provider.translations) {
      if (this.byTranslation.get(t.id) === provider) this.byTranslation.delete(t.id);
    }
  }
```

- [ ] **Step 5: Implement the provider** — `packages/scripture/src/providers/apiBible.ts`:

```ts
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
```

Add to `packages/scripture/src/index.ts`: `export * from "./providers/apiBible";`

- [ ] **Step 6: Run to verify pass**

Run: `pnpm vitest run packages/scripture`
Expected: all PASS.

- [ ] **Step 7: Typecheck and commit**

Run: `pnpm --filter @overlaysys/scripture typecheck`
Expected: clean.

```bash
git add packages/scripture/src/types.ts packages/scripture/src/providers/apiBible.ts packages/scripture/src/providers/apiBible.test.ts packages/scripture/src/providers/registry.ts packages/scripture/src/providers/registry.test.ts packages/scripture/src/index.ts
git commit -m "feat(scripture): API.Bible provider for NIV"
```

---

### Task 2: `ScriptureRow.source` in core

**Files:**
- Modify: `packages/core/src/show.ts` (`ScriptureRowSchema`, ~line 113)
- Test: `packages/core/src/show.test.ts` (inside `describe("ScriptureRowSchema", …)`, ~line 227)

**Interfaces:**
- Produces: `ScriptureRow["source"]` = `{ provider: "api.bible"; bibleId: string; fetchedAt: string; usageTokens: string[] } | undefined`

- [ ] **Step 1: Write the failing tests** — add inside `describe("ScriptureRowSchema", …)`:

```ts
  const base = {
    kind: "scripture" as const,
    id: "s1",
    reference: "John 3:16",
    translation: "NIV",
    slides: [{ id: "slide-0", verses: [{ book: "JHN", chapter: 3, verse: 16, text: "For God" }] }],
    templateId: "t",
  };

  it("accepts an api.bible source", () => {
    const row = ScriptureRowSchema.parse({
      ...base,
      source: { provider: "api.bible", bibleId: "B", fetchedAt: "2026-10-21T00:00:00.000Z", usageTokens: ["t1"] },
    });
    expect(row.source?.bibleId).toBe("B");
  });

  it("defaults usageTokens and leaves source optional", () => {
    const row = ScriptureRowSchema.parse({
      ...base,
      source: { provider: "api.bible", bibleId: "B", fetchedAt: "2026-10-21T00:00:00.000Z" },
    });
    expect(row.source?.usageTokens).toEqual([]);
    expect(ScriptureRowSchema.parse(base).source).toBeUndefined();
  });

  it("rejects unknown providers", () => {
    expect(() =>
      ScriptureRowSchema.parse({ ...base, source: { provider: "other", bibleId: "B", fetchedAt: "x" } }),
    ).toThrow();
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run packages/core/src/show.test.ts`
Expected: FAIL — `row.source` undefined (zod strips unknown keys) and "rejects unknown providers" doesn't throw.

- [ ] **Step 3: Implement** — in `ScriptureRowSchema` after `sourceRef: RowSourceRefSchema.optional(),` add:

```ts
  /**
   * Set for rows fetched from a licensed API (NIV via API.Bible). The server
   * refreshes such rows' text every 14 days and reports usage with the tokens.
   */
  source: z
    .object({
      provider: z.literal("api.bible"),
      bibleId: z.string(),
      fetchedAt: z.string(),
      usageTokens: z.array(z.string()).default([]),
    })
    .optional(),
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run packages/core`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/show.ts packages/core/src/show.test.ts
git commit -m "feat(core): optional api.bible source on scripture rows"
```

---

### Task 3: FUMS usage reporting

**Files:**
- Create: `server/src/apiBible/fums.ts`
- Test: `server/src/apiBible/fums.test.ts`

**Interfaces:**
- Consumes: `dataRoot()` from `server/src/storage.ts`.
- Produces:
  ```ts
  export function fumsUrl(tokens: string[], deviceId: string, sessionId: string): string
  export function reportViews(tokens: string[]): Promise<void>   // never rejects
  export function _setFumsFetchForTest(f: ((url: string) => Promise<unknown>) | null): void
  export function _resetFumsForTest(): void
  ```

- [ ] **Step 1: Write the failing tests** — `server/src/apiBible/fums.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { _resetFumsForTest, _setFumsFetchForTest, fumsUrl, reportViews } from "./fums";

let tmp: string;
let prev: string | undefined;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "overlaysys-fums-"));
  prev = process.env["OVERLAYSYS_DATA_DIR"];
  process.env["OVERLAYSYS_DATA_DIR"] = tmp;
  _resetFumsForTest();
});
afterEach(async () => {
  _setFumsFetchForTest(null);
  if (prev === undefined) delete process.env["OVERLAYSYS_DATA_DIR"];
  else process.env["OVERLAYSYS_DATA_DIR"] = prev;
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("fums", () => {
  it("builds the f3 URL with repeated t params", () => {
    expect(fumsUrl(["a", "b"], "dev", "ses")).toBe("https://fums.api.bible/f3?t=a&t=b&dId=dev&sId=ses");
  });

  it("reports with a device id that persists across calls and restarts", async () => {
    const urls: string[] = [];
    _setFumsFetchForTest(async (u) => { urls.push(u); return {}; });
    await reportViews(["a"]);
    _resetFumsForTest(); // simulate restart: cache cleared, file remains
    await reportViews(["b"]);
    const dId = (u: string) => new URL(u).searchParams.get("dId");
    expect(urls).toHaveLength(2);
    expect(dId(urls[0]!)).toBeTruthy();
    expect(dId(urls[0]!)).toBe(dId(urls[1]!));
    const saved = JSON.parse(await fs.readFile(path.join(tmp, "settings", "api-bible-device.json"), "utf8"));
    expect(saved.deviceId).toBe(dId(urls[0]!));
  });

  it("does nothing for no tokens and swallows network errors", async () => {
    let calls = 0;
    _setFumsFetchForTest(async () => { calls++; throw new TypeError("fetch failed"); });
    await reportViews([]);
    expect(calls).toBe(0);
    await expect(reportViews(["a"])).resolves.toBeUndefined();
    expect(calls).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run server/src/apiBible/fums.test.ts`
Expected: FAIL — cannot resolve `./fums`.

- [ ] **Step 3: Implement** — `server/src/apiBible/fums.ts`:

```ts
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { dataRoot } from "../storage";

// API.Bible Fair Use Management System. Every display of API.Bible text must
// be reported; the HTTP endpoint is their documented non-browser path.
// Device id is anonymous and persisted; session id is per server process.

const FUMS_URL = "https://fums.api.bible/f3";
const sessionId = randomUUID();
let deviceIdCache: string | null = null;
let fetchOverride: ((url: string) => Promise<unknown>) | null = null;

const deviceFile = () => path.join(dataRoot(), "settings", "api-bible-device.json");

async function deviceId(): Promise<string> {
  if (deviceIdCache) return deviceIdCache;
  try {
    const saved = JSON.parse(await fs.readFile(deviceFile(), "utf8")) as { deviceId?: unknown };
    if (typeof saved.deviceId === "string" && saved.deviceId) return (deviceIdCache = saved.deviceId);
  } catch {
    // first run — create below
  }
  const id = randomUUID();
  await fs.mkdir(path.dirname(deviceFile()), { recursive: true });
  await fs.writeFile(deviceFile(), JSON.stringify({ deviceId: id }));
  return (deviceIdCache = id);
}

export function fumsUrl(tokens: string[], dId: string, sId: string): string {
  const q = new URLSearchParams();
  for (const t of tokens) q.append("t", t);
  q.set("dId", dId);
  q.set("sId", sId);
  return `${FUMS_URL}?${q.toString()}`;
}

/** Report one view per token. Never rejects — usage reporting must not break a take. */
export async function reportViews(tokens: string[]): Promise<void> {
  if (tokens.length === 0) return;
  try {
    const url = fumsUrl(tokens, await deviceId(), sessionId);
    await (fetchOverride ?? ((u: string) => fetch(u)))(url);
  } catch (e) {
    console.debug("[api-bible] FUMS report failed", e instanceof Error ? e.message : e);
  }
}

/** @internal */
export function _setFumsFetchForTest(f: ((url: string) => Promise<unknown>) | null): void {
  fetchOverride = f;
}

/** @internal */
export function _resetFumsForTest(): void {
  deviceIdCache = null;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run server/src/apiBible/fums.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/apiBible/fums.ts server/src/apiBible/fums.test.ts
git commit -m "feat(server): API.Bible FUMS usage reporting"
```

---

### Task 4: Key config, NIV registration, and routes

**Files:**
- Create: `server/src/apiBible/config.ts`, `server/src/apiBible/routes.ts`
- Modify: `server/src/scripture.ts`
- Test: `server/src/apiBible/config.test.ts`, `server/src/scripture.test.ts` (existing tests must still pass)

**Interfaces:**
- Consumes: Task 1 (`ApiBibleProvider`, `findNivBible`, `NIV_TRANSLATION`, `ScriptureProviderError`, `FetchLike`, `ProviderRegistry.unregister`), Task 3 (`reportViews`).
- Produces:
  ```ts
  // scripture.ts
  export function getScriptureRegistry(): ProviderRegistry
  // config.ts
  export type ApiBibleState = "ok" | "no_key" | "rejected" | "no_niv" | "offline";
  export interface ApiBibleStatus { configured: boolean; source: "env" | "file" | null; state: ApiBibleState; bibleId?: string }
  export function initApiBible(): Promise<ApiBibleStatus>
  export function ensureApiBible(now?: number): Promise<void>   // retries init when offline, at most once per 60 s
  export function getApiBibleStatus(): ApiBibleStatus
  export function getApiBibleProvider(): ApiBibleProvider | null
  export function setApiBibleKey(key: string): Promise<ApiBibleStatus | "env">
  export function clearApiBibleKey(): Promise<ApiBibleStatus | "env">
  export function _setApiBibleFetchForTest(f: FetchLike | undefined): void
  // routes.ts
  export function registerApiBibleRoutes(app: FastifyInstance): Promise<void>
  // GET/PUT/DELETE /api/scripture/api-bible, POST /api/scripture/usage
  ```

- [ ] **Step 1: Write the failing tests** — `server/src/apiBible/config.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Fastify from "fastify";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FetchLike } from "@overlaysys/scripture";
import { initScripture, registerScriptureRoutes, getScriptureRegistry } from "../scripture";
import { _setApiBibleFetchForTest, ensureApiBible, getApiBibleStatus, initApiBible } from "./config";
import { registerApiBibleRoutes } from "./routes";
import { _setFumsFetchForTest } from "./fums";

const KEY = "secret-key-123";
let tmp: string;
let prevDir: string | undefined;
let prevKey: string | undefined;
let mode: "ok" | "rejected" | "offline" | "no_niv" = "ok";
const fumsCalls: string[] = [];

const fake: FetchLike = async (url, init) => {
  if (mode === "offline") throw new TypeError("fetch failed");
  if (mode === "rejected" || init?.headers?.["api-key"] !== KEY) return { status: 401, ok: false, json: async () => ({}) };
  if (url.includes("/bibles?abbreviation=NIV")) {
    const data = mode === "no_niv" ? [] : [{ id: "B", abbreviation: "NIV11", abbreviationLocal: "NIV" }];
    return { status: 200, ok: true, json: async () => ({ data }) };
  }
  if (url.includes("/passages/JHN.3.16-JHN.3.16")) {
    return { status: 200, ok: true, json: async () => ({ data: { content: "[16] For God so loved the world", copyright: "©" }, meta: { fumsToken: "tok" } }) };
  }
  return { status: 404, ok: false, json: async () => ({}) };
};

async function app() {
  const a = Fastify();
  await registerScriptureRoutes(a);
  await registerApiBibleRoutes(a);
  await a.ready();
  return a;
}

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "overlaysys-apibible-"));
  prevDir = process.env["OVERLAYSYS_DATA_DIR"];
  prevKey = process.env["OVERLAYSYS_API_BIBLE_KEY"];
  process.env["OVERLAYSYS_DATA_DIR"] = tmp;
  delete process.env["OVERLAYSYS_API_BIBLE_KEY"];
  mode = "ok";
  fumsCalls.length = 0;
  _setApiBibleFetchForTest(fake);
  _setFumsFetchForTest(async (u) => { fumsCalls.push(u); return {}; });
  await initScripture();
  await initApiBible();
});
afterEach(async () => {
  _setApiBibleFetchForTest(undefined);
  _setFumsFetchForTest(null);
  if (prevDir === undefined) delete process.env["OVERLAYSYS_DATA_DIR"]; else process.env["OVERLAYSYS_DATA_DIR"] = prevDir;
  if (prevKey === undefined) delete process.env["OVERLAYSYS_API_BIBLE_KEY"]; else process.env["OVERLAYSYS_API_BIBLE_KEY"] = prevKey;
  await fs.rm(tmp, { recursive: true, force: true });
});

describe("API.Bible config", () => {
  it("starts with no key and no NIV", async () => {
    expect(getApiBibleStatus()).toEqual({ configured: false, source: null, state: "no_key" });
    expect(getScriptureRegistry().providerFor("NIV")).toBeNull();
  });

  it("PUT a good key saves it 0600, registers NIV, never echoes the key", async () => {
    const a = await app();
    const res = await a.inject({ method: "PUT", url: "/api/scripture/api-bible", payload: { apiKey: KEY } });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(KEY);
    expect(res.json()).toMatchObject({ configured: true, source: "file", state: "ok", bibleId: "B" });
    const file = path.join(tmp, "settings", "api-bible.json");
    expect(JSON.parse(await fs.readFile(file, "utf8"))).toEqual({ apiKey: KEY });
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    const t = await a.inject({ method: "GET", url: "/api/scripture/translations" });
    expect(t.json().translations.map((x: { id: string }) => x.id)).toContain("NIV");
    const status = await a.inject({ method: "GET", url: "/api/scripture/api-bible" });
    expect(status.body).not.toContain(KEY);
    await a.close();
  });

  it("PUT a rejected key returns 400 and writes nothing", async () => {
    const a = await app();
    const res = await a.inject({ method: "PUT", url: "/api/scripture/api-bible", payload: { apiKey: "wrong" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().state).toBe("rejected");
    await expect(fs.stat(path.join(tmp, "settings", "api-bible.json"))).rejects.toThrow();
    await a.close();
  });

  it("env key wins; PUT/DELETE return 409", async () => {
    process.env["OVERLAYSYS_API_BIBLE_KEY"] = KEY;
    await initApiBible();
    expect(getApiBibleStatus()).toMatchObject({ source: "env", state: "ok" });
    const a = await app();
    expect((await a.inject({ method: "PUT", url: "/api/scripture/api-bible", payload: { apiKey: "x" } })).statusCode).toBe(409);
    expect((await a.inject({ method: "DELETE", url: "/api/scripture/api-bible" })).statusCode).toBe(409);
    await a.close();
  });

  it("DELETE removes the file and NIV", async () => {
    const a = await app();
    await a.inject({ method: "PUT", url: "/api/scripture/api-bible", payload: { apiKey: KEY } });
    const res = await a.inject({ method: "DELETE", url: "/api/scripture/api-bible" });
    expect(res.json()).toMatchObject({ configured: false, state: "no_key" });
    expect(getScriptureRegistry().providerFor("NIV")).toBeNull();
    await a.close();
  });

  it("no NIV on the key → state no_niv, nothing registered", async () => {
    mode = "no_niv";
    const a = await app();
    const res = await a.inject({ method: "PUT", url: "/api/scripture/api-bible", payload: { apiKey: KEY } });
    expect(res.json().state).toBe("no_niv");
    expect(getScriptureRegistry().providerFor("NIV")).toBeNull();
    await a.close();
  });

  it("offline at startup recovers via ensureApiBible after 60 s", async () => {
    await fs.mkdir(path.join(tmp, "settings"), { recursive: true });
    await fs.writeFile(path.join(tmp, "settings", "api-bible.json"), JSON.stringify({ apiKey: KEY }));
    mode = "offline";
    await initApiBible();
    expect(getApiBibleStatus().state).toBe("offline");
    mode = "ok";
    await ensureApiBible(Date.now()); // within 60 s of the failed init → no retry
    expect(getApiBibleStatus().state).toBe("offline");
    await ensureApiBible(Date.now() + 61_000);
    expect(getApiBibleStatus().state).toBe("ok");
  });

  it("passage route returns source + fetchedAt and reports FUMS", async () => {
    const a = await app();
    await a.inject({ method: "PUT", url: "/api/scripture/api-bible", payload: { apiKey: KEY } });
    const res = await a.inject({ method: "GET", url: "/api/scripture/passage?ref=John%203:16&translation=NIV" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.source).toMatchObject({ provider: "api.bible", bibleId: "B", usageTokens: ["tok"] });
    expect(typeof body.source.fetchedAt).toBe("string");
    await new Promise((r) => setTimeout(r, 10));
    expect(fumsCalls.some((u) => u.includes("t=tok"))).toBe(true);
    await a.close();
  });

  it("passage route maps offline to 503 with the operator message", async () => {
    const a = await app();
    await a.inject({ method: "PUT", url: "/api/scripture/api-bible", payload: { apiKey: KEY } });
    mode = "offline";
    const res = await a.inject({ method: "GET", url: "/api/scripture/passage?ref=John%203:16&translation=NIV" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ code: "offline", message: "Couldn't reach API.Bible" });
    await a.close();
  });

  it("POST /api/scripture/usage reports string tokens only", async () => {
    const a = await app();
    const res = await a.inject({ method: "POST", url: "/api/scripture/usage", payload: { tokens: ["x", 5, ""] } });
    expect(res.statusCode).toBe(200);
    await new Promise((r) => setTimeout(r, 10));
    expect(fumsCalls).toHaveLength(1);
    expect(fumsCalls[0]).toContain("t=x");
    expect(fumsCalls[0]).not.toContain("t=5");
    await a.close();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run server/src/apiBible/config.test.ts`
Expected: FAIL — cannot resolve `./config` / `getScriptureRegistry` not exported.

- [ ] **Step 3: Update `server/src/scripture.ts`**
  - Imports: add `ScriptureProviderError` to the `@overlaysys/scripture` import; add `import { reportViews } from "./apiBible/fums";` and `import { ensureApiBible } from "./apiBible/config";`
  - Replace `initScripture` and `_getRegistryForTest` with:

```ts
let registry: ProviderRegistry | null = null;

/** The live registry (bundled translations always present; NIV added by apiBible/config). */
export function getScriptureRegistry(): ProviderRegistry {
  if (!registry) {
    registry = new ProviderRegistry();
    registry.register(new BundledProvider(ALL_BUNDLES));
  }
  return registry;
}

/** Rebuild the registry from scratch (bundled only). Call initApiBible() after to re-add NIV. */
export async function initScripture(): Promise<void> {
  registry = null;
  getScriptureRegistry();
}

/** @internal test access */
export function _getRegistryForTest(): ProviderRegistry {
  return getScriptureRegistry();
}
```

  - In the translations route replace the body with:

```ts
    await ensureApiBible();
    return { translations: getScriptureRegistry().listTranslations() };
```

  - In the passage route remove `if (!registry) await initScripture();`, use `getScriptureRegistry().providerFor(translation)`, and replace the `try { … } catch { … }` around `provider.fetchPassage` with:

```ts
      try {
        const passage = await provider.fetchPassage(parsed, translation);
        if (passage.source) void reportViews(passage.source.usageTokens);
        return {
          reference: formatNormalizedReference(parsed),
          translation,
          verses: passage.verses,
          attribution: passage.attribution,
          ...(passage.source
            ? { source: { ...passage.source, fetchedAt: new Date().toISOString() } }
            : {}),
        };
      } catch (e) {
        if (e instanceof ScriptureProviderError) {
          const status = { offline: 503, rejected: 502, out_of_range: 400, upstream: 502 }[e.code];
          return reply.code(status).send({ code: e.code, message: e.message, hint: e.message });
        }
        const msg = e instanceof Error ? e.message : String(e);
        // Provider errors for chapter/verse not present surface as 400 so
        // the operator sees a typed hint rather than an opaque 500.
        if (/chapter|verse|book/i.test(msg)) {
          return reply.code(400).send({
            code: "out_of_range",
            message: msg,
            hint: msg,
          });
        }
        throw e;
      }
```

- [ ] **Step 4: Implement `server/src/apiBible/config.ts`**

```ts
import fs from "node:fs/promises";
import path from "node:path";
import {
  ApiBibleProvider,
  findNivBible,
  NIV_TRANSLATION,
  ScriptureProviderError,
  type FetchLike,
} from "@overlaysys/scripture";
import { dataRoot } from "../storage";
import { getScriptureRegistry } from "../scripture";

// The church's API.Bible key: env OVERLAYSYS_API_BIBLE_KEY, else a 0600 file
// in the data dir. Resolving the key finds the NIV and registers it next to
// the bundled translations. The key itself never leaves this module.

export type ApiBibleState = "ok" | "no_key" | "rejected" | "no_niv" | "offline";

export interface ApiBibleStatus {
  configured: boolean;
  source: "env" | "file" | null;
  state: ApiBibleState;
  bibleId?: string;
}

const RETRY_MS = 60_000;
const settingsFile = () => path.join(dataRoot(), "settings", "api-bible.json");
const envKey = () => process.env["OVERLAYSYS_API_BIBLE_KEY"]?.trim() || null;

let provider: ApiBibleProvider | null = null;
let status: ApiBibleStatus = { configured: false, source: null, state: "no_key" };
let lastInitAt = 0;
let fetchImpl: FetchLike | undefined;

async function fileKey(): Promise<string | null> {
  try {
    const j = JSON.parse(await fs.readFile(settingsFile(), "utf8")) as { apiKey?: unknown };
    return typeof j.apiKey === "string" && j.apiKey.trim() ? j.apiKey.trim() : null;
  } catch {
    return null;
  }
}

async function probe(key: string): Promise<{ state: ApiBibleState; bibleId?: string }> {
  try {
    const hit = await findNivBible(key, fetchImpl);
    return hit ? { state: "ok", bibleId: hit.bibleId } : { state: "no_niv" };
  } catch (e) {
    if (e instanceof ScriptureProviderError) return { state: e.code === "rejected" ? "rejected" : "offline" };
    throw e;
  }
}

function uninstall(): void {
  if (provider) getScriptureRegistry().unregister(provider);
  provider = null;
}

function install(key: string, bibleId: string): void {
  uninstall();
  provider = new ApiBibleProvider({ apiKey: key, bibleId, translation: NIV_TRANSLATION, fetch: fetchImpl });
  getScriptureRegistry().register(provider);
}

async function apply(key: string, source: "env" | "file"): Promise<ApiBibleStatus> {
  const p = await probe(key);
  if (p.state === "ok") install(key, p.bibleId!);
  else uninstall();
  status = { configured: true, source, state: p.state, ...(p.bibleId ? { bibleId: p.bibleId } : {}) };
  return status;
}

export async function initApiBible(): Promise<ApiBibleStatus> {
  lastInitAt = Date.now();
  const env = envKey();
  if (env) return apply(env, "env");
  const file = await fileKey();
  if (file) return apply(file, "file");
  uninstall();
  status = { configured: false, source: null, state: "no_key" };
  return status;
}

/** Retry a failed (offline) init, at most once per minute. */
export async function ensureApiBible(now: number = Date.now()): Promise<void> {
  if (status.state === "offline" && now - lastInitAt >= RETRY_MS) await initApiBible();
}

export function getApiBibleStatus(): ApiBibleStatus {
  return { ...status };
}

export function getApiBibleProvider(): ApiBibleProvider | null {
  return provider;
}

/** Validate and save a key. Only an "ok" key is written. */
export async function setApiBibleKey(key: string): Promise<ApiBibleStatus | "env"> {
  if (envKey()) return "env";
  const p = await probe(key);
  if (p.state !== "ok") {
    return { configured: status.configured, source: status.source, state: p.state };
  }
  await fs.mkdir(path.dirname(settingsFile()), { recursive: true });
  await fs.writeFile(settingsFile(), JSON.stringify({ apiKey: key }), { mode: 0o600 });
  await fs.chmod(settingsFile(), 0o600);
  install(key, p.bibleId!);
  status = { configured: true, source: "file", state: "ok", bibleId: p.bibleId! };
  return status;
}

export async function clearApiBibleKey(): Promise<ApiBibleStatus | "env"> {
  if (envKey()) return "env";
  await fs.rm(settingsFile(), { force: true });
  uninstall();
  status = { configured: false, source: null, state: "no_key" };
  return status;
}

/** @internal */
export function _setApiBibleFetchForTest(f: FetchLike | undefined): void {
  fetchImpl = f;
}
```

Note: a rejected PUT reports `state` of the *probe* but keeps the previous `configured/source`, so the UI can show "Key rejected" without implying the old key was removed.

- [ ] **Step 5: Implement `server/src/apiBible/routes.ts`**

```ts
import type { FastifyInstance } from "fastify";
import { clearApiBibleKey, getApiBibleStatus, setApiBibleKey } from "./config";
import { reportViews } from "./fums";

const ENV_MESSAGE = "Set by environment (OVERLAYSYS_API_BIBLE_KEY)";

export async function registerApiBibleRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/scripture/api-bible", async () => getApiBibleStatus());

  app.put<{ Body: { apiKey?: unknown } }>("/api/scripture/api-bible", async (req, reply) => {
    const key = typeof req.body?.apiKey === "string" ? req.body.apiKey.trim() : "";
    if (!key) return reply.code(400).send({ ...getApiBibleStatus(), message: "Missing apiKey" });
    const result = await setApiBibleKey(key);
    if (result === "env") return reply.code(409).send({ ...getApiBibleStatus(), message: ENV_MESSAGE });
    return result.state === "ok" ? result : reply.code(400).send(result);
  });

  app.delete("/api/scripture/api-bible", async (_req, reply) => {
    const result = await clearApiBibleKey();
    if (result === "env") return reply.code(409).send({ ...getApiBibleStatus(), message: ENV_MESSAGE });
    return result;
  });

  app.post<{ Body: { tokens?: unknown } }>("/api/scripture/usage", async (req) => {
    const raw = Array.isArray(req.body?.tokens) ? req.body.tokens : [];
    const tokens = raw.filter((t): t is string => typeof t === "string" && t.length > 0);
    void reportViews(tokens);
    return { ok: true };
  });
}
```

- [ ] **Step 6: Run to verify pass**

Run: `pnpm vitest run server/src/apiBible server/src/scripture.test.ts`
Expected: all PASS (existing scripture tests still list only KJV/WEB because no key is set).

- [ ] **Step 7: Typecheck and commit**

Run: `cd server && npx tsc --noEmit`
Expected: clean.

```bash
git add server/src/scripture.ts server/src/apiBible/config.ts server/src/apiBible/routes.ts server/src/apiBible/config.test.ts
git commit -m "feat(server): API.Bible key config, NIV registration and routes"
```

---

### Task 5: Background refresh

**Files:**
- Create: `server/src/apiBible/refresh.ts`
- Modify: `server/src/index.ts`
- Test: `server/src/apiBible/refresh.test.ts`

**Interfaces:**
- Consumes: `slidesToBreaks`, `breaksToSlides`, `tokenize`, `parseReference` (`@overlaysys/scripture`); `getApiBibleProvider`, `getApiBibleStatus`, `initApiBible` (Task 4); `listShowMetas`, `getShow`, `saveShow` (`server/src/shows.ts`); `broadcast` (`server/src/broadcast.ts`).
- Produces:
  ```ts
  export const STALE_MS: number;   // 14 days
  export interface RefreshDeps {
    now: Date;
    staleMs: number;
    fetchPassage(reference: string): Promise<{ verses: ScriptureVerse[]; source: ScripturePassageSource }>;
  }
  export function refreshShow(show: Show, deps: RefreshDeps): Promise<Show | null>   // null = nothing changed
  export function runApiBibleRefresh(now?: Date): Promise<number>                   // shows saved
  export function startApiBibleRefresh(): () => void                                // stop fn
  ```

- [ ] **Step 1: Write the failing tests** — `server/src/apiBible/refresh.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Show, ScriptureRow } from "@overlaysys/core";
import type { ScriptureVerse } from "@overlaysys/scripture";
import { refreshShow, runApiBibleRefresh, STALE_MS, type RefreshDeps } from "./refresh";

const NOW = new Date("2026-10-21T12:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const v = (verse: number, text: string): ScriptureVerse => ({ book: "JHN", chapter: 3, verse, text });

function row(fetchedAt: string, extra: Partial<ScriptureRow> = {}): ScriptureRow {
  return {
    kind: "scripture",
    id: "r1",
    reference: "John 3:16-17",
    translation: "NIV",
    templateId: "t",
    slides: [
      { id: "s-a", verses: [v(16, "For God so")] },
      { id: "s-b", verses: [v(16, "loved the world"), v(17, "For God did not")] },
    ],
    source: { provider: "api.bible", bibleId: "B", fetchedAt, usageTokens: ["old"] },
    ...extra,
  } as ScriptureRow;
}

const show = (...rows: Show["rows"]): Show => ({ id: "show1", name: "S", projectId: "p", rows } as unknown as Show);

function deps(verses: ScriptureVerse[] | Error): RefreshDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    now: NOW,
    staleMs: STALE_MS,
    fetchPassage: async (ref) => {
      calls.push(ref);
      if (verses instanceof Error) throw verses;
      return { verses, source: { provider: "api.bible", bibleId: "B", usageTokens: ["new"] } };
    },
  };
}

describe("refreshShow", () => {
  it("skips rows fetched within 14 days and non-api.bible rows", async () => {
    const d = deps([v(16, "x")]);
    const kjv = { ...row(daysAgo(30)), id: "r2", translation: "KJV", source: undefined } as ScriptureRow;
    expect(await refreshShow(show(row(daysAgo(13)), kjv), d)).toBeNull();
    expect(d.calls).toEqual([]);
  });

  it("same words → only source updated, slides and ids untouched", async () => {
    const d = deps([v(16, "For God so loved the world"), v(17, "For God did not")]);
    const out = await refreshShow(show(row(daysAgo(15))), d);
    const r = out!.rows[0] as ScriptureRow;
    expect(r.slides).toEqual(row(daysAgo(15)).slides);
    expect(r.source).toEqual({ provider: "api.bible", bibleId: "B", fetchedAt: NOW.toISOString(), usageTokens: ["new"] });
    expect(d.calls).toEqual(["John 3:16-17"]);
  });

  it("changed words → breaks kept at the same word position, ids kept", async () => {
    const d = deps([v(16, "For God so greatly loved the world"), v(17, "For God did not")]);
    const r = (await refreshShow(show(row(daysAgo(15))), d))!.rows[0] as ScriptureRow;
    expect(r.slides.map((s) => s.id)).toEqual(["s-a", "s-b"]);
    expect(r.slides[0]!.verses[0]!.text).toBe("For God so");
    expect(r.slides[1]!.verses[0]!.text).toBe("greatly loved the world");
  });

  it("fewer words → out-of-range breaks dropped, no empty slides, unique ids", async () => {
    const d = deps([v(16, "For")]);
    const r = (await refreshShow(show(row(daysAgo(15))), d))!.rows[0] as ScriptureRow;
    expect(r.slides).toHaveLength(1);
    expect(r.slides.every((s) => s.verses.length > 0)).toBe(true);
    expect(new Set(r.slides.map((s) => s.id)).size).toBe(r.slides.length);
  });

  it("fetch failure leaves the row untouched", async () => {
    expect(await refreshShow(show(row(daysAgo(40))), deps(new Error("offline")))).toBeNull();
  });

  it("runApiBibleRefresh is a no-op without a key (rows keep airing as stored)", async () => {
    // Fresh module state: no key configured → no provider → nothing loaded or saved.
    expect(await runApiBibleRefresh(NOW)).toBe(0);
  });

  it("unparseable fetchedAt counts as stale", async () => {
    const d = deps([v(16, "For God so loved the world"), v(17, "For God did not")]);
    expect(await refreshShow(show(row("garbage")), d)).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run server/src/apiBible/refresh.test.ts`
Expected: FAIL — cannot resolve `./refresh`.

- [ ] **Step 3: Implement** — `server/src/apiBible/refresh.ts`:

```ts
import type { ScriptureRow, Show } from "@overlaysys/core";
import {
  breaksToSlides,
  parseReference,
  slidesToBreaks,
  tokenize,
  type ScripturePassageSource,
  type ScriptureVerse,
} from "@overlaysys/scripture";
import { broadcast } from "../broadcast";
import { getShow, listShowMetas, saveShow } from "../shows";
import { getApiBibleProvider, getApiBibleStatus, initApiBible } from "./config";

// API.Bible requires stored text to be refreshed at least every 30 days; we
// refresh saved NIV rows older than 14. Offline or keyless runs change nothing.

const DAY_MS = 86_400_000;
export const STALE_MS = 14 * DAY_MS;

export interface RefreshDeps {
  now: Date;
  staleMs: number;
  fetchPassage(reference: string): Promise<{ verses: ScriptureVerse[]; source: ScripturePassageSource }>;
}

function isStale(row: ScriptureRow, deps: RefreshDeps): boolean {
  if (row.source?.provider !== "api.bible") return false;
  const at = Date.parse(row.source.fetchedAt);
  return Number.isNaN(at) || deps.now.getTime() - at > deps.staleMs;
}

async function refreshRow(row: ScriptureRow, deps: RefreshDeps): Promise<ScriptureRow | null> {
  let fresh: Awaited<ReturnType<RefreshDeps["fetchPassage"]>>;
  try {
    fresh = await deps.fetchPassage(row.reference);
  } catch {
    return null;
  }
  const source = {
    provider: "api.bible" as const,
    bibleId: fresh.source.bibleId,
    fetchedAt: deps.now.toISOString(),
    usageTokens: fresh.source.usageTokens,
  };
  const old = slidesToBreaks(row.slides);
  const words = tokenize(fresh.verses);
  const same =
    words.length === old.words.length && words.every((w, i) => w.text === old.words[i]!.text);
  if (same) return { ...row, source };

  const breaks = new Set([...old.breaks].filter((b) => b > 0 && b < words.length));
  const used = new Set<string>();
  const slides = breaksToSlides(fresh.verses, words, breaks).map((s, i) => {
    let id = row.slides[i]?.id ?? `${row.id}-slide-${i}`;
    for (let n = 0; used.has(id); n++) id = `${row.id}-slide-${i}-${n}`;
    used.add(id);
    return { id, verses: s.verses };
  });
  console.info(`[api-bible] scripture row ${row.id}: NIV text changed on refresh`);
  return { ...row, slides, source };
}

/** Refresh stale API.Bible rows in one show. Returns the updated show, or null if nothing changed. */
export async function refreshShow(show: Show, deps: RefreshDeps): Promise<Show | null> {
  let changed = false;
  const rows: Show["rows"] = [];
  for (const row of show.rows) {
    if (row.kind === "scripture" && isStale(row, deps)) {
      const next = await refreshRow(row, deps);
      if (next) {
        rows.push(next);
        changed = true;
        continue;
      }
    }
    rows.push(row);
  }
  return changed ? { ...show, rows } : null;
}

let running = false;

/** Refresh every saved show once. Returns the number of shows saved. */
export async function runApiBibleRefresh(now: Date = new Date()): Promise<number> {
  if (running) return 0;
  running = true;
  try {
    if (getApiBibleStatus().state === "offline") await initApiBible();
    const provider = getApiBibleProvider();
    if (!provider) return 0;
    const deps: RefreshDeps = {
      now,
      staleMs: STALE_MS,
      fetchPassage: async (reference) => {
        const p = await provider.fetchPassage(parseReference(reference), "NIV");
        return { verses: p.verses, source: p.source! };
      },
    };
    let saved = 0;
    for (const meta of await listShowMetas()) {
      const show = await getShow(meta.id);
      if (!show) continue;
      const updated = await refreshShow(show, deps);
      if (!updated) continue;
      const stored = await saveShow(updated);
      broadcast({ type: "show", show: stored });
      saved++;
    }
    return saved;
  } catch (e) {
    console.warn("[api-bible] refresh failed", e instanceof Error ? e.message : e);
    return 0;
  } finally {
    running = false;
  }
}

export function startApiBibleRefresh(): () => void {
  void runApiBibleRefresh();
  const timer = setInterval(() => void runApiBibleRefresh(), DAY_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm vitest run server/src/apiBible/refresh.test.ts`
Expected: all PASS.

- [ ] **Step 5: Wire into `server/src/index.ts`**
  - Imports: `import { initApiBible } from "./apiBible/config";`, `import { registerApiBibleRoutes } from "./apiBible/routes";`, `import { startApiBibleRefresh } from "./apiBible/refresh";`
  - After `await initScripture();` (line ~85): `await initApiBible();`
  - After `await registerScriptureRoutes(app);` (line ~103): `await registerApiBibleRoutes(app);`
  - After the server is listening (after `const actualPort = await listenWithFallback(...)`, line ~161): `startApiBibleRefresh();`

- [ ] **Step 6: Typecheck, run server tests, commit**

Run: `cd server && npx tsc --noEmit && cd .. && pnpm vitest run server/src/apiBible server/src/scripture.test.ts`
Expected: clean; all PASS.

```bash
git add server/src/apiBible/refresh.ts server/src/apiBible/refresh.test.ts server/src/index.ts
git commit -m "feat(server): refresh stored NIV text every 14 days"
```

---

### Task 6: Operator — source on rows, usage on take, Settings panel

**Files:**
- Modify: `apps/operator/src/lib/scriptureClient.ts`, `apps/operator/src/app/shows/edit/page.tsx` (`addScriptureRow`, ~line 337), `apps/operator/src/app/components/ScriptureTakeStrip.tsx`, `apps/operator/src/app/shell/areas.ts`
- Create: `apps/operator/src/app/settings/scripture/page.tsx`

**Interfaces:**
- Consumes: routes from Task 4; `ScriptureRow.source` from Task 2.
- Produces (scriptureClient.ts):
  ```ts
  export interface PassageSource { provider: "api.bible"; bibleId: string; fetchedAt: string; usageTokens: string[] }
  PassageResponse.source?: PassageSource
  export type ApiBibleState = "ok" | "no_key" | "rejected" | "no_niv" | "offline";
  export interface ApiBibleStatus { configured: boolean; source: "env" | "file" | null; state: ApiBibleState; bibleId?: string; message?: string }
  export function getApiBibleStatus(): Promise<ApiBibleStatus>
  export function saveApiBibleKey(apiKey: string): Promise<ApiBibleStatus>   // resolves with status even on 400/409
  export function removeApiBibleKey(): Promise<ApiBibleStatus>
  export function reportScriptureUsage(tokens: string[]): void               // fire-and-forget
  ```

- [ ] **Step 1: Client additions** — in `scriptureClient.ts`, add to `PassageResponse`: `source?: PassageSource;` and append:

```ts
export interface PassageSource {
  provider: "api.bible";
  bibleId: string;
  fetchedAt: string;
  usageTokens: string[];
}

export type ApiBibleState = "ok" | "no_key" | "rejected" | "no_niv" | "offline";

export interface ApiBibleStatus {
  configured: boolean;
  source: "env" | "file" | null;
  state: ApiBibleState;
  bibleId?: string;
  message?: string;
}

export async function getApiBibleStatus(): Promise<ApiBibleStatus> {
  const r = await fetch(`${httpBase()}/api/scripture/api-bible`);
  if (!r.ok) throw new Error(`api-bible status: ${r.status}`);
  return r.json();
}

/** Resolves with the server's status for 200/400/409 so the panel can show why. */
export async function saveApiBibleKey(apiKey: string): Promise<ApiBibleStatus> {
  const r = await fetch(`${httpBase()}/api/scripture/api-bible`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ apiKey }),
  });
  if (r.ok || r.status === 400 || r.status === 409) return r.json();
  throw new Error(`api-bible save: ${r.status}`);
}

export async function removeApiBibleKey(): Promise<ApiBibleStatus> {
  const r = await fetch(`${httpBase()}/api/scripture/api-bible`, { method: "DELETE" });
  if (r.ok || r.status === 409) return r.json();
  throw new Error(`api-bible remove: ${r.status}`);
}

/** API.Bible usage reporting (FUMS) — fire-and-forget, never blocks a take. */
export function reportScriptureUsage(tokens: string[]): void {
  if (tokens.length === 0) return;
  void fetch(`${httpBase()}/api/scripture/usage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tokens }),
  }).catch(() => undefined);
}
```

- [ ] **Step 2: Copy `source` onto new rows** — in `shows/edit/page.tsx` `addScriptureRow`, in the new-row literal after `attribution: args.attribution,` add:

```ts
      ...(args.passage.source ? { source: args.passage.source } : {}),
```

(Edited rows keep `source` through the existing `...editingScriptureRow` spread; the reference can't change in edit mode.)

- [ ] **Step 3: Report usage on take** — in `ScriptureTakeStrip.tsx` import `reportScriptureUsage` from `@/lib/scriptureClient` and, at the end of `take(slideIdx)` after `send(...)`:

```ts
    if (row.source) reportScriptureUsage(row.source.usageTokens);
```

- [ ] **Step 4: Settings page** — create `apps/operator/src/app/settings/scripture/page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Button, Panel, colors } from "@overlaysys/ui";
import { PageBody } from "@/app/components/PageShell";
import { PageChrome } from "@/app/shell/PageChrome";
import {
  getApiBibleStatus,
  removeApiBibleKey,
  saveApiBibleKey,
  type ApiBibleStatus,
} from "@/lib/scriptureClient";

const STATE_LABEL: Record<ApiBibleStatus["state"], string> = {
  ok: "NIV found ✓",
  no_key: "No key set",
  rejected: "Key rejected",
  no_niv: "Key works but no NIV",
  offline: "Can't reach API.Bible",
};

export default function ScriptureSettingsPage() {
  const [status, setStatus] = useState<ApiBibleStatus | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getApiBibleStatus().then(setStatus).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const fromEnv = status?.source === "env";

  async function run(action: () => Promise<ApiBibleStatus>) {
    setBusy(true);
    setError(null);
    try {
      setStatus(await action());
      setKey("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageChrome title="Scripture" />
      <PageBody maxWidth={720}>
        <Panel title="API.Bible (NIV)">
          <p style={{ color: colors.textDim, fontSize: 13, marginTop: 0 }}>
            Your API.Bible key unlocks the NIV in the scripture picker. It is stored on this
            machine only.
          </p>
          <p role="status" style={{ fontSize: 13, color: status?.state === "ok" ? colors.ok : colors.textDim }}>
            {status ? STATE_LABEL[status.state] : "Loading…"}
            {fromEnv ? " · Set by environment (OVERLAYSYS_API_BIBLE_KEY)" : ""}
          </p>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="password"
              aria-label="API.Bible key"
              placeholder={status?.configured ? "Enter a new key to replace it" : "API.Bible key"}
              value={key}
              disabled={fromEnv || busy}
              onChange={(e) => setKey(e.target.value)}
              autoComplete="off"
              style={{
                flex: 1,
                padding: "6px 10px",
                borderRadius: 6,
                border: `1px solid ${colors.border}`,
                background: colors.surface,
                color: colors.text,
              }}
            />
            <Button
              variant="primary"
              disabled={fromEnv || busy || key.trim().length === 0}
              onClick={() => void run(() => saveApiBibleKey(key.trim()))}
            >
              {busy ? "Checking…" : "Save"}
            </Button>
            {status?.configured && !fromEnv && (
              <Button variant="ghost" disabled={busy} onClick={() => void run(removeApiBibleKey)}>
                Remove
              </Button>
            )}
          </div>
          {error && (
            <p role="alert" style={{ color: colors.errorText, fontSize: 12 }}>
              {error}
            </p>
          )}
        </Panel>
      </PageBody>
    </>
  );
}
```

- [ ] **Step 5: Nav entry** — in `apps/operator/src/app/shell/areas.ts` add `BookOpen` to the `lucide-react` import and, in `settings.destinations` after the Speech-to-text entry:

```ts
      { route: "/settings/scripture", label: "Scripture", icon: BookOpen, desktopOnly: true },
```

If `areas.test.ts` (or similar) snapshots the destinations list, update it to include the new entry.

- [ ] **Step 6: Typecheck and run operator tests**

Run: `pnpm --filter @overlaysys/operator typecheck && pnpm vitest run apps/operator`
Expected: clean; all PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/operator/src/lib/scriptureClient.ts apps/operator/src/app/shows/edit/page.tsx apps/operator/src/app/components/ScriptureTakeStrip.tsx apps/operator/src/app/settings/scripture/page.tsx apps/operator/src/app/shell/areas.ts
git commit -m "feat(operator): NIV via API.Bible — settings panel, row source, usage on take"
```

(Add any updated nav test file to the `git add` line.)

---

### Task 7: Live end-to-end check

**Files:**
- Create: `server/src/apiBible/apiBible.e2e.test.ts`

**Interfaces:**
- Consumes: `findNivBible`, `ApiBibleProvider`, `NIV_TRANSLATION`, `parseReference` (Task 1).

- [ ] **Step 1: Write the test** (skipped without a key, so it can't fail in CI):

```ts
import { describe, expect, it } from "vitest";
import { ApiBibleProvider, NIV_TRANSLATION, findNivBible, parseReference } from "@overlaysys/scripture";

const KEY = process.env["OVERLAYSYS_API_BIBLE_KEY"];

describe.skipIf(!KEY)("API.Bible live", () => {
  it("finds the NIV and fetches John 3:16 and a cross-chapter passage", async () => {
    const hit = await findNivBible(KEY!);
    expect(hit).not.toBeNull();
    const p = new ApiBibleProvider({ apiKey: KEY!, bibleId: hit!.bibleId, translation: NIV_TRANSLATION });
    const john = await p.fetchPassage(parseReference("John 3:16"), "NIV");
    expect(john.verses[0]!.text).toContain("For God so loved the world");
    expect(john.source!.usageTokens).toHaveLength(1);
    const cross = await p.fetchPassage(parseReference("John 3:36-4:2"), "NIV");
    expect(cross.verses.map((v) => `${v.chapter}:${v.verse}`)).toEqual(["3:36", "4:1", "4:2"]);
  }, 20_000);
});
```

- [ ] **Step 2: Run without and with the key**

Run: `pnpm vitest run server/src/apiBible/apiBible.e2e.test.ts`
Expected: 1 skipped.

Run (key read from the main checkout's desktop `.env`, never echoed):
`OVERLAYSYS_API_BIBLE_KEY="$(grep '^OVERLAYSYS_API_BIBLE_KEY=' ../OverlaySys/apps/desktop/.env | cut -d= -f2- | tr -d '"'"'"' \r')" pnpm vitest run server/src/apiBible/apiBible.e2e.test.ts`
Expected: 1 passed.

- [ ] **Step 3: Manual run** (use the `run` skill; server with a throwaway `OVERLAYSYS_DATA_DIR` plus a copied template, operator on :3000)
  1. Settings → Scripture: status "No key set". Enter the key → "NIV found ✓". Enter a wrong key → "Key rejected"; NIV still works.
  2. Add scripture: NIV listed; import John 3:16-21; split mid-verse; save. Show file has `source.fetchedAt`.
  3. Take a slide (Live): server log/FUMS fetch fires (no error); take still airs with the network off.
  4. Edit the saved show JSON's `fetchedAt` to 20 days ago, restart the server → row's `fetchedAt` updates, slides unchanged.

- [ ] **Step 4: Commit**

```bash
git add server/src/apiBible/apiBible.e2e.test.ts
git commit -m "test(server): live API.Bible check (skipped without key)"
```
