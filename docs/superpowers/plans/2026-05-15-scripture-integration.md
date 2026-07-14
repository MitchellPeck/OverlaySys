# Scripture rundown rows — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `scripture` rundown row kind that lets an operator type a reference, pick a translation, auto-split the passage into slides, and take those slides onto a user-designed template — using public-domain text bundled inside the app, behind a `ScriptureProvider` interface that licensed translations can plug into later.

**Architecture:** New `packages/scripture` package owns the reference parser, the `ScriptureProvider` interface, the bundled-PD provider, and KJV/WEB JSON bundles. The server hosts a provider registry behind `GET /api/scripture/translations` and `GET /api/scripture/passage`. The operator parses references for typeahead/validation client-side using the same package, hits the server to fetch verses, auto-splits client-side, and embeds the resulting slides in a new `ScriptureRow` row variant inside the show JSON. Renderer is untouched — scripture slides take through the existing template-take mechanism.

**Tech Stack:** TypeScript, Zod, Vitest, Fastify, Next.js (operator), pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-05-15-scripture-integration-design.md`

---

## File Structure

**New package — `packages/scripture/`:**

- `package.json` — `@overlaysys/scripture`, mirrors `packages/core` shape.
- `tsconfig.json` — extends `tsconfig.base.json`.
- `src/index.ts` — re-exports public API.
- `src/types.ts` — `ParsedReference`, `ScriptureVerse`, `ScripturePassage`, `ScriptureProvider`, `TranslationMeta`, `ScriptureRefError`.
- `src/books.ts` — canonical book table (id, name, aliases, chapter count).
- `src/reference.ts` — pure parser. `parseReference(input: string): ParsedReference[]`.
- `src/slideSplit.ts` — `splitIntoSlides(verses, budget)` pure function.
- `src/providers/registry.ts` — `ProviderRegistry` class.
- `src/providers/bundled.ts` — `BundledProvider` reading from `bundles/`.
- `src/bundles/kjv.json` — KJV verse data (downloaded, see Task B-3).
- `src/bundles/web.json` — WEB verse data (downloaded, see Task B-3).
- `src/reference.test.ts`
- `src/slideSplit.test.ts`
- `src/providers/bundled.test.ts`
- `src/providers/registry.test.ts`

**Modified — `packages/core/`:**

- `src/show.ts` — add `ScriptureSlideSchema`, `ScriptureRowSchema`; extend `RundownRowSchema` discriminated union.
- `src/show.test.ts` — schema tests for the new variant + legacy-load regression.

**New — `server/src/`:**

- `scripture.ts` — boot-time registry init, `GET /api/scripture/translations`, `GET /api/scripture/passage`.
- `scripture.test.ts` — endpoint integration tests.

**Modified — `server/src/index.ts`:** register scripture routes; add `initScripture()` to boot sequence.

**Modified — `apps/operator/src/`:**

- `lib/scriptureClient.ts` — typed fetch helpers for the two endpoints.
- `app/components/ScriptureRowModal.tsx` — create / edit modal (two-step: reference+translation, then template+slide-editor).
- `app/components/ScriptureSlideEditor.tsx` — drag verses between slides.
- `app/components/ScriptureTakeStrip.tsx` — per-slide take buttons (parallel to the song slide strip).
- `app/components/Rundown.tsx` — render scripture rows in the row list (modify-in-place).
- `app/shows/edit/page.tsx` — wire up "Add scripture row" action (modify-in-place).
- Store / WS plumbing only as needed; scripture takes use the existing template-take WS message (no new message types in v1).

**New plan-time additions to `packages/core/src/index.ts`** — none beyond the existing `export * from "./show"` which already covers the new types.

---

## Phase A — Core types & parser

### Task A1: Bootstrap `packages/scripture`

**Files:**
- Create: `packages/scripture/package.json`
- Create: `packages/scripture/tsconfig.json`
- Create: `packages/scripture/src/index.ts`
- Modify: none of the workspace files (the `packages/*` glob in `pnpm-workspace.yaml` already picks it up)

- [ ] **Step 1: Create `packages/scripture/package.json`**

```json
{
  "name": "@overlaysys/scripture",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run --dir src",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist .turbo *.tsbuildinfo"
  },
  "dependencies": {
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "typescript": "^5.6.0"
  }
}
```

- [ ] **Step 2: Create `packages/scripture/tsconfig.json`**

Copy the shape from `packages/core/tsconfig.json`:

```bash
cp packages/core/tsconfig.json packages/scripture/tsconfig.json
```

- [ ] **Step 3: Create `packages/scripture/src/index.ts`**

```ts
export {};
```

Placeholder — populated as later tasks add modules.

- [ ] **Step 4: Install workspace deps**

Run: `pnpm install`
Expected: no errors; pnpm sees the new package via the existing `packages/*` glob.

- [ ] **Step 5: Verify typecheck passes**

Run: `pnpm --filter @overlaysys/scripture typecheck`
Expected: no output (success).

- [ ] **Step 6: Commit**

```bash
git add packages/scripture
git commit -m "feat(scripture): bootstrap @overlaysys/scripture package"
```

---

### Task A2: Book table

**Files:**
- Create: `packages/scripture/src/books.ts`
- Create: `packages/scripture/src/books.test.ts`

The book table is the source of truth for canonical book ids, display names, and aliases. Used by the parser, the typeahead, and the bundled provider.

- [ ] **Step 1: Write the failing tests**

`packages/scripture/src/books.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BOOKS, findBookByAlias } from "./books";

describe("BOOKS", () => {
  it("contains 66 books (39 OT + 27 NT)", () => {
    expect(BOOKS).toHaveLength(66);
  });

  it("each book has a unique id", () => {
    const ids = new Set(BOOKS.map((b) => b.id));
    expect(ids.size).toBe(BOOKS.length);
  });

  it("each book has at least one alias", () => {
    for (const b of BOOKS) {
      expect(b.aliases.length).toBeGreaterThan(0);
    }
  });

  it("chapter counts are positive", () => {
    for (const b of BOOKS) {
      expect(b.chapters).toBeGreaterThan(0);
    }
  });
});

describe("findBookByAlias", () => {
  it("resolves the full English name", () => {
    expect(findBookByAlias("John")?.id).toBe("JHN");
    expect(findBookByAlias("Genesis")?.id).toBe("GEN");
    expect(findBookByAlias("Revelation")?.id).toBe("REV");
  });

  it("is case-insensitive", () => {
    expect(findBookByAlias("john")?.id).toBe("JHN");
    expect(findBookByAlias("GENESIS")?.id).toBe("GEN");
  });

  it("tolerates leading/trailing whitespace", () => {
    expect(findBookByAlias("  John  ")?.id).toBe("JHN");
  });

  it("resolves common abbreviations", () => {
    expect(findBookByAlias("Gen")?.id).toBe("GEN");
    expect(findBookByAlias("Rom")?.id).toBe("ROM");
    expect(findBookByAlias("1 Cor")?.id).toBe("1CO");
    expect(findBookByAlias("1Cor")?.id).toBe("1CO");
    expect(findBookByAlias("Ps")?.id).toBe("PSA");
    expect(findBookByAlias("Psalm")?.id).toBe("PSA");
    expect(findBookByAlias("Psalms")?.id).toBe("PSA");
  });

  it("disambiguates Philippians vs Philemon", () => {
    expect(findBookByAlias("Phil")?.id).toBe("PHP");   // Philippians
    expect(findBookByAlias("Philem")?.id).toBe("PHM"); // Philemon
    expect(findBookByAlias("Phlm")?.id).toBe("PHM");
    expect(findBookByAlias("Philippians")?.id).toBe("PHP");
    expect(findBookByAlias("Philemon")?.id).toBe("PHM");
  });

  it("returns null for unknown input", () => {
    expect(findBookByAlias("Foobar")).toBeNull();
    expect(findBookByAlias("")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @overlaysys/scripture test`
Expected: FAIL — `books` module does not exist.

- [ ] **Step 3: Implement `packages/scripture/src/books.ts`**

```ts
export interface BookEntry {
  /** Canonical 3-letter id (Paratext/OSIS-ish: GEN, EXO, ..., JHN, REV). */
  id: string;
  /** Display name shown in the operator UI. */
  name: string;
  /** Number of chapters in the book. Used to validate references in providers. */
  chapters: number;
  /**
   * All accepted alias strings (display name + abbreviations).
   * Matching is case-insensitive and ignores surrounding whitespace.
   * Stored in normalized form (no leading numeric space variants — both
   * "1 Cor" and "1Cor" are listed explicitly).
   */
  aliases: string[];
}

export const BOOKS: BookEntry[] = [
  { id: "GEN", name: "Genesis",       chapters: 50, aliases: ["Genesis", "Gen", "Gn"] },
  { id: "EXO", name: "Exodus",        chapters: 40, aliases: ["Exodus", "Exod", "Exo", "Ex"] },
  { id: "LEV", name: "Leviticus",     chapters: 27, aliases: ["Leviticus", "Lev", "Lv"] },
  { id: "NUM", name: "Numbers",       chapters: 36, aliases: ["Numbers", "Num", "Nm", "Nu"] },
  { id: "DEU", name: "Deuteronomy",   chapters: 34, aliases: ["Deuteronomy", "Deut", "Deu", "Dt"] },
  { id: "JOS", name: "Joshua",        chapters: 24, aliases: ["Joshua", "Josh", "Jos"] },
  { id: "JDG", name: "Judges",        chapters: 21, aliases: ["Judges", "Judg", "Jdg"] },
  { id: "RUT", name: "Ruth",          chapters: 4,  aliases: ["Ruth", "Rut"] },
  { id: "1SA", name: "1 Samuel",      chapters: 31, aliases: ["1 Samuel", "1Samuel", "1 Sam", "1Sam", "1 Sa", "1Sa"] },
  { id: "2SA", name: "2 Samuel",      chapters: 24, aliases: ["2 Samuel", "2Samuel", "2 Sam", "2Sam", "2 Sa", "2Sa"] },
  { id: "1KI", name: "1 Kings",       chapters: 22, aliases: ["1 Kings", "1Kings", "1 Kgs", "1Kgs", "1 Ki", "1Ki"] },
  { id: "2KI", name: "2 Kings",       chapters: 25, aliases: ["2 Kings", "2Kings", "2 Kgs", "2Kgs", "2 Ki", "2Ki"] },
  { id: "1CH", name: "1 Chronicles",  chapters: 29, aliases: ["1 Chronicles", "1Chronicles", "1 Chron", "1Chron", "1 Chr", "1Chr"] },
  { id: "2CH", name: "2 Chronicles",  chapters: 36, aliases: ["2 Chronicles", "2Chronicles", "2 Chron", "2Chron", "2 Chr", "2Chr"] },
  { id: "EZR", name: "Ezra",          chapters: 10, aliases: ["Ezra", "Ezr"] },
  { id: "NEH", name: "Nehemiah",      chapters: 13, aliases: ["Nehemiah", "Neh"] },
  { id: "EST", name: "Esther",        chapters: 10, aliases: ["Esther", "Esth", "Est"] },
  { id: "JOB", name: "Job",           chapters: 42, aliases: ["Job", "Jb"] },
  { id: "PSA", name: "Psalms",        chapters: 150, aliases: ["Psalms", "Psalm", "Pss", "Ps"] },
  { id: "PRO", name: "Proverbs",      chapters: 31, aliases: ["Proverbs", "Prov", "Pro", "Prv"] },
  { id: "ECC", name: "Ecclesiastes",  chapters: 12, aliases: ["Ecclesiastes", "Eccles", "Eccl", "Ecc"] },
  { id: "SNG", name: "Song of Solomon", chapters: 8, aliases: ["Song of Solomon", "Song of Songs", "Song", "SoS", "Sg"] },
  { id: "ISA", name: "Isaiah",        chapters: 66, aliases: ["Isaiah", "Isa", "Is"] },
  { id: "JER", name: "Jeremiah",      chapters: 52, aliases: ["Jeremiah", "Jer"] },
  { id: "LAM", name: "Lamentations",  chapters: 5,  aliases: ["Lamentations", "Lam"] },
  { id: "EZK", name: "Ezekiel",       chapters: 48, aliases: ["Ezekiel", "Ezek", "Ezk"] },
  { id: "DAN", name: "Daniel",        chapters: 12, aliases: ["Daniel", "Dan", "Dn"] },
  { id: "HOS", name: "Hosea",         chapters: 14, aliases: ["Hosea", "Hos"] },
  { id: "JOL", name: "Joel",          chapters: 3,  aliases: ["Joel", "Jl"] },
  { id: "AMO", name: "Amos",          chapters: 9,  aliases: ["Amos", "Am"] },
  { id: "OBA", name: "Obadiah",       chapters: 1,  aliases: ["Obadiah", "Obad", "Oba", "Ob"] },
  { id: "JON", name: "Jonah",         chapters: 4,  aliases: ["Jonah", "Jon"] },
  { id: "MIC", name: "Micah",         chapters: 7,  aliases: ["Micah", "Mic"] },
  { id: "NAM", name: "Nahum",         chapters: 3,  aliases: ["Nahum", "Nah", "Na"] },
  { id: "HAB", name: "Habakkuk",      chapters: 3,  aliases: ["Habakkuk", "Hab"] },
  { id: "ZEP", name: "Zephaniah",     chapters: 3,  aliases: ["Zephaniah", "Zeph", "Zep"] },
  { id: "HAG", name: "Haggai",        chapters: 2,  aliases: ["Haggai", "Hag"] },
  { id: "ZEC", name: "Zechariah",     chapters: 14, aliases: ["Zechariah", "Zech", "Zec"] },
  { id: "MAL", name: "Malachi",       chapters: 4,  aliases: ["Malachi", "Mal"] },

  { id: "MAT", name: "Matthew",       chapters: 28, aliases: ["Matthew", "Matt", "Mat", "Mt"] },
  { id: "MRK", name: "Mark",          chapters: 16, aliases: ["Mark", "Mrk", "Mk"] },
  { id: "LUK", name: "Luke",          chapters: 24, aliases: ["Luke", "Luk", "Lk"] },
  { id: "JHN", name: "John",          chapters: 21, aliases: ["John", "Jhn", "Jn"] },
  { id: "ACT", name: "Acts",          chapters: 28, aliases: ["Acts", "Act", "Ac"] },
  { id: "ROM", name: "Romans",        chapters: 16, aliases: ["Romans", "Rom", "Rm"] },
  { id: "1CO", name: "1 Corinthians", chapters: 16, aliases: ["1 Corinthians", "1Corinthians", "1 Cor", "1Cor", "1 Co", "1Co"] },
  { id: "2CO", name: "2 Corinthians", chapters: 13, aliases: ["2 Corinthians", "2Corinthians", "2 Cor", "2Cor", "2 Co", "2Co"] },
  { id: "GAL", name: "Galatians",     chapters: 6,  aliases: ["Galatians", "Gal"] },
  { id: "EPH", name: "Ephesians",     chapters: 6,  aliases: ["Ephesians", "Eph"] },
  { id: "PHP", name: "Philippians",   chapters: 4,  aliases: ["Philippians", "Phil", "Php"] },
  { id: "COL", name: "Colossians",    chapters: 4,  aliases: ["Colossians", "Col"] },
  { id: "1TH", name: "1 Thessalonians", chapters: 5, aliases: ["1 Thessalonians", "1Thessalonians", "1 Thess", "1Thess", "1 Th", "1Th"] },
  { id: "2TH", name: "2 Thessalonians", chapters: 3, aliases: ["2 Thessalonians", "2Thessalonians", "2 Thess", "2Thess", "2 Th", "2Th"] },
  { id: "1TI", name: "1 Timothy",     chapters: 6,  aliases: ["1 Timothy", "1Timothy", "1 Tim", "1Tim", "1 Ti", "1Ti"] },
  { id: "2TI", name: "2 Timothy",     chapters: 4,  aliases: ["2 Timothy", "2Timothy", "2 Tim", "2Tim", "2 Ti", "2Ti"] },
  { id: "TIT", name: "Titus",         chapters: 3,  aliases: ["Titus", "Tit"] },
  { id: "PHM", name: "Philemon",      chapters: 1,  aliases: ["Philemon", "Philem", "Phlm", "Phm"] },
  { id: "HEB", name: "Hebrews",       chapters: 13, aliases: ["Hebrews", "Heb"] },
  { id: "JAS", name: "James",         chapters: 5,  aliases: ["James", "Jas", "Jm"] },
  { id: "1PE", name: "1 Peter",       chapters: 5,  aliases: ["1 Peter", "1Peter", "1 Pet", "1Pet", "1 Pe", "1Pe"] },
  { id: "2PE", name: "2 Peter",       chapters: 3,  aliases: ["2 Peter", "2Peter", "2 Pet", "2Pet", "2 Pe", "2Pe"] },
  { id: "1JN", name: "1 John",        chapters: 5,  aliases: ["1 John", "1John", "1 Jn", "1Jn", "1 Jhn", "1Jhn"] },
  { id: "2JN", name: "2 John",        chapters: 1,  aliases: ["2 John", "2John", "2 Jn", "2Jn", "2 Jhn", "2Jhn"] },
  { id: "3JN", name: "3 John",        chapters: 1,  aliases: ["3 John", "3John", "3 Jn", "3Jn", "3 Jhn", "3Jhn"] },
  { id: "JUD", name: "Jude",          chapters: 1,  aliases: ["Jude", "Jud"] },
  { id: "REV", name: "Revelation",    chapters: 22, aliases: ["Revelation", "Rev", "Rv", "Re"] },
];

// Build a lookup index once at module load.
const ALIAS_INDEX: Map<string, BookEntry> = (() => {
  const m = new Map<string, BookEntry>();
  for (const b of BOOKS) {
    for (const alias of b.aliases) {
      m.set(alias.toLowerCase(), b);
    }
  }
  return m;
})();

export function findBookByAlias(input: string): BookEntry | null {
  if (!input) return null;
  const key = input.trim().toLowerCase();
  if (!key) return null;
  return ALIAS_INDEX.get(key) ?? null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @overlaysys/scripture test`
Expected: all `books.test.ts` cases pass.

- [ ] **Step 5: Commit**

```bash
git add packages/scripture/src/books.ts packages/scripture/src/books.test.ts
git commit -m "feat(scripture): add canonical book table with alias lookup"
```

---

### Task A3: Types

**Files:**
- Create: `packages/scripture/src/types.ts`

No test file — pure type declarations.

- [ ] **Step 1: Implement `packages/scripture/src/types.ts`**

```ts
/** A single verse reference range within one book. */
export interface RefRange {
  chapter: number;
  startVerse: number;
  /** Inclusive. May span chapters when expressed as `John 3:16-4:2` —
   *  in that case, this RefRange's `endChapter` is set; otherwise endChapter
   *  defaults to `chapter`. */
  endChapter: number;
  endVerse: number;
}

/** A parsed reference for one book (e.g. "John 3:16-18"). */
export interface ParsedReference {
  /** Canonical book id from books.ts. */
  book: string;
  ranges: RefRange[];
}

/** A single verse returned by a provider. */
export interface ScriptureVerse {
  book: string;
  chapter: number;
  verse: number;
  text: string;
}

/** Provider response for one or more parsed references. */
export interface ScripturePassage {
  verses: ScriptureVerse[];
  /** License/attribution text. Pinned into the row at fetch time. */
  attribution: string;
}

export interface TranslationMeta {
  /** Stable id used in row data and on the wire. */
  id: string;
  /** Full display name ("King James Version"). */
  name: string;
  /** Short label for templates ("KJV"). */
  abbreviation: string;
  /** BCP-47 or ISO 639 code. */
  language: string;
  copyright: string;
  isPublicDomain: boolean;
}

export interface ScriptureProvider {
  readonly translations: readonly TranslationMeta[];
  fetchPassage(
    references: ParsedReference[],
    translationId: string,
  ): Promise<ScripturePassage>;
}

/** Thrown by the parser for syntactically invalid input. */
export class ScriptureRefError extends Error {
  /** Character index of the failure within the input, when known. */
  position?: number;
  /** Operator-facing hint ("Unknown book 'Foobar'"). */
  hint: string;

  constructor(hint: string, position?: number) {
    super(hint);
    this.name = "ScriptureRefError";
    this.hint = hint;
    this.position = position;
  }
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter @overlaysys/scripture typecheck`
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add packages/scripture/src/types.ts
git commit -m "feat(scripture): add core types and ScriptureRefError"
```

---

### Task A4: Reference parser

**Files:**
- Create: `packages/scripture/src/reference.ts`
- Create: `packages/scripture/src/reference.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/scripture/src/reference.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseReference } from "./reference";
import { ScriptureRefError } from "./types";

describe("parseReference — single verse", () => {
  it("parses 'John 3:16'", () => {
    expect(parseReference("John 3:16")).toEqual([
      {
        book: "JHN",
        ranges: [{ chapter: 3, startVerse: 16, endChapter: 3, endVerse: 16 }],
      },
    ]);
  });

  it("accepts alternate book aliases", () => {
    expect(parseReference("Jn 3:16")[0]!.book).toBe("JHN");
    expect(parseReference("1 Cor 13:4")[0]!.book).toBe("1CO");
    expect(parseReference("1Cor 13:4")[0]!.book).toBe("1CO");
    expect(parseReference("Ps 23:1")[0]!.book).toBe("PSA");
  });

  it("tolerates extra whitespace", () => {
    expect(parseReference("  John   3:16  ")[0]!.ranges[0]).toEqual({
      chapter: 3, startVerse: 16, endChapter: 3, endVerse: 16,
    });
  });
});

describe("parseReference — ranges", () => {
  it("parses same-chapter range 'John 3:16-18'", () => {
    expect(parseReference("John 3:16-18")[0]!.ranges).toEqual([
      { chapter: 3, startVerse: 16, endChapter: 3, endVerse: 18 },
    ]);
  });

  it("parses cross-chapter range 'John 3:16-4:2'", () => {
    expect(parseReference("John 3:16-4:2")[0]!.ranges).toEqual([
      { chapter: 3, startVerse: 16, endChapter: 4, endVerse: 2 },
    ]);
  });

  it("rejects descending ranges within a chapter", () => {
    expect(() => parseReference("John 3:18-16")).toThrow(ScriptureRefError);
  });

  it("rejects descending cross-chapter ranges", () => {
    expect(() => parseReference("John 4:2-3:16")).toThrow(ScriptureRefError);
  });
});

describe("parseReference — multi-passage", () => {
  it("parses semicolon-separated passages", () => {
    const parsed = parseReference("Rom 8:28; 1 Cor 13:4-7");
    expect(parsed).toHaveLength(2);
    expect(parsed[0]!.book).toBe("ROM");
    expect(parsed[0]!.ranges[0]).toEqual({
      chapter: 8, startVerse: 28, endChapter: 8, endVerse: 28,
    });
    expect(parsed[1]!.book).toBe("1CO");
    expect(parsed[1]!.ranges[0]).toEqual({
      chapter: 13, startVerse: 4, endChapter: 13, endVerse: 7,
    });
  });

  it("ignores trailing semicolons / empty segments", () => {
    expect(parseReference("Rom 8:28;")).toHaveLength(1);
    expect(parseReference("Rom 8:28;;1 Cor 13:4")).toHaveLength(2);
  });
});

describe("parseReference — errors", () => {
  it("rejects empty input", () => {
    expect(() => parseReference("")).toThrow(ScriptureRefError);
    expect(() => parseReference("   ")).toThrow(ScriptureRefError);
  });

  it("rejects unknown book", () => {
    const err = (() => {
      try { parseReference("Foobar 1:1"); return null; }
      catch (e) { return e as ScriptureRefError; }
    })();
    expect(err).toBeInstanceOf(ScriptureRefError);
    expect(err!.hint.toLowerCase()).toContain("book");
  });

  it("rejects missing chapter/verse", () => {
    expect(() => parseReference("John")).toThrow(ScriptureRefError);
    expect(() => parseReference("John 3")).toThrow(ScriptureRefError);
  });

  it("rejects non-numeric chapter or verse", () => {
    expect(() => parseReference("John foo:1")).toThrow(ScriptureRefError);
    expect(() => parseReference("John 3:bar")).toThrow(ScriptureRefError);
  });

  it("rejects zero or negative chapter/verse", () => {
    expect(() => parseReference("John 0:1")).toThrow(ScriptureRefError);
    expect(() => parseReference("John 3:0")).toThrow(ScriptureRefError);
    expect(() => parseReference("John -1:1")).toThrow(ScriptureRefError);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @overlaysys/scripture test reference`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `packages/scripture/src/reference.ts`**

```ts
import { findBookByAlias } from "./books";
import { ScriptureRefError, type ParsedReference, type RefRange } from "./types";

/**
 * Parses an operator-typed scripture reference string into a normalized list
 * of references, one entry per book mentioned. Pure: validates syntax and
 * book aliases only. Per-book chapter/verse existence is the provider's job
 * (the parser has no per-book chapter counts in its execution path).
 *
 * Accepted shapes:
 *   - "John 3:16"
 *   - "John 3:16-18"
 *   - "John 3:16-4:2"   (cross-chapter)
 *   - "Rom 8:28; 1 Cor 13:4-7"  (multi-passage; semicolons)
 */
export function parseReference(input: string): ParsedReference[] {
  if (!input || !input.trim()) {
    throw new ScriptureRefError("Reference is empty");
  }
  const segments = input
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (segments.length === 0) {
    throw new ScriptureRefError("Reference is empty");
  }
  return segments.map((segment) => parseSegment(segment));
}

function parseSegment(segment: string): ParsedReference {
  // Match: <book> <chapter>:<verse>[-(<chapter>:)?<verse>]
  // The book portion is greedy up to the last whitespace before a digit.
  const match = segment.match(
    /^\s*(.+?)\s+(\d+)\s*:\s*(\d+)(?:\s*-\s*(?:(\d+)\s*:\s*)?(\d+))?\s*$/,
  );
  if (!match) {
    throw new ScriptureRefError(
      `Could not parse "${segment}". Expected "Book Chapter:Verse" or "Book Chapter:Verse-Verse".`,
    );
  }
  const [, bookText, chStr, vStr, endChStr, endVStr] = match;
  const book = findBookByAlias(bookText!);
  if (!book) {
    throw new ScriptureRefError(`Unknown book "${bookText!.trim()}"`);
  }
  const chapter = Number(chStr);
  const startVerse = Number(vStr);
  if (chapter <= 0 || startVerse <= 0) {
    throw new ScriptureRefError(
      `Chapter and verse must be positive in "${segment}"`,
    );
  }
  let endChapter = chapter;
  let endVerse = startVerse;
  if (endVStr !== undefined) {
    endVerse = Number(endVStr);
    if (endChStr !== undefined) endChapter = Number(endChStr);
    if (endChapter <= 0 || endVerse <= 0) {
      throw new ScriptureRefError(
        `End chapter/verse must be positive in "${segment}"`,
      );
    }
    if (
      endChapter < chapter ||
      (endChapter === chapter && endVerse < startVerse)
    ) {
      throw new ScriptureRefError(
        `Range end precedes start in "${segment}"`,
      );
    }
  }
  const range: RefRange = { chapter, startVerse, endChapter, endVerse };
  return { book: book.id, ranges: [range] };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @overlaysys/scripture test reference`
Expected: all `reference.test.ts` cases pass.

- [ ] **Step 5: Export from package index**

Edit `packages/scripture/src/index.ts`:

```ts
export * from "./types";
export * from "./books";
export * from "./reference";
```

- [ ] **Step 6: Commit**

```bash
git add packages/scripture/src/reference.ts packages/scripture/src/reference.test.ts packages/scripture/src/index.ts
git commit -m "feat(scripture): add reference parser with book aliases and ranges"
```

---

### Task A5: Slide-split helper

**Files:**
- Create: `packages/scripture/src/slideSplit.ts`
- Create: `packages/scripture/src/slideSplit.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/scripture/src/slideSplit.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { splitIntoSlides, DEFAULT_SLIDE_BUDGET } from "./slideSplit";
import type { ScriptureVerse } from "./types";

const V = (book: string, chapter: number, verse: number, text: string): ScriptureVerse =>
  ({ book, chapter, verse, text });

describe("splitIntoSlides", () => {
  it("packs short verses onto one slide", () => {
    const verses = [
      V("JHN", 3, 16, "For God so loved the world,"),
      V("JHN", 3, 17, "that he gave his only Son."),
    ];
    const slides = splitIntoSlides(verses, { maxChars: 240, maxLines: 4 });
    expect(slides).toHaveLength(1);
    expect(slides[0]!.verses).toEqual(verses);
  });

  it("splits when char budget exceeded", () => {
    const long = "x".repeat(150);
    const verses = [
      V("JHN", 3, 16, long),
      V("JHN", 3, 17, long),
    ];
    const slides = splitIntoSlides(verses, { maxChars: 200, maxLines: 4 });
    expect(slides).toHaveLength(2);
    expect(slides[0]!.verses).toHaveLength(1);
    expect(slides[1]!.verses).toHaveLength(1);
  });

  it("splits when line budget exceeded", () => {
    // Each verse is 1 line by default.
    const verses = [
      V("JHN", 3, 16, "a"),
      V("JHN", 3, 17, "b"),
      V("JHN", 3, 18, "c"),
      V("JHN", 3, 19, "d"),
      V("JHN", 3, 20, "e"),
    ];
    const slides = splitIntoSlides(verses, { maxChars: 1000, maxLines: 2 });
    expect(slides).toHaveLength(3);
    expect(slides[0]!.verses.map((v) => v.verse)).toEqual([16, 17]);
    expect(slides[1]!.verses.map((v) => v.verse)).toEqual([18, 19]);
    expect(slides[2]!.verses.map((v) => v.verse)).toEqual([20]);
  });

  it("gives a single overlong verse its own slide rather than splitting it", () => {
    const long = "x".repeat(1000);
    const slides = splitIntoSlides([V("JHN", 3, 16, long)], {
      maxChars: 100,
      maxLines: 4,
    });
    expect(slides).toHaveLength(1);
    expect(slides[0]!.verses).toHaveLength(1);
    expect(slides[0]!.verses[0]!.text).toBe(long);
  });

  it("preserves verse order across slides", () => {
    const verses = Array.from({ length: 10 }, (_, i) =>
      V("JHN", 3, 16 + i, "x".repeat(100)),
    );
    const slides = splitIntoSlides(verses, { maxChars: 200, maxLines: 4 });
    const flat = slides.flatMap((s) => s.verses.map((v) => v.verse));
    expect(flat).toEqual(verses.map((v) => v.verse));
  });

  it("returns an empty array when input is empty", () => {
    expect(splitIntoSlides([], DEFAULT_SLIDE_BUDGET)).toEqual([]);
  });

  it("each slide has a unique id", () => {
    const verses = Array.from({ length: 5 }, (_, i) =>
      V("JHN", 3, 16 + i, "x".repeat(100)),
    );
    const slides = splitIntoSlides(verses, { maxChars: 200, maxLines: 4 });
    const ids = new Set(slides.map((s) => s.id));
    expect(ids.size).toBe(slides.length);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @overlaysys/scripture test slideSplit`
Expected: FAIL.

- [ ] **Step 3: Implement `packages/scripture/src/slideSplit.ts`**

```ts
import type { ScriptureVerse } from "./types";

export interface SlideBudget {
  maxChars: number;
  maxLines: number;
}

export const DEFAULT_SLIDE_BUDGET: SlideBudget = { maxChars: 240, maxLines: 4 };

export interface AutoSlide {
  id: string;
  verses: ScriptureVerse[];
}

/**
 * Greedy fill: append verses to the current slide until adding one would
 * exceed either budget. A single verse longer than the budget gets its own
 * slide (verse boundaries are preserved in v1 — never split mid-verse).
 *
 * Each verse counts as one line for line-budget purposes. Char count is
 * the sum of verse texts on the slide (separators ignored).
 */
export function splitIntoSlides(
  verses: ScriptureVerse[],
  budget: SlideBudget,
): AutoSlide[] {
  if (verses.length === 0) return [];

  const slides: AutoSlide[] = [];
  let current: ScriptureVerse[] = [];
  let currentChars = 0;
  let slideIdx = 0;

  const flush = () => {
    if (current.length === 0) return;
    slides.push({ id: nextId(slideIdx++), verses: current });
    current = [];
    currentChars = 0;
  };

  for (const v of verses) {
    const wouldExceedChars = currentChars + v.text.length > budget.maxChars;
    const wouldExceedLines = current.length + 1 > budget.maxLines;
    if (current.length > 0 && (wouldExceedChars || wouldExceedLines)) {
      flush();
    }
    current.push(v);
    currentChars += v.text.length;
  }
  flush();
  return slides;
}

function nextId(idx: number): string {
  // Stable, plan-friendly ids. The operator-edited shape will replace these
  // with persisted slide ids on save (see ScriptureRowModal).
  return `slide-${idx}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @overlaysys/scripture test slideSplit`
Expected: pass.

- [ ] **Step 5: Export from package index**

Edit `packages/scripture/src/index.ts`:

```ts
export * from "./types";
export * from "./books";
export * from "./reference";
export * from "./slideSplit";
```

- [ ] **Step 6: Commit**

```bash
git add packages/scripture/src/slideSplit.ts packages/scripture/src/slideSplit.test.ts packages/scripture/src/index.ts
git commit -m "feat(scripture): add greedy slide auto-split"
```

---

## Phase B — Bundled provider + JSON data

### Task B1: Provider registry

**Files:**
- Create: `packages/scripture/src/providers/registry.ts`
- Create: `packages/scripture/src/providers/registry.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/scripture/src/providers/registry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ProviderRegistry } from "./registry";
import type { ScriptureProvider, TranslationMeta } from "../types";

function fakeProvider(translations: TranslationMeta[]): ScriptureProvider {
  return {
    translations,
    fetchPassage: async () => ({ verses: [], attribution: "" }),
  };
}

const KJV: TranslationMeta = {
  id: "KJV", name: "King James Version", abbreviation: "KJV",
  language: "en", copyright: "Public Domain", isPublicDomain: true,
};
const WEB: TranslationMeta = {
  id: "WEB", name: "World English Bible", abbreviation: "WEB",
  language: "en", copyright: "Public Domain", isPublicDomain: true,
};

describe("ProviderRegistry", () => {
  it("registers a provider and lists its translations", () => {
    const r = new ProviderRegistry();
    r.register(fakeProvider([KJV, WEB]));
    expect(r.listTranslations().map((t) => t.id).sort()).toEqual(["KJV", "WEB"]);
  });

  it("resolves a translation id to its provider", () => {
    const r = new ProviderRegistry();
    const p = fakeProvider([KJV]);
    r.register(p);
    expect(r.providerFor("KJV")).toBe(p);
  });

  it("returns null for an unknown translation", () => {
    const r = new ProviderRegistry();
    r.register(fakeProvider([KJV]));
    expect(r.providerFor("NIV")).toBeNull();
  });

  it("throws when two providers declare the same translation id", () => {
    const r = new ProviderRegistry();
    r.register(fakeProvider([KJV]));
    expect(() => r.register(fakeProvider([KJV]))).toThrow(/duplicate/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @overlaysys/scripture test registry`
Expected: FAIL.

- [ ] **Step 3: Implement `packages/scripture/src/providers/registry.ts`**

```ts
import type { ScriptureProvider, TranslationMeta } from "../types";

export class ProviderRegistry {
  private readonly byTranslation = new Map<string, ScriptureProvider>();
  private readonly providers: ScriptureProvider[] = [];

  register(provider: ScriptureProvider): void {
    for (const t of provider.translations) {
      if (this.byTranslation.has(t.id)) {
        throw new Error(
          `Duplicate translation id "${t.id}" — already registered by another provider`,
        );
      }
    }
    for (const t of provider.translations) this.byTranslation.set(t.id, provider);
    this.providers.push(provider);
  }

  providerFor(translationId: string): ScriptureProvider | null {
    return this.byTranslation.get(translationId) ?? null;
  }

  listTranslations(): TranslationMeta[] {
    return this.providers.flatMap((p) => [...p.translations]);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @overlaysys/scripture test registry`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add packages/scripture/src/providers/registry.ts packages/scripture/src/providers/registry.test.ts
git commit -m "feat(scripture): add ProviderRegistry"
```

---

### Task B2: Bundled provider (against test fixtures)

This task ships the provider against small in-repo test fixtures. Real KJV/WEB bundles land in Task B3 separately so this task stays reviewable.

**Files:**
- Create: `packages/scripture/src/providers/bundled.ts`
- Create: `packages/scripture/src/providers/bundled.test.ts`
- Create: `packages/scripture/src/__fixtures__/mini-kjv.json` (test-only)

- [ ] **Step 1: Create the fixture**

`packages/scripture/src/__fixtures__/mini-kjv.json`:

```json
{
  "translation": {
    "id": "MINI_KJV",
    "name": "Mini KJV (test fixture)",
    "abbreviation": "MKJV",
    "language": "en",
    "copyright": "Public Domain",
    "isPublicDomain": true
  },
  "books": {
    "JHN": {
      "3": {
        "16": "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.",
        "17": "For God sent not his Son into the world to condemn the world; but that the world through him might be saved.",
        "18": "He that believeth on him is not condemned: but he that believeth not is condemned already, because he hath not believed in the name of the only begotten Son of God."
      },
      "4": {
        "1": "When therefore the Lord knew how the Pharisees had heard that Jesus made and baptized more disciples than John,",
        "2": "(Though Jesus himself baptized not, but his disciples,)"
      }
    },
    "ROM": {
      "8": {
        "28": "And we know that all things work together for good to them that love God, to them who are the called according to his purpose."
      }
    }
  }
}
```

- [ ] **Step 2: Write the failing tests**

`packages/scripture/src/providers/bundled.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BundledProvider, type BundleFile } from "./bundled";
import { parseReference } from "../reference";
import mini from "../__fixtures__/mini-kjv.json" with { type: "json" };

const bundle = mini as BundleFile;

describe("BundledProvider", () => {
  const provider = new BundledProvider([bundle]);

  it("exposes the bundle's translation meta", () => {
    expect(provider.translations).toHaveLength(1);
    expect(provider.translations[0]!.id).toBe("MINI_KJV");
  });

  it("fetches a single verse", async () => {
    const refs = parseReference("John 3:16");
    const res = await provider.fetchPassage(refs, "MINI_KJV");
    expect(res.verses).toHaveLength(1);
    expect(res.verses[0]!.book).toBe("JHN");
    expect(res.verses[0]!.chapter).toBe(3);
    expect(res.verses[0]!.verse).toBe(16);
    expect(res.verses[0]!.text).toMatch(/^For God so loved/);
    expect(res.attribution).toMatch(/Public Domain/);
  });

  it("fetches a same-chapter range", async () => {
    const refs = parseReference("John 3:16-18");
    const res = await provider.fetchPassage(refs, "MINI_KJV");
    expect(res.verses.map((v) => v.verse)).toEqual([16, 17, 18]);
  });

  it("fetches a cross-chapter range", async () => {
    const refs = parseReference("John 3:17-4:2");
    const res = await provider.fetchPassage(refs, "MINI_KJV");
    expect(res.verses.map((v) => `${v.chapter}:${v.verse}`)).toEqual([
      "3:17", "3:18", "4:1", "4:2",
    ]);
  });

  it("fetches a multi-passage list, preserving order", async () => {
    const refs = parseReference("Rom 8:28; John 3:16");
    const res = await provider.fetchPassage(refs, "MINI_KJV");
    expect(res.verses.map((v) => `${v.book} ${v.chapter}:${v.verse}`)).toEqual([
      "ROM 8:28",
      "JHN 3:16",
    ]);
  });

  it("throws on an unknown translation id", async () => {
    const refs = parseReference("John 3:16");
    await expect(provider.fetchPassage(refs, "UNKNOWN"))
      .rejects.toThrow(/unknown translation/i);
  });

  it("throws on a chapter that doesn't exist in this book", async () => {
    const refs = parseReference("John 99:1");
    await expect(provider.fetchPassage(refs, "MINI_KJV"))
      .rejects.toThrow(/chapter/i);
  });

  it("throws on a verse that doesn't exist in this chapter", async () => {
    const refs = parseReference("John 3:99");
    await expect(provider.fetchPassage(refs, "MINI_KJV"))
      .rejects.toThrow(/verse/i);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @overlaysys/scripture test bundled`
Expected: FAIL.

- [ ] **Step 4: Implement `packages/scripture/src/providers/bundled.ts`**

```ts
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @overlaysys/scripture test bundled`
Expected: pass.

- [ ] **Step 6: Export from package index**

Edit `packages/scripture/src/index.ts`:

```ts
export * from "./types";
export * from "./books";
export * from "./reference";
export * from "./slideSplit";
export * from "./providers/registry";
export * from "./providers/bundled";
```

- [ ] **Step 7: Commit**

```bash
git add packages/scripture/src/providers packages/scripture/src/__fixtures__ packages/scripture/src/index.ts
git commit -m "feat(scripture): add BundledProvider with fixture-backed tests"
```

---

### Task B3: Real KJV + WEB bundles

The bundles are the only large artifacts in the package. They live under `src/bundles/` so they're imported via JSON-with-type at compile time.

We use the public-domain `aruljohn/Bible-kjv` and the `gratis-deo` / `wldeh/bible-api` mirror of WEB. Both publish chapter-per-file JSON; we transform to the `BundleFile` shape.

**Files:**
- Create: `packages/scripture/scripts/build-bundles.mjs` — one-shot transformer.
- Create: `packages/scripture/src/bundles/kjv.json` — generated.
- Create: `packages/scripture/src/bundles/web.json` — generated.
- Create: `packages/scripture/src/bundles/index.ts` — typed re-export.
- Modify: `packages/scripture/src/providers/bundled.ts` — no changes (already generic).

- [ ] **Step 1: Write the build script**

`packages/scripture/scripts/build-bundles.mjs`:

```js
// One-shot script. Downloads public-domain KJV + WEB chapter-per-file JSON
// from a known mirror and emits packages/scripture/src/bundles/{kjv,web}.json
// in the BundleFile shape consumed by BundledProvider.
//
// Re-run with: pnpm --filter @overlaysys/scripture build:bundles
//
// Source repo:
//   https://github.com/wldeh/bible-api  (CC0 / public-domain translations)
// Path shape (per translation): /bibles/{translationId}/books/{bookId}/chapters/{n}.json
// File shape:
//   { "data": [{ "verse": "1", "text": "..." }, ...] }
//
// This is intentionally a build-time script, not a runtime fetch. The bundles
// are committed to the repo so users always get scripture offline.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "..", "src", "bundles");

const BASE = "https://raw.githubusercontent.com/wldeh/bible-api/main/bibles";

const TRANSLATIONS = [
  {
    sourceId: "en-kjv",
    meta: {
      id: "KJV",
      name: "King James Version",
      abbreviation: "KJV",
      language: "en",
      copyright: "Public Domain",
      isPublicDomain: true,
    },
  },
  {
    sourceId: "en-web",
    meta: {
      id: "WEB",
      name: "World English Bible",
      abbreviation: "WEB",
      language: "en",
      copyright: "Public Domain (World English Bible)",
      isPublicDomain: true,
    },
  },
];

// Mirrors packages/scripture/src/books.ts. Keep in sync.
// (Engineer note: if BOOKS changes, update this list and re-run.)
const BOOKS = [
  ["GEN", "genesis", 50], ["EXO", "exodus", 40], ["LEV", "leviticus", 27],
  ["NUM", "numbers", 36], ["DEU", "deuteronomy", 34], ["JOS", "joshua", 24],
  ["JDG", "judges", 21], ["RUT", "ruth", 4], ["1SA", "1-samuel", 31],
  ["2SA", "2-samuel", 24], ["1KI", "1-kings", 22], ["2KI", "2-kings", 25],
  ["1CH", "1-chronicles", 29], ["2CH", "2-chronicles", 36], ["EZR", "ezra", 10],
  ["NEH", "nehemiah", 13], ["EST", "esther", 10], ["JOB", "job", 42],
  ["PSA", "psalms", 150], ["PRO", "proverbs", 31], ["ECC", "ecclesiastes", 12],
  ["SNG", "song-of-solomon", 8], ["ISA", "isaiah", 66], ["JER", "jeremiah", 52],
  ["LAM", "lamentations", 5], ["EZK", "ezekiel", 48], ["DAN", "daniel", 12],
  ["HOS", "hosea", 14], ["JOL", "joel", 3], ["AMO", "amos", 9],
  ["OBA", "obadiah", 1], ["JON", "jonah", 4], ["MIC", "micah", 7],
  ["NAM", "nahum", 3], ["HAB", "habakkuk", 3], ["ZEP", "zephaniah", 3],
  ["HAG", "haggai", 2], ["ZEC", "zechariah", 14], ["MAL", "malachi", 4],
  ["MAT", "matthew", 28], ["MRK", "mark", 16], ["LUK", "luke", 24],
  ["JHN", "john", 21], ["ACT", "acts", 28], ["ROM", "romans", 16],
  ["1CO", "1-corinthians", 16], ["2CO", "2-corinthians", 13], ["GAL", "galatians", 6],
  ["EPH", "ephesians", 6], ["PHP", "philippians", 4], ["COL", "colossians", 4],
  ["1TH", "1-thessalonians", 5], ["2TH", "2-thessalonians", 3], ["1TI", "1-timothy", 6],
  ["2TI", "2-timothy", 4], ["TIT", "titus", 3], ["PHM", "philemon", 1],
  ["HEB", "hebrews", 13], ["JAS", "james", 5], ["1PE", "1-peter", 5],
  ["2PE", "2-peter", 3], ["1JN", "1-john", 5], ["2JN", "2-john", 1],
  ["3JN", "3-john", 1], ["JUD", "jude", 1], ["REV", "revelation", 22],
];

async function fetchChapter(sourceId, bookSlug, ch) {
  const url = `${BASE}/${sourceId}/books/${bookSlug}/chapters/${ch}.json`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`GET ${url} → ${r.status}`);
  return r.json();
}

async function buildOne({ sourceId, meta }) {
  const books = {};
  for (const [bookId, bookSlug, chapterCount] of BOOKS) {
    process.stdout.write(`[${meta.id}] ${bookId}…\r`);
    const chapters = {};
    for (let ch = 1; ch <= chapterCount; ch++) {
      const data = await fetchChapter(sourceId, bookSlug, ch);
      const verses = {};
      for (const v of data.data) verses[String(v.verse)] = v.text;
      chapters[String(ch)] = verses;
    }
    books[bookId] = chapters;
  }
  process.stdout.write("\n");
  const out = { translation: meta, books };
  const outPath = path.join(OUT_DIR, `${meta.id.toLowerCase()}.json`);
  await writeFile(outPath, JSON.stringify(out));
  console.log(`wrote ${outPath}`);
}

await mkdir(OUT_DIR, { recursive: true });
for (const t of TRANSLATIONS) await buildOne(t);
```

- [ ] **Step 2: Wire the build script into package.json**

Edit `packages/scripture/package.json` — add to `scripts`:

```jsonc
{
  "scripts": {
    // ... existing entries ...
    "build:bundles": "node scripts/build-bundles.mjs"
  }
}
```

- [ ] **Step 3: Run the build**

Run: `pnpm --filter @overlaysys/scripture build:bundles`
Expected: writes `packages/scripture/src/bundles/kjv.json` and `web.json` (each ~5 MB).

If the upstream URL has changed, the script will fail with a 404 — fix the BASE/path shape in the script before re-running. Do not invent a different source without the user's go-ahead.

- [ ] **Step 4: Create `packages/scripture/src/bundles/index.ts`**

```ts
import kjv from "./kjv.json" with { type: "json" };
import web from "./web.json" with { type: "json" };
import type { BundleFile } from "../providers/bundled";

export const KJV_BUNDLE = kjv as BundleFile;
export const WEB_BUNDLE = web as BundleFile;
export const ALL_BUNDLES: BundleFile[] = [KJV_BUNDLE, WEB_BUNDLE];
```

- [ ] **Step 5: Smoke-test the bundles**

Append to `packages/scripture/src/providers/bundled.test.ts`:

```ts
import { ALL_BUNDLES } from "../bundles";

describe("BundledProvider — real bundles", () => {
  const provider = new BundledProvider(ALL_BUNDLES);

  it("loads KJV and WEB", () => {
    const ids = provider.translations.map((t) => t.id).sort();
    expect(ids).toEqual(["KJV", "WEB"]);
  });

  it("fetches John 3:16 in KJV", async () => {
    const refs = parseReference("John 3:16");
    const res = await provider.fetchPassage(refs, "KJV");
    expect(res.verses).toHaveLength(1);
    expect(res.verses[0]!.text.toLowerCase()).toContain("god so loved");
  });

  it("fetches John 3:16 in WEB", async () => {
    const refs = parseReference("John 3:16");
    const res = await provider.fetchPassage(refs, "WEB");
    expect(res.verses).toHaveLength(1);
    expect(res.verses[0]!.text.toLowerCase()).toContain("god so loved");
  });

  it("fetches a cross-chapter range across full real data", async () => {
    const refs = parseReference("John 3:35-4:2");
    const res = await provider.fetchPassage(refs, "KJV");
    // John 3 ends at v36 — expect at least one verse from chapter 3 and
    // two from chapter 4.
    const chapters = new Set(res.verses.map((v) => v.chapter));
    expect(chapters).toContain(3);
    expect(chapters).toContain(4);
  });
});
```

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @overlaysys/scripture test`
Expected: all tests pass, including new real-bundle cases.

- [ ] **Step 7: Update package index**

Edit `packages/scripture/src/index.ts`:

```ts
export * from "./types";
export * from "./books";
export * from "./reference";
export * from "./slideSplit";
export * from "./providers/registry";
export * from "./providers/bundled";
export * from "./bundles";
```

- [ ] **Step 8: Commit**

```bash
git add packages/scripture/scripts packages/scripture/src/bundles packages/scripture/src/providers/bundled.test.ts packages/scripture/src/index.ts packages/scripture/package.json
git commit -m "feat(scripture): bundle KJV and WEB public-domain text"
```

---

## Phase C — `ScriptureRow` schema in core

### Task C1: ScriptureRow + RundownRow union update

**Files:**
- Modify: `packages/core/src/show.ts`
- Modify: `packages/core/src/show.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/src/show.test.ts`:

```ts
import { ScriptureRowSchema, ScriptureSlideSchema, RundownRowSchema, ShowSchema } from "./show";

describe("ScriptureSlideSchema", () => {
  const minimal = {
    id: "s1",
    verses: [
      { book: "JHN", chapter: 3, verse: 16, text: "For God so loved..." },
    ],
  };

  it("parses a minimal slide", () => {
    expect(ScriptureSlideSchema.parse(minimal).id).toBe("s1");
  });

  it("rejects a slide with no verses", () => {
    expect(() =>
      ScriptureSlideSchema.parse({ id: "s1", verses: [] }),
    ).toThrow();
  });
});

describe("ScriptureRowSchema", () => {
  const minimal = {
    kind: "scripture" as const,
    id: "row-1",
    reference: "John 3:16",
    translation: "KJV",
    slides: [{
      id: "s1",
      verses: [{ book: "JHN", chapter: 3, verse: 16, text: "For God..." }],
    }],
    templateId: "scripture-template",
  };

  it("parses a minimal row", () => {
    const parsed = ScriptureRowSchema.parse(minimal);
    expect(parsed.kind).toBe("scripture");
    expect(parsed.reference).toBe("John 3:16");
  });

  it("accepts optional fields", () => {
    const parsed = ScriptureRowSchema.parse({
      ...minimal,
      attribution: "Public Domain",
      channelHint: "program",
      notes: "intro reading",
    });
    expect(parsed.attribution).toBe("Public Domain");
    expect(parsed.channelHint).toBe("program");
  });

  it("rejects a row with no slides", () => {
    expect(() =>
      ScriptureRowSchema.parse({ ...minimal, slides: [] }),
    ).toThrow();
  });
});

describe("RundownRowSchema — scripture variant", () => {
  it("parses a scripture row via the union", () => {
    const row = RundownRowSchema.parse({
      kind: "scripture",
      id: "row-1",
      reference: "John 3:16",
      translation: "KJV",
      slides: [{
        id: "s1",
        verses: [{ book: "JHN", chapter: 3, verse: 16, text: "..." }],
      }],
      templateId: "t1",
    });
    expect(row.kind).toBe("scripture");
  });

  it("still defaults missing kind to graphic (regression)", () => {
    const row = RundownRowSchema.parse({
      // no kind
      id: "row-x",
      templateId: "t1",
      data: { text: "hello" },
    });
    expect(row.kind).toBe("graphic");
  });
});

describe("ShowSchema with mixed rundown rows", () => {
  it("accepts graphic + song + scripture in the same rundown", () => {
    const show = ShowSchema.parse({
      id: "show-1",
      title: "Test",
      rundown: [
        { kind: "graphic", id: "g", templateId: "t", data: {} },
        {
          kind: "song", id: "s", songId: "song-1", lyricTemplateId: "lt",
        },
        {
          kind: "scripture",
          id: "sc",
          reference: "John 3:16",
          translation: "KJV",
          slides: [{
            id: "sl",
            verses: [{ book: "JHN", chapter: 3, verse: 16, text: "..." }],
          }],
          templateId: "scripture-template",
        },
      ],
    });
    expect(show.rundown).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @overlaysys/core test show`
Expected: FAIL — new schemas not exported.

- [ ] **Step 3: Implement schema changes in `packages/core/src/show.ts`**

Add the schemas above existing union exports (after `ShowSongSchema` so the file flows top-to-bottom: row variants, then containers).

Insert after the `SongRowSchema`/`ShowSongSchema` block and **before** `RundownRowSchema`:

```ts
export const ScriptureSlideSchema = z.object({
  id: z.string(),
  /**
   * Verses on this slide, in display order. Stored as structured data
   * (not pre-joined strings) so the renderer can format verse numbers and
   * per-verse styling without re-fetching the passage.
   */
  verses: z
    .array(
      z.object({
        book: z.string(),
        chapter: z.number().int().positive(),
        verse: z.number().int().positive(),
        text: z.string(),
      }),
    )
    .min(1),
});
export type ScriptureSlide = z.infer<typeof ScriptureSlideSchema>;

export const ScriptureRowSchema = z.object({
  kind: z.literal("scripture"),
  id: z.string(),
  /** Normalized reference string, e.g. "John 3:16-18". */
  reference: z.string(),
  /** TranslationMeta.id from @overlaysys/scripture. */
  translation: z.string(),
  /** Attribution captured at fetch time so the on-air state is reproducible. */
  attribution: z.string().optional(),
  /** Embedded slides — auto-split on import, operator-editable. */
  slides: z.array(ScriptureSlideSchema).min(1),
  templateId: z.string(),
  channelHint: z.string().optional(),
  notes: z.string().optional(),
});
export type ScriptureRow = z.infer<typeof ScriptureRowSchema>;
```

Then update `RundownRowSchema` — extend the discriminated union to include scripture. The current pre-discriminator preprocess (defaults missing `kind` to `"graphic"`) stays untouched:

```ts
export const RundownRowSchema = z.preprocess(
  (raw) => {
    if (
      raw &&
      typeof raw === "object" &&
      !Array.isArray(raw) &&
      !("kind" in (raw as Record<string, unknown>))
    ) {
      return { kind: "graphic", ...(raw as Record<string, unknown>) };
    }
    return raw;
  },
  z.discriminatedUnion("kind", [
    GraphicRowSchema,
    SongRowSchema,
    ScriptureRowSchema,
  ]),
);
export type RundownRow = z.infer<typeof RundownRowSchema>;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @overlaysys/core test`
Expected: all `show.test.ts` cases pass, including the legacy-load regression.

- [ ] **Step 5: Run full workspace typecheck**

Run: `pnpm -r typecheck`
Expected: success. If any operator/server code does an exhaustive `switch (row.kind)` over `RundownRow`, TS will flag the missing `scripture` case — fix those minimally (add `case "scripture":` that does nothing yet; Phase D fills them in). Note the file paths flagged for your reference; do not rewrite them.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/show.ts packages/core/src/show.test.ts
git commit -m "feat(core): add ScriptureRow variant to RundownRow union"
```

---

## Phase D — Server: registry, init, endpoints

### Task D1: Server scripture module + boot init

**Files:**
- Create: `server/src/scripture.ts`
- Create: `server/src/scripture.test.ts`
- Modify: `server/src/index.ts`

- [ ] **Step 1: Write the failing tests**

`server/src/scripture.test.ts`:

```ts
import { describe, expect, it, beforeAll } from "vitest";
import Fastify from "fastify";
import { initScripture, registerScriptureRoutes, _getRegistryForTest } from "./scripture";

async function buildApp() {
  await initScripture();
  const app = Fastify();
  await registerScriptureRoutes(app);
  await app.ready();
  return app;
}

describe("scripture init", () => {
  beforeAll(async () => { await initScripture(); });

  it("registers KJV and WEB", () => {
    const r = _getRegistryForTest();
    const ids = r.listTranslations().map((t) => t.id).sort();
    expect(ids).toEqual(["KJV", "WEB"]);
  });
});

describe("GET /api/scripture/translations", () => {
  it("returns the registered translations", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({ method: "GET", url: "/api/scripture/translations" });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.translations).toBeInstanceOf(Array);
      const ids = body.translations.map((t: { id: string }) => t.id).sort();
      expect(ids).toEqual(["KJV", "WEB"]);
    } finally {
      await app.close();
    }
  });
});

describe("GET /api/scripture/passage", () => {
  it("returns verses for a valid reference", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "GET",
        url: "/api/scripture/passage?ref=John+3:16&translation=KJV",
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.reference).toMatch(/John/);
      expect(body.translation).toBe("KJV");
      expect(body.verses).toHaveLength(1);
      expect(body.verses[0].verse).toBe(16);
      expect(body.attribution).toMatch(/Public Domain/i);
    } finally {
      await app.close();
    }
  });

  it("returns 400 on parser failure", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "GET",
        url: "/api/scripture/passage?ref=Foobar+1:1&translation=KJV",
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.code).toBe("parse_error");
      expect(body.hint).toMatch(/book/i);
    } finally {
      await app.close();
    }
  });

  it("returns 404 on unknown translation", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "GET",
        url: "/api/scripture/passage?ref=John+3:16&translation=NIV",
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("returns 400 on chapter/verse out of range", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "GET",
        url: "/api/scripture/passage?ref=John+99:1&translation=KJV",
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.hint.toLowerCase()).toContain("chapter");
    } finally {
      await app.close();
    }
  });

  it("returns a normalized reference string for the round-trip", async () => {
    const app = await buildApp();
    try {
      const res = await app.inject({
        method: "GET",
        url: "/api/scripture/passage?ref=Jn+3:16-17&translation=KJV",
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      // "Jn" should round-trip as "John"; range preserved.
      expect(body.reference).toBe("John 3:16-17");
      expect(body.verses.map((v: { verse: number }) => v.verse)).toEqual([16, 17]);
    } finally {
      await app.close();
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter server test scripture`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `server/src/scripture.ts`**

```ts
import type { FastifyInstance } from "fastify";
import {
  ALL_BUNDLES,
  BundledProvider,
  parseReference,
  ProviderRegistry,
  ScriptureRefError,
  BOOKS,
  type ParsedReference,
} from "@overlaysys/scripture";

let registry: ProviderRegistry | null = null;

export async function initScripture(): Promise<void> {
  const r = new ProviderRegistry();
  r.register(new BundledProvider(ALL_BUNDLES));
  registry = r;
}

/** @internal test access */
export function _getRegistryForTest(): ProviderRegistry {
  if (!registry) throw new Error("scripture not initialized");
  return registry;
}

export async function registerScriptureRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/scripture/translations", async () => {
    if (!registry) await initScripture();
    return { translations: registry!.listTranslations() };
  });

  app.get<{ Querystring: { ref?: string; translation?: string } }>(
    "/api/scripture/passage",
    async (req, reply) => {
      if (!registry) await initScripture();
      const ref = (req.query.ref ?? "").trim();
      const translation = (req.query.translation ?? "").trim();
      if (!ref) {
        return reply.code(400).send({
          code: "parse_error",
          message: "Missing reference",
          hint: "Provide ?ref=Book+Chapter:Verse",
        });
      }
      if (!translation) {
        return reply.code(400).send({
          code: "parse_error",
          message: "Missing translation",
          hint: "Provide ?translation=KJV",
        });
      }

      let parsed: ParsedReference[];
      try {
        parsed = parseReference(ref);
      } catch (e) {
        if (e instanceof ScriptureRefError) {
          return reply.code(400).send({
            code: "parse_error",
            message: e.message,
            hint: e.hint,
            position: e.position ?? null,
          });
        }
        throw e;
      }

      const provider = registry!.providerFor(translation);
      if (!provider) {
        return reply.code(404).send({
          code: "unknown_translation",
          message: `Translation "${translation}" is not registered`,
          hint: "GET /api/scripture/translations for valid ids",
        });
      }

      try {
        const passage = await provider.fetchPassage(parsed, translation);
        return {
          reference: formatNormalizedReference(parsed),
          translation,
          verses: passage.verses,
          attribution: passage.attribution,
        };
      } catch (e) {
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
    },
  );
}

function formatNormalizedReference(parsed: ParsedReference[]): string {
  return parsed.map(formatOne).join("; ");
}

function formatOne(p: ParsedReference): string {
  const book = BOOKS.find((b) => b.id === p.book);
  const name = book ? book.name : p.book;
  return p.ranges
    .map((r) => {
      if (r.chapter === r.endChapter && r.startVerse === r.endVerse) {
        return `${name} ${r.chapter}:${r.startVerse}`;
      }
      if (r.chapter === r.endChapter) {
        return `${name} ${r.chapter}:${r.startVerse}-${r.endVerse}`;
      }
      return `${name} ${r.chapter}:${r.startVerse}-${r.endChapter}:${r.endVerse}`;
    })
    .join(", ");
}
```

- [ ] **Step 4: Add `@overlaysys/scripture` as a server dependency**

Edit `server/package.json` — under `dependencies`, add (alphabetical with the existing `@overlaysys/*` entries):

```jsonc
"@overlaysys/scripture": "workspace:*",
```

Then run: `pnpm install`
Expected: workspace link resolves.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter server test scripture`
Expected: all scripture endpoint tests pass.

- [ ] **Step 6: Wire into server boot**

Edit `server/src/index.ts`:

a) Add an import next to the other boot/registry imports:

```ts
import { initScripture, registerScriptureRoutes } from "./scripture";
```

b) Add `await initScripture()` to the boot block where the other `await reloadXxx()` calls live (after `reloadProjects()`).

c) Add `await registerScriptureRoutes(app);` next to the other `registerXxxRoutes(app)` calls (next to `registerImportRoutes`).

- [ ] **Step 7: Run the server smoke check**

Run: `pnpm --filter server typecheck && pnpm dev`
In another shell, run:

```bash
curl 'http://localhost:4000/api/scripture/translations'
curl 'http://localhost:4000/api/scripture/passage?ref=John+3:16&translation=KJV'
```

Expected: both return JSON; the second has `verses[0].text` starting with "For God so loved".

Stop the dev server when satisfied.

- [ ] **Step 8: Commit**

```bash
git add server/src/scripture.ts server/src/scripture.test.ts server/src/index.ts server/package.json pnpm-lock.yaml
git commit -m "feat(server): expose /api/scripture/{translations,passage}"
```

---

## Phase E — Operator UI: client helpers, modal, slide editor, rundown

### Task E1: Operator scripture client

**Files:**
- Create: `apps/operator/src/lib/scriptureClient.ts`

The operator already has typed fetch wrappers in `apps/operator/src/lib/` — open one (e.g. the songs or templates client) and mirror its shape. (No new test file: this is thin glue; covered indirectly by modal tests.)

- [ ] **Step 1: Skim an existing client to match style**

```bash
ls apps/operator/src/lib | grep -iE 'client|fetch|songs|templates'
```

Read the closest match. Mirror its base-URL handling and error shape.

- [ ] **Step 2: Implement `apps/operator/src/lib/scriptureClient.ts`**

```ts
import type { TranslationMeta, ScriptureVerse } from "@overlaysys/scripture";
import { getServerBaseUrl } from "./serverBase"; // existing helper (see Step 1)

export interface PassageResponse {
  reference: string;
  translation: string;
  verses: ScriptureVerse[];
  attribution: string;
}

export interface ScriptureError {
  code: "parse_error" | "unknown_translation" | "out_of_range" | string;
  message: string;
  hint: string;
  position?: number | null;
}

export async function listTranslations(): Promise<TranslationMeta[]> {
  const r = await fetch(`${getServerBaseUrl()}/api/scripture/translations`);
  if (!r.ok) throw new Error(`translations: ${r.status}`);
  const body = (await r.json()) as { translations: TranslationMeta[] };
  return body.translations;
}

export async function fetchPassage(
  ref: string,
  translation: string,
): Promise<PassageResponse> {
  const url = `${getServerBaseUrl()}/api/scripture/passage?ref=${encodeURIComponent(ref)}&translation=${encodeURIComponent(translation)}`;
  const r = await fetch(url);
  if (!r.ok) {
    const err = (await r.json()) as ScriptureError;
    throw Object.assign(new Error(err.message), err);
  }
  return r.json();
}
```

If `serverBase` does not exist in `apps/operator/src/lib/`, check how the songs / templates client builds its URL and use the same approach. Do not introduce a new pattern.

- [ ] **Step 3: Add `@overlaysys/scripture` as an operator dependency**

Edit `apps/operator/package.json` — under `dependencies`, add `"@overlaysys/scripture": "workspace:*"` alongside the existing `@overlaysys/*` entries.

Run: `pnpm install`

- [ ] **Step 4: Verify typecheck**

Run: `pnpm --filter @overlaysys/operator typecheck` (or whatever the package name is — confirm via `apps/operator/package.json`).
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add apps/operator/src/lib/scriptureClient.ts apps/operator/package.json pnpm-lock.yaml
git commit -m "feat(operator): add scripture client wrapping /api/scripture/*"
```

---

### Task E2: Scripture row modal — reference input

The modal is two-step: step 1 picks reference + translation; step 2 picks template + reviews slides. Implement step 1 first.

**Files:**
- Create: `apps/operator/src/app/components/ScriptureRowModal.tsx`
- Create: `apps/operator/src/app/components/ScriptureRowModal.test.tsx`

- [ ] **Step 1: Skim an existing modal for patterns**

Look at one of the existing modals (`ImportFromFileModal.tsx`, `PasteLyricsModal.tsx`) for the project's modal shape — props, close behavior, button styling, where state lives. Match it; don't invent new conventions.

- [ ] **Step 2: Write the failing tests**

`apps/operator/src/app/components/ScriptureRowModal.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ScriptureRowModal } from "./ScriptureRowModal";
import * as scriptureClient from "@/lib/scriptureClient";

vi.mock("@/lib/scriptureClient");

beforeEach(() => {
  vi.mocked(scriptureClient.listTranslations).mockResolvedValue([
    { id: "KJV", name: "King James Version", abbreviation: "KJV", language: "en", copyright: "PD", isPublicDomain: true },
    { id: "WEB", name: "World English Bible", abbreviation: "WEB", language: "en", copyright: "PD", isPublicDomain: true },
  ]);
});

describe("ScriptureRowModal — step 1", () => {
  it("disables Continue when reference is empty", async () => {
    render(<ScriptureRowModal open onClose={() => {}} onSave={() => {}} />);
    await waitFor(() => screen.getByLabelText(/translation/i));
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
  });

  it("shows an inline parse-error hint as the user types invalid input", async () => {
    render(<ScriptureRowModal open onClose={() => {}} onSave={() => {}} />);
    await waitFor(() => screen.getByLabelText(/translation/i));
    await userEvent.type(screen.getByLabelText(/reference/i), "Foobar 1:1");
    expect(await screen.findByText(/unknown book/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
  });

  it("enables Continue when reference parses", async () => {
    render(<ScriptureRowModal open onClose={() => {}} onSave={() => {}} />);
    await waitFor(() => screen.getByLabelText(/translation/i));
    await userEvent.type(screen.getByLabelText(/reference/i), "John 3:16");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /continue/i })).toBeEnabled(),
    );
  });

  it("fetches the passage on Continue", async () => {
    vi.mocked(scriptureClient.fetchPassage).mockResolvedValue({
      reference: "John 3:16",
      translation: "KJV",
      verses: [{ book: "JHN", chapter: 3, verse: 16, text: "For God..." }],
      attribution: "Public Domain",
    });
    render(<ScriptureRowModal open onClose={() => {}} onSave={() => {}} />);
    await waitFor(() => screen.getByLabelText(/translation/i));
    await userEvent.type(screen.getByLabelText(/reference/i), "John 3:16");
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));
    await waitFor(() => {
      expect(scriptureClient.fetchPassage).toHaveBeenCalledWith("John 3:16", "KJV");
    });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @overlaysys/operator test ScriptureRowModal`
Expected: FAIL (component not implemented).

- [ ] **Step 4: Implement the modal — step 1 only**

`apps/operator/src/app/components/ScriptureRowModal.tsx`:

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { parseReference, ScriptureRefError, type TranslationMeta } from "@overlaysys/scripture";
import { listTranslations, fetchPassage, type PassageResponse } from "@/lib/scriptureClient";

interface Props {
  open: boolean;
  onClose: () => void;
  onSave: (row: SaveArgs) => void;
}

export interface SaveArgs {
  reference: string;
  translation: string;
  attribution: string;
  passage: PassageResponse;
  // Step 2 (Task E3) will add: slides, templateId.
}

export function ScriptureRowModal({ open, onClose, onSave }: Props) {
  const [translations, setTranslations] = useState<TranslationMeta[]>([]);
  const [refInput, setRefInput] = useState("");
  const [translation, setTranslation] = useState<string>("");
  const [passage, setPassage] = useState<PassageResponse | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    listTranslations().then((t) => {
      setTranslations(t);
      if (t.length > 0 && !translation) setTranslation(t[0]!.id);
    });
  }, [open, translation]);

  const parseError = useMemo(() => {
    if (!refInput.trim()) return null;
    try {
      parseReference(refInput);
      return null;
    } catch (e) {
      return e instanceof ScriptureRefError ? e.hint : "Invalid reference";
    }
  }, [refInput]);

  const canContinue = refInput.trim().length > 0 && !parseError && translation.length > 0 && !busy;

  async function onContinue() {
    setBusy(true);
    setFetchError(null);
    try {
      const p = await fetchPassage(refInput, translation);
      setPassage(p);
      // Step 2 (Task E3) renders the slide editor when `passage` is set.
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setFetchError(msg);
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div role="dialog" aria-label="Add scripture row">
      {!passage ? (
        <div>
          <label>
            Reference
            <input
              aria-label="Reference"
              value={refInput}
              onChange={(e) => setRefInput(e.target.value)}
              placeholder='e.g. "John 3:16-18" or "Rom 8:28; 1 Cor 13:4-7"'
            />
          </label>
          {parseError && <p role="alert">{parseError}</p>}
          <label>
            Translation
            <select
              aria-label="Translation"
              value={translation}
              onChange={(e) => setTranslation(e.target.value)}
            >
              {translations.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </label>
          {fetchError && <p role="alert">{fetchError}</p>}
          <button onClick={onClose}>Cancel</button>
          <button disabled={!canContinue} onClick={onContinue}>Continue</button>
        </div>
      ) : (
        // Step 2 (Task E3) replaces this placeholder.
        <div data-testid="step-2-placeholder">Loaded {passage.verses.length} verses</div>
      )}
    </div>
  );
}
```

Match the project's existing Modal/Field/Select components (from `@overlaysys/ui` based on the imports in `TakePanel.tsx`) once Step 2 lands and the modal moves out of placeholder shape. For now, plain HTML elements are sufficient to make the tests pass; styling alignment happens in E3 alongside the rest of the modal.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @overlaysys/operator test ScriptureRowModal`
Expected: all four tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/operator/src/app/components/ScriptureRowModal.tsx apps/operator/src/app/components/ScriptureRowModal.test.tsx
git commit -m "feat(operator): scripture row modal — reference + translation step"
```

---

### Task E3: Slide editor — view + reassign verses to neighbour slide

**Files:**
- Create: `apps/operator/src/app/components/ScriptureSlideEditor.tsx`
- Create: `apps/operator/src/app/components/ScriptureSlideEditor.test.tsx`

The slide editor takes the auto-split slides and lets the operator move a verse to the previous or next slide. (Drag-and-drop is a later polish; v1 uses ◀/▶ buttons on each verse to push it onto the neighbour slide.)

- [ ] **Step 1: Write the failing tests**

`apps/operator/src/app/components/ScriptureSlideEditor.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { ScriptureSlideEditor, type EditableSlide } from "./ScriptureSlideEditor";

function Harness({ initial }: { initial: EditableSlide[] }) {
  const [slides, setSlides] = useState(initial);
  return <ScriptureSlideEditor slides={slides} onChange={setSlides} />;
}

const seed: EditableSlide[] = [
  {
    id: "s1",
    verses: [
      { book: "JHN", chapter: 3, verse: 16, text: "For God so loved..." },
      { book: "JHN", chapter: 3, verse: 17, text: "For God sent not..." },
    ],
  },
  {
    id: "s2",
    verses: [
      { book: "JHN", chapter: 3, verse: 18, text: "He that believeth..." },
    ],
  },
];

describe("ScriptureSlideEditor", () => {
  it("renders one card per slide and one row per verse", () => {
    render(<Harness initial={seed} />);
    expect(screen.getAllByTestId("slide-card")).toHaveLength(2);
    expect(screen.getAllByTestId("verse-row")).toHaveLength(3);
  });

  it("moves the last verse of a slide to the next slide", async () => {
    render(<Harness initial={seed} />);
    const moveNextButtons = screen.getAllByRole("button", { name: /move to next slide/i });
    // The first slide's last verse (3:17) — find by aria-label.
    const v17Next = screen.getByRole("button", { name: /move 3:17 to next slide/i });
    await userEvent.click(v17Next);

    // Slide 1 now has only 3:16; slide 2 starts with 3:17.
    const slides = screen.getAllByTestId("slide-card");
    expect(slides[0]!.textContent).toContain("3:16");
    expect(slides[0]!.textContent).not.toContain("3:17");
    expect(slides[1]!.textContent!.indexOf("3:17"))
      .toBeLessThan(slides[1]!.textContent!.indexOf("3:18"));
  });

  it("moves the first verse of a slide to the previous slide", async () => {
    render(<Harness initial={seed} />);
    const v18Prev = screen.getByRole("button", { name: /move 3:18 to previous slide/i });
    await userEvent.click(v18Prev);

    const slides = screen.getAllByTestId("slide-card");
    // 3:18 now appears at the end of slide 1.
    expect(slides[0]!.textContent).toContain("3:18");
    // Slide 2 is empty -> should be removed (no empty slides).
    expect(screen.getAllByTestId("slide-card")).toHaveLength(1);
  });

  it("creates a new trailing slide when moving the only verse of the last slide forward", async () => {
    render(<Harness initial={seed} />);
    const v18Next = screen.getByRole("button", { name: /move 3:18 to next slide/i });
    await userEvent.click(v18Next);

    expect(screen.getAllByTestId("slide-card")).toHaveLength(2);
    const slides = screen.getAllByTestId("slide-card");
    expect(slides[1]!.textContent).toContain("3:18");
  });

  it("disables 'move to previous' on the first verse of the first slide", () => {
    render(<Harness initial={seed} />);
    const v16Prev = screen.getByRole("button", { name: /move 3:16 to previous slide/i });
    expect(v16Prev).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @overlaysys/operator test ScriptureSlideEditor`
Expected: FAIL.

- [ ] **Step 3: Implement `ScriptureSlideEditor.tsx`**

```tsx
"use client";

import type { ScriptureVerse } from "@overlaysys/scripture";

export interface EditableSlide {
  id: string;
  verses: ScriptureVerse[];
}

interface Props {
  slides: EditableSlide[];
  onChange: (next: EditableSlide[]) => void;
}

export function ScriptureSlideEditor({ slides, onChange }: Props) {
  return (
    <div>
      {slides.map((slide, slideIdx) => (
        <div key={slide.id} data-testid="slide-card">
          <header>Slide {slideIdx + 1}</header>
          {slide.verses.map((v, verseIdx) => {
            const isFirstVerseOfFirstSlide = slideIdx === 0 && verseIdx === 0;
            return (
              <div key={`${v.book}-${v.chapter}-${v.verse}`} data-testid="verse-row">
                <span>{v.chapter}:{v.verse} {v.text}</span>
                <button
                  aria-label={`Move ${v.chapter}:${v.verse} to previous slide`}
                  disabled={isFirstVerseOfFirstSlide}
                  onClick={() => onChange(moveVerse(slides, slideIdx, verseIdx, -1))}
                >
                  ◀
                </button>
                <button
                  aria-label={`Move ${v.chapter}:${v.verse} to next slide`}
                  onClick={() => onChange(moveVerse(slides, slideIdx, verseIdx, +1))}
                >
                  ▶
                </button>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function moveVerse(
  slides: EditableSlide[],
  slideIdx: number,
  verseIdx: number,
  direction: -1 | 1,
): EditableSlide[] {
  const next = slides.map((s) => ({ ...s, verses: s.verses.slice() }));
  const sourceSlide = next[slideIdx]!;
  const [verse] = sourceSlide.verses.splice(verseIdx, 1);

  let targetIdx = slideIdx + direction;
  if (targetIdx < 0) {
    // Disabled in UI; defensive.
    sourceSlide.verses.splice(verseIdx, 0, verse!);
    return next;
  }
  if (targetIdx >= next.length) {
    // Create a new trailing slide.
    next.push({ id: nextSlideId(next), verses: [] });
  }
  const targetSlide = next[targetIdx]!;
  if (direction === -1) {
    targetSlide.verses.push(verse!);
  } else {
    targetSlide.verses.unshift(verse!);
  }
  // Drop any slide that ended up empty.
  return next.filter((s) => s.verses.length > 0);
}

function nextSlideId(slides: EditableSlide[]): string {
  const used = new Set(slides.map((s) => s.id));
  let i = slides.length;
  while (used.has(`slide-${i}`)) i++;
  return `slide-${i}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @overlaysys/operator test ScriptureSlideEditor`
Expected: pass.

- [ ] **Step 5: Wire the slide editor into the modal (step 2 of ScriptureRowModal)**

Edit `apps/operator/src/app/components/ScriptureRowModal.tsx`. Replace the `data-testid="step-2-placeholder"` block with the real step 2:

```tsx
import { ScriptureSlideEditor, type EditableSlide } from "./ScriptureSlideEditor";
import { splitIntoSlides, DEFAULT_SLIDE_BUDGET } from "@overlaysys/scripture";
import { useStore } from "@/lib/store"; // existing operator store with templates
```

And replace the placeholder render branch:

```tsx
{passage && (
  <Step2
    passage={passage}
    onCancel={() => setPassage(null)}
    onSave={(slides, templateId) => {
      onSave({
        reference: passage.reference,
        translation: passage.translation,
        attribution: passage.attribution,
        passage,
        // @ts-expect-error -- extend SaveArgs below
        slides,
        templateId,
      });
      onClose();
    }}
  />
)}
```

…and define the inner `Step2` component in the same file (kept private):

```tsx
function Step2({
  passage,
  onCancel,
  onSave,
}: {
  passage: PassageResponse;
  onCancel: () => void;
  onSave: (slides: EditableSlide[], templateId: string) => void;
}) {
  const templates = useStore((s) => s.templates);
  const [slides, setSlides] = useState<EditableSlide[]>(() =>
    splitIntoSlides(passage.verses, DEFAULT_SLIDE_BUDGET).map((s) => ({
      id: s.id, verses: s.verses,
    })),
  );
  const [templateId, setTemplateId] = useState<string>(templates[0]?.id ?? "");
  return (
    <div>
      <label>
        Template
        <select
          aria-label="Template"
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
        >
          {templates.map((t) => (
            <option key={t.id} value={t.id}>{t.name ?? t.id}</option>
          ))}
        </select>
      </label>
      <ScriptureSlideEditor slides={slides} onChange={setSlides} />
      <button onClick={onCancel}>Back</button>
      <button
        disabled={!templateId || slides.length === 0}
        onClick={() => onSave(slides, templateId)}
      >
        Save
      </button>
    </div>
  );
}
```

Extend `SaveArgs` to carry the slides + templateId so the `@ts-expect-error` above can be removed:

```ts
export interface SaveArgs {
  reference: string;
  translation: string;
  attribution: string;
  passage: PassageResponse;
  slides: EditableSlide[];
  templateId: string;
}
```

- [ ] **Step 6: Add one integration test for the wired step-2 flow**

Append to `apps/operator/src/app/components/ScriptureRowModal.test.tsx`:

```tsx
it("calls onSave with slides + templateId after step 2", async () => {
  vi.mocked(scriptureClient.fetchPassage).mockResolvedValue({
    reference: "John 3:16-17",
    translation: "KJV",
    verses: [
      { book: "JHN", chapter: 3, verse: 16, text: "For God so loved..." },
      { book: "JHN", chapter: 3, verse: 17, text: "For God sent not..." },
    ],
    attribution: "Public Domain",
  });
  // Provide a minimal template via the store mock. If the operator uses a
  // module-level store, mock the `useStore` selector here. See existing modal
  // tests for the established pattern; mirror it.
  const onSave = vi.fn();
  render(<ScriptureRowModal open onClose={() => {}} onSave={onSave} />);
  await waitFor(() => screen.getByLabelText(/translation/i));
  await userEvent.type(screen.getByLabelText(/reference/i), "John 3:16-17");
  await userEvent.click(screen.getByRole("button", { name: /continue/i }));
  await waitFor(() => screen.getByLabelText(/template/i));
  await userEvent.click(screen.getByRole("button", { name: /save/i }));
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
    reference: "John 3:16-17",
    translation: "KJV",
    templateId: expect.any(String),
    slides: expect.any(Array),
  }));
});
```

- [ ] **Step 7: Run tests**

Run: `pnpm --filter @overlaysys/operator test ScriptureRowModal ScriptureSlideEditor`
Expected: all pass. If the store-mock pattern in step 6 doesn't fit the project's existing test style, mirror the pattern used by the closest existing modal test instead.

- [ ] **Step 8: Commit**

```bash
git add apps/operator/src/app/components/ScriptureSlideEditor.tsx apps/operator/src/app/components/ScriptureSlideEditor.test.tsx apps/operator/src/app/components/ScriptureRowModal.tsx apps/operator/src/app/components/ScriptureRowModal.test.tsx
git commit -m "feat(operator): scripture slide editor + modal step 2"
```

---

### Task E4: Rundown integration — render scripture rows + take strip

**Files:**
- Modify: `apps/operator/src/app/components/Rundown.tsx`
- Create: `apps/operator/src/app/components/ScriptureTakeStrip.tsx`
- Modify: `apps/operator/src/app/shows/edit/page.tsx`

The scripture row needs three pieces in the editor:

1. **Row item in the rundown list** — title shows `"Scripture · John 3:16 (KJV)"`.
2. **Take strip** when selected — one button per slide; clicking takes the slide on the configured channel.
3. **"Add scripture row" action** in the show editor's "add row" menu, opening `ScriptureRowModal`.

Take semantics: scripture slides take through the existing template-take WS message (same path graphic rows use). No new WS messages. Field-key convention: `text` → joined verse texts on the slide, `reference` → pretty reference for the slide's verses, `translation` → translation abbreviation, `attribution` → row's stored attribution.

- [ ] **Step 1: Identify the existing take-row WS call**

```bash
grep -n "kind === \"graphic\"\|type: \"take\"" apps/operator/src/app/components/Rundown.tsx
grep -rn "type: \"take\"" apps/operator/src/lib apps/operator/src/app/components | head -10
```

Read the exact shape — message type, field-data shape, channel resolution helper. The scripture take strip must produce the same shape.

- [ ] **Step 2: Implement `ScriptureTakeStrip.tsx`**

`apps/operator/src/app/components/ScriptureTakeStrip.tsx`:

```tsx
"use client";

import type { ScriptureRow, ScriptureSlide } from "@overlaysys/core";
import { BOOKS } from "@overlaysys/scripture";
import { useWs } from "@/lib/useWs";

interface Props {
  row: ScriptureRow;
  channel: string;
}

export function ScriptureTakeStrip({ row, channel }: Props) {
  const { send } = useWs();

  function take(slide: ScriptureSlide) {
    const data: Record<string, string> = {
      text: slide.verses.map((v) => v.text).join("\n"),
      reference: prettyReferenceForSlide(slide),
      translation: row.translation,
      attribution: row.attribution ?? "",
    };
    // Match the existing take-message shape verified in step 1.
    send({ type: "take", channel, templateId: row.templateId, data });
  }

  return (
    <div role="toolbar" aria-label="Scripture slides">
      {row.slides.map((slide, i) => (
        <button key={slide.id} onClick={() => take(slide)}>
          {i + 1}. {prettyReferenceForSlide(slide)}
        </button>
      ))}
    </div>
  );
}

function prettyReferenceForSlide(slide: ScriptureSlide): string {
  if (slide.verses.length === 0) return "";
  const first = slide.verses[0]!;
  const last = slide.verses[slide.verses.length - 1]!;
  const bookName = BOOKS.find((b) => b.id === first.book)?.name ?? first.book;
  if (first.chapter === last.chapter && first.verse === last.verse) {
    return `${bookName} ${first.chapter}:${first.verse}`;
  }
  if (first.chapter === last.chapter) {
    return `${bookName} ${first.chapter}:${first.verse}-${last.verse}`;
  }
  return `${bookName} ${first.chapter}:${first.verse}-${last.chapter}:${last.verse}`;
}
```

Adjust the `send({ type: "take", ... })` call to exactly match the WS message shape you verified in Step 1. If the existing graphic-row take uses a different field name (e.g. `payload` vs `data`, or a `mode` field), copy that shape verbatim — do not invent a new variant.

- [ ] **Step 3: Update `Rundown.tsx` to render scripture rows**

The existing exhaustive `if (row.kind === "song")` blocks were updated by Phase C's typecheck pass (`case "scripture":` stubs). Replace each stub with the appropriate scripture handling:

For the row label/title: render `"Scripture · " + row.reference + " (" + row.translation + ")"`.

For the channel-resolution branch (around `Rundown.tsx:34`): scripture rows resolve the channel the same way graphic rows do — via `row.channelHint`. Reuse the existing `channelHint`-resolution helper.

For the selected-row detail panel (the `selectedSongRow` branch in `Rundown.tsx:135`): add a parallel `selectedScriptureRow`:

```tsx
const selectedScriptureRow: ScriptureRow | null =
  selectedRow && selectedRow.kind === "scripture" ? selectedRow : null;

// ... existing JSX ...

{selectedScriptureRow && resolvedChannel && (
  <ScriptureTakeStrip row={selectedScriptureRow} channel={resolvedChannel} />
)}
```

Reuse the channel resolution variable already in scope; do not duplicate the channel-pick logic. If the song path uses a helper, use it (or its scripture-appropriate analogue).

- [ ] **Step 4: Add the "Add scripture row" action**

Open `apps/operator/src/app/shows/edit/page.tsx`. Find the existing "Add row" / "Add song" menu — it will have an `onAddSongRow` (or similar) handler that inserts a new `SongRow` into the show. Mirror that structure for scripture:

```tsx
const [scriptureModalOpen, setScriptureModalOpen] = useState(false);

// Inside the add-row menu (next to "Add song"):
<MenuItem onClick={() => setScriptureModalOpen(true)}>Add scripture</MenuItem>

// And mount the modal:
<ScriptureRowModal
  open={scriptureModalOpen}
  onClose={() => setScriptureModalOpen(false)}
  onSave={({ reference, translation, attribution, slides, templateId }) => {
    setShow((prev) => ({
      ...prev,
      rundown: [
        ...prev.rundown,
        {
          kind: "scripture",
          id: newRowId(),
          reference,
          translation,
          attribution,
          slides: slides.map((s) => ({ id: s.id, verses: s.verses })),
          templateId,
        } satisfies ScriptureRow,
      ],
    }));
    setScriptureModalOpen(false);
  }}
/>
```

Use the existing `newRowId()` (or equivalent) helper from the show editor — every other row creation in this file already does. Do not introduce a new id generator.

- [ ] **Step 5: Typecheck + lint the whole operator app**

Run: `pnpm --filter @overlaysys/operator typecheck`
Expected: success.

Run: `pnpm --filter @overlaysys/operator lint` (if a lint script exists)
Expected: success.

- [ ] **Step 6: Manual smoke test**

```bash
pnpm dev
```

In the operator at `http://localhost:3000`:

1. Open a show in the editor.
2. Click "Add scripture".
3. Type `John 3:16-18`, leave KJV selected, click Continue. Confirm three slides appear (each verse is short, fits on one slide).
4. Type `Foobar 1:1`. Confirm an inline error "Unknown book…" appears and Continue is disabled.
5. Back to a real reference, complete step 2: pick any existing template that has a `text` field, click Save. Confirm a new scripture row appears in the rundown.
6. Select the new row. The take strip appears. Confirm clicking a slide button takes the slide onto the configured channel (visible in the renderer at `http://localhost:3001/?channel=program` if a `program` channel is open).
7. Save the show JSON (existing save flow). Reload the page. Confirm the scripture row persists, and confirm `data/shows/<id>.json` contains a `kind: "scripture"` entry that round-trips through `ShowSchema`.

If the take doesn't render, the most likely cause is a field-key mismatch — the chosen template doesn't declare a `text` field. The fallback path is to use a graphic template that already has a `text` field for this smoke test. Don't restructure templates; just confirm field-key matching works on a known-good template.

- [ ] **Step 7: Commit**

```bash
git add apps/operator/src/app/components/ScriptureTakeStrip.tsx apps/operator/src/app/components/Rundown.tsx apps/operator/src/app/shows/edit/page.tsx
git commit -m "feat(operator): render scripture rows and add take strip"
```

---

## Phase F — Polish, validation, and docs

### Task F1: Server-side end-to-end smoke test

**Files:**
- Create: `server/src/scripture.e2e.test.ts`

A higher-level test that exercises the same path the operator uses, using the real bundled provider through the real registry. This catches integration regressions that the unit tests miss.

- [ ] **Step 1: Write the test**

`server/src/scripture.e2e.test.ts`:

```ts
import { describe, expect, it, beforeAll } from "vitest";
import Fastify from "fastify";
import { initScripture, registerScriptureRoutes } from "./scripture";

let app: ReturnType<typeof Fastify>;

beforeAll(async () => {
  await initScripture();
  app = Fastify();
  await registerScriptureRoutes(app);
  await app.ready();
});

describe("scripture e2e", () => {
  it("returns John 3:16 KJV with attribution", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/scripture/passage?ref=John+3:16&translation=KJV",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.verses[0].text.toLowerCase()).toContain("god so loved");
    expect(body.attribution).toMatch(/Public Domain/i);
  });

  it("returns a multi-passage list in order", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/scripture/passage?ref=Rom+8:28%3B+1+Cor+13:4&translation=KJV",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const flat = body.verses.map(
      (v: { book: string; chapter: number; verse: number }) =>
        `${v.book} ${v.chapter}:${v.verse}`,
    );
    expect(flat).toEqual(["ROM 8:28", "1CO 13:4"]);
  });

  it("returns 400 on cross-chapter range with descending end", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/scripture/passage?ref=John+4:2-3:16&translation=KJV",
    });
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run**

Run: `pnpm --filter server test scripture`
Expected: all unit and e2e cases pass.

- [ ] **Step 3: Commit**

```bash
git add server/src/scripture.e2e.test.ts
git commit -m "test(server): scripture e2e through real registry"
```

---

### Task F2: README + spec status update

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-05-15-scripture-integration-design.md`

- [ ] **Step 1: Update `README.md`**

Add a `## Scripture` section after `## Companion integration`:

```markdown
## Scripture

Scripture rundown rows pull verse text from translations registered in
the server's `ScriptureProvider` registry. Public-domain KJV and WEB
ship bundled in `@overlaysys/scripture` (always available, fully
offline). To add a licensed translation (NIV, ESV, NLT, …) implement
the `ScriptureProvider` interface and register it in
`server/src/scripture.ts:initScripture()`.

See the design spec at `docs/superpowers/specs/2026-05-15-scripture-integration-design.md`.
```

- [ ] **Step 2: Update the spec status header**

Edit `docs/superpowers/specs/2026-05-15-scripture-integration-design.md`. Change:

```
Status: design approved — pending implementation plan
```

to:

```
Status: implemented (v1)
```

- [ ] **Step 3: Run the full test matrix once**

Run: `pnpm -r test`
Expected: green across `@overlaysys/scripture`, `@overlaysys/core`, `server`, `@overlaysys/operator`.

Run: `pnpm -r typecheck`
Expected: green across the workspace.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/superpowers/specs/2026-05-15-scripture-integration-design.md
git commit -m "docs: mark scripture integration v1 implemented"
```

---

## Done

Scripture rundown rows are now a first-class row kind:

- Free, offline, fully-bundled KJV + WEB out of the box.
- Server-mediated `ScriptureProvider` registry — licensed translations slot in behind the same interface.
- Reference parser handles single, range, cross-chapter, and multi-passage references.
- Auto-split slide budget with operator-driven boundary edits.
- Field-mapping convention (`text`, `reference`, `translation`, `attribution`) — works with any user-designed template that exposes those keys.
- Row data is self-contained: once embedded in a show, on-air rendering doesn't depend on the provider.
