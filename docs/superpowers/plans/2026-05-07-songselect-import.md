# CCLI SongSelect Lyrics Import — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a parser + UI affordances so an operator can import a CCLI SongSelect lyrics file (.txt) or ChordPro file (.txt/.cho) and get a populated Song record in one step.

**Architecture:** Pure-function parser in `packages/core` (shares helpers with the existing `songParser.ts`). Two operator-app touchpoints: an `Import from file…` button on the songs library page that opens a confirm modal, and an extension to the existing `Paste lyrics…` modal in the song editor that accepts file drops + auto-detects format + optionally updates metadata. No data-model changes, no WS protocol changes.

**Tech Stack:** TypeScript, Vitest, Zod, React (Next.js operator app), Zustand store, existing WS `save_song` message.

**Spec:** [`docs/superpowers/specs/2026-05-07-songselect-import-design.md`](../specs/2026-05-07-songselect-import-design.md)

**Important: copyrighted-lyrics caution.** Worship song lyrics, the SongSelect® terms-of-use trailer, and CCLI footer boilerplate are copyrighted. Test fixtures must be either:
- Public-domain hymns (e.g. "Amazing Grace" — original Newton verses, not the Chris Tomlin "My Chains Are Gone" addition), OR
- Hand-fabricated synthetic content that mimics the *shape* of a SongSelect download without reproducing copyrighted lines.

Do not paste real copyrighted SongSelect output into committed fixtures. The implementer working from this plan will hand-write fixtures whose **structure** matches a real SongSelect file, using public-domain or fabricated lyrics. The exact regex patterns the parser keys on are listed below — the fixtures only need to exhibit those patterns.

---

## File Map

**Created:**
- `packages/core/src/songSelectParser.ts` — new parser
- `packages/core/src/songSelectParser.test.ts` — parser unit tests
- `packages/core/src/sectionEmit.ts` — shared section-emit helpers extracted from `songParser.ts`
- `packages/core/src/sectionEmit.test.ts` — light tests for the extracted helpers
- `packages/core/src/__fixtures__/songselect/amazing-grace.txt`
- `packages/core/src/__fixtures__/songselect/amazing-grace.cho`
- `packages/core/src/__fixtures__/songselect/no-footer.txt`
- `packages/core/src/__fixtures__/songselect/bare-headers.txt`
- `packages/core/src/__fixtures__/songselect/multi-author.txt`
- `packages/core/src/__fixtures__/songselect/dual-title.txt`
- `packages/core/src/__fixtures__/songselect/malformed.txt`
- `apps/operator/src/app/songs/ImportFromFileModal.tsx` — new component
- `apps/operator/src/app/songs/PasteLyricsModal.tsx` — extracted from inline JSX in editor page; gains file-drop + auto-detect

**Modified:**
- `packages/core/src/songParser.ts` — extract helpers into `sectionEmit.ts`, keep public API unchanged
- `packages/core/src/index.ts` — export new parser + types
- `apps/operator/src/app/songs/page.tsx` — add `Import from file…` button wiring
- `apps/operator/src/app/songs/[id]/page.tsx` — replace inline paste UI with `PasteLyricsModal` import

**No changes:**
- WS protocol — uses existing `save_song`
- Server — no server changes
- Renderer — no renderer changes
- `Song` schema — unchanged

---

## Phase 1 — Parser Foundation (TDD)

### Task 1: Extract shared section-emit helpers from `songParser.ts` (no behavior change)

**Why:** The new parser needs the same kind-inference, id-generation, and slide-emission logic. Extract it so both parsers share one implementation.

**Files:**
- Create: `packages/core/src/sectionEmit.ts`
- Create: `packages/core/src/sectionEmit.test.ts`
- Modify: `packages/core/src/songParser.ts`

- [ ] **Step 1: Read the current `songParser.ts`**

Run: `cat packages/core/src/songParser.ts` — confirm the functions you'll extract: `inferKind`, `generateId`, the slide-emission block inside `parseSongFromText`, and the `RawSection` interface.

- [ ] **Step 2: Write the new module `sectionEmit.ts`**

Create `packages/core/src/sectionEmit.ts` with the extracted code:

```ts
import type { Section, SectionKind, Slide } from "./song";

export interface RawSection {
  header: string;
  blocks: string[][]; // each block = lines of one slide
}

const KIND_KEYWORDS: { kind: SectionKind; keywords: string[] }[] = [
  // Order matters: more specific kinds first.
  { kind: "chorus", keywords: ["chorus"] },
  { kind: "verse", keywords: ["verse"] },
  { kind: "bridge", keywords: ["bridge"] },
  { kind: "tag", keywords: ["tag"] },
  { kind: "intro", keywords: ["intro"] },
  { kind: "outro", keywords: ["outro"] },
];

export function inferKind(header: string): SectionKind {
  const lower = header.toLowerCase();
  for (const { kind, keywords } of KIND_KEYWORDS) {
    if (keywords.some((kw) => new RegExp(`\\b${kw}\\b`).test(lower))) {
      if (lower.startsWith("pre-") || lower.startsWith("post-")) {
        return "other";
      }
      return kind;
    }
  }
  return "other";
}

const ID_PREFIX: Record<SectionKind, string> = {
  verse: "v", chorus: "c", bridge: "b", tag: "t",
  intro: "i", outro: "o", other: "x",
};

export function generateSectionId(
  kind: SectionKind,
  kindCounts: Map<SectionKind, number>,
): string {
  const n = (kindCounts.get(kind) ?? 0) + 1;
  kindCounts.set(kind, n);
  return `${ID_PREFIX[kind]}${n}`;
}

export function emitSections(raw: RawSection[]): {
  sections: Section[];
  defaultArrangement: string[];
} {
  const kindCounts = new Map<SectionKind, number>();
  const sections: Section[] = raw.map((rs) => {
    const kind = inferKind(rs.header);
    const sid = generateSectionId(kind, kindCounts);
    const slides: Slide[] =
      rs.blocks.length === 0
        ? [{ id: `${sid}s1`, lines: [""] }]
        : rs.blocks.map((lines, i) => ({ id: `${sid}s${i + 1}`, lines }));
    return { id: sid, kind, label: rs.header, slides };
  });
  return { sections, defaultArrangement: sections.map((s) => s.id) };
}
```

- [ ] **Step 3: Write a test for the extracted helpers**

Create `packages/core/src/sectionEmit.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { emitSections, inferKind, generateSectionId } from "./sectionEmit";

describe("inferKind", () => {
  it("recognizes core kinds", () => {
    expect(inferKind("Verse 1")).toBe("verse");
    expect(inferKind("Chorus")).toBe("chorus");
    expect(inferKind("Bridge")).toBe("bridge");
    expect(inferKind("Tag")).toBe("tag");
    expect(inferKind("Intro")).toBe("intro");
    expect(inferKind("Outro")).toBe("outro");
  });
  it("treats Pre-Chorus and Post-Chorus as other", () => {
    expect(inferKind("Pre-Chorus")).toBe("other");
    expect(inferKind("Post-Chorus")).toBe("other");
  });
  it("falls back to other for unknown labels", () => {
    expect(inferKind("Vamp")).toBe("other");
  });
});

describe("generateSectionId", () => {
  it("counts per kind", () => {
    const counts = new Map();
    expect(generateSectionId("verse", counts)).toBe("v1");
    expect(generateSectionId("verse", counts)).toBe("v2");
    expect(generateSectionId("chorus", counts)).toBe("c1");
  });
});

describe("emitSections", () => {
  it("emits sections with stable ids and default arrangement", () => {
    const out = emitSections([
      { header: "Verse 1", blocks: [["a", "b"]] },
      { header: "Chorus", blocks: [["c"]] },
      { header: "Verse 2", blocks: [["d"]] },
    ]);
    expect(out.sections.map((s) => s.id)).toEqual(["v1", "c1", "v2"]);
    expect(out.defaultArrangement).toEqual(["v1", "c1", "v2"]);
  });
  it("emits one empty slide for sections with no blocks", () => {
    const out = emitSections([{ header: "Verse 1", blocks: [] }]);
    expect(out.sections[0]!.slides).toEqual([{ id: "v1s1", lines: [""] }]);
  });
});
```

- [ ] **Step 4: Run the new tests to verify they pass on the new module**

Run: `pnpm --filter @overlaysys/core test sectionEmit`
Expected: all tests in `sectionEmit.test.ts` pass.

- [ ] **Step 5: Refactor `songParser.ts` to use the extracted helpers**

Replace the contents of `packages/core/src/songParser.ts` with:

```ts
import { SongSchema, type Song } from "./song";
import { emitSections, type RawSection } from "./sectionEmit";

const HEADER_RE = /^\s*\[(.+?)\]\s*$/;

function tokenize(text: string): RawSection[] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n");
  const sections: RawSection[] = [];
  let current: RawSection | null = null;
  let buffer: string[] = [];

  function flushSlide() {
    if (!current) return;
    if (buffer.length === 0) return;
    current.blocks.push(buffer);
    buffer = [];
  }

  for (const line of lines) {
    const m = HEADER_RE.exec(line);
    if (m) {
      flushSlide();
      if (current) sections.push(current);
      current = { header: (m[1] ?? "").trim(), blocks: [] };
      buffer = [];
      continue;
    }
    if (line.trim() === "") {
      flushSlide();
      continue;
    }
    if (!current) continue;
    buffer.push(line);
  }
  flushSlide();
  if (current) sections.push(current);
  return sections;
}

export function parseSongFromText(
  id: string,
  title: string,
  text: string,
): Song {
  const raw = tokenize(text);
  if (raw.length === 0) {
    throw new Error("song text contains no [Section] headers");
  }
  const { sections, defaultArrangement } = emitSections(raw);
  return SongSchema.parse({ id, title, sections, defaultArrangement });
}
```

- [ ] **Step 6: Run all core tests to confirm no regressions**

Run: `pnpm --filter @overlaysys/core test`
Expected: every test passes — including the existing `songParser.test.ts` (unchanged).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/sectionEmit.ts packages/core/src/sectionEmit.test.ts packages/core/src/songParser.ts
git commit -m "refactor(core): extract sectionEmit helpers from songParser"
```

---

### Task 2: Create `songSelectParser.ts` skeleton + slugify utility

**Why:** Set up the module surface, types, and the `slugify` helper the import UI will need. No real parsing logic yet — that comes in subsequent tasks.

**Files:**
- Create: `packages/core/src/songSelectParser.ts`
- Create: `packages/core/src/songSelectParser.test.ts`

- [ ] **Step 1: Write a failing test for the public surface and slugify**

Create `packages/core/src/songSelectParser.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseSongSelectText, slugifyTitle } from "./songSelectParser";

describe("slugifyTitle", () => {
  it("lowercases and hyphenates", () => {
    expect(slugifyTitle("Amazing Grace")).toBe("amazing-grace");
  });
  it("collapses runs of non-alphanumerics", () => {
    expect(slugifyTitle("Amazing Grace!! (Newton)")).toBe(
      "amazing-grace-newton",
    );
  });
  it("strips diacritics", () => {
    expect(slugifyTitle("Café Olé")).toBe("cafe-ole");
  });
  it("falls back to 'untitled' for empty input", () => {
    expect(slugifyTitle("   ")).toBe("untitled");
    expect(slugifyTitle("")).toBe("untitled");
  });
});

describe("parseSongSelectText (skeleton)", () => {
  it("throws on empty input", () => {
    expect(() => parseSongSelectText("")).toThrow();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails (module not found)**

Run: `pnpm --filter @overlaysys/core test songSelectParser`
Expected: FAIL — `Cannot find module './songSelectParser'`.

- [ ] **Step 3: Implement the skeleton**

Create `packages/core/src/songSelectParser.ts`:

```ts
import type { Section } from "./song";

export interface SongSelectMeta {
  title?: string;
  authors?: string[];
  ccliNumber?: string;
  copyright?: string;
}

export interface SongSelectParseResult {
  meta: SongSelectMeta;
  sections: Section[];
  defaultArrangement: string[];
}

export function slugifyTitle(input: string): string {
  const slug = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritical marks (NFKD remnants)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "untitled";
}

export function parseSongSelectText(_text: string): SongSelectParseResult {
  throw new Error("parseSongSelectText: not yet implemented");
}
```

- [ ] **Step 4: Run tests to verify the skeleton tests pass**

Run: `pnpm --filter @overlaysys/core test songSelectParser`
Expected: all four `slugifyTitle` tests pass; the `parseSongSelectText (skeleton)` test passes (it asserts a throw, and the stub throws).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/songSelectParser.ts packages/core/src/songSelectParser.test.ts
git commit -m "feat(core): songSelectParser skeleton + slugifyTitle util"
```

---

### Task 3: TDD footer detection (split body / footer)

**Why:** The footer is where metadata lives. Splitting it off cleanly is the foundation of every metadata test that follows.

**Files:**
- Modify: `packages/core/src/songSelectParser.ts`
- Modify: `packages/core/src/songSelectParser.test.ts`

- [ ] **Step 1: Add a failing test for `splitFooter`**

Append to `songSelectParser.test.ts`:

```ts
import { _internal } from "./songSelectParser";

describe("_internal.splitFooter", () => {
  it("splits at first 'CCLI Song #' line", () => {
    const lines = [
      "Amazing Grace",
      "",
      "[Verse 1]",
      "Amazing grace how sweet the sound",
      "",
      "CCLI Song # 22025",
      "John Newton",
      "© Public Domain",
    ];
    const out = _internal.splitFooter(lines);
    expect(out.body).toEqual(lines.slice(0, 5));
    expect(out.footer).toEqual(lines.slice(5));
  });

  it("splits at a copyright line if no CCLI marker", () => {
    const lines = [
      "Amazing Grace",
      "",
      "[Verse 1]",
      "foo",
      "© 2026 Some Publisher",
    ];
    const out = _internal.splitFooter(lines);
    expect(out.footer).toEqual(["© 2026 Some Publisher"]);
  });

  it("returns empty footer when no markers present", () => {
    const lines = ["[Verse 1]", "foo", "bar"];
    const out = _internal.splitFooter(lines);
    expect(out.body).toEqual(lines);
    expect(out.footer).toEqual([]);
  });

  it("matches 'For use solely with the SongSelect' as a footer marker", () => {
    const lines = [
      "[Verse 1]",
      "foo",
      "For use solely with the SongSelect Terms of Use.",
    ];
    const out = _internal.splitFooter(lines);
    expect(out.footer).toEqual([lines[2]]);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm --filter @overlaysys/core test songSelectParser`
Expected: FAIL — `_internal` is not exported.

- [ ] **Step 3: Implement `splitFooter` + export `_internal`**

Add to `songSelectParser.ts` (above `parseSongSelectText`):

```ts
const FOOTER_MARKER_RE =
  /^(CCLI Song #|CCLI License #|For use solely with the SongSelect)/i;
const COPYRIGHT_LINE_RE = /^©/;

function splitFooter(lines: string[]): { body: string[]; footer: string[] } {
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i]!.trim();
    if (FOOTER_MARKER_RE.test(t) || COPYRIGHT_LINE_RE.test(t)) {
      return { body: lines.slice(0, i), footer: lines.slice(i) };
    }
  }
  return { body: lines, footer: [] };
}

export const _internal = { splitFooter };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @overlaysys/core test songSelectParser`
Expected: all `splitFooter` tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/songSelectParser.ts packages/core/src/songSelectParser.test.ts
git commit -m "feat(core): songSelect footer detection (splitFooter)"
```

---

### Task 4: TDD metadata extraction from footer (CCLI #, copyright, authors) + license-leak guard

**Why:** This is the real value of file import — auto-filling the metadata fields. The license-leak guard is a security/privacy invariant (CCLI License # identifies the importing org and must not be retained).

**Files:**
- Modify: `packages/core/src/songSelectParser.ts`
- Modify: `packages/core/src/songSelectParser.test.ts`

- [ ] **Step 1: Add failing tests for `extractMeta`**

Append to `songSelectParser.test.ts`:

```ts
describe("_internal.extractMeta", () => {
  it("extracts ccliNumber from 'CCLI Song #'", () => {
    const meta = _internal.extractMeta(["Amazing Grace"], [
      "CCLI Song # 22025",
    ]);
    expect(meta.ccliNumber).toBe("22025");
  });

  it("extracts copyright from a © line, preserving the symbol", () => {
    const meta = _internal.extractMeta([], [
      "CCLI Song # 22025",
      "© Public Domain",
    ]);
    expect(meta.copyright).toBe("© Public Domain");
  });

  it("extracts a single author when no | separator present", () => {
    const meta = _internal.extractMeta([], [
      "CCLI Song # 22025",
      "John Newton",
      "© Public Domain",
    ]);
    expect(meta.authors).toEqual(["John Newton"]);
  });

  it("extracts multiple authors split on ' | '", () => {
    const meta = _internal.extractMeta([], [
      "CCLI Song # 4768151",
      "John Newton | Chris Tomlin | Louie Giglio",
      "© 2006 sixsteps Music",
    ]);
    expect(meta.authors).toEqual(["John Newton", "Chris Tomlin", "Louie Giglio"]);
  });

  it("never includes the CCLI License # in any field", () => {
    const meta = _internal.extractMeta([], [
      "CCLI Song # 22025",
      "John Newton",
      "© Public Domain",
      "CCLI License # 9999999",
    ]);
    const all = JSON.stringify(meta);
    expect(all).not.toContain("9999999");
    expect(all).not.toContain("License");
  });

  it("returns undefined fields when footer lacks the markers", () => {
    const meta = _internal.extractMeta([], []);
    expect(meta.ccliNumber).toBeUndefined();
    expect(meta.copyright).toBeUndefined();
    expect(meta.authors).toBeUndefined();
  });
});

describe("_internal.extractTitle", () => {
  it("returns the first non-empty preamble line", () => {
    const preamble = ["", "Amazing Grace", ""];
    expect(_internal.extractTitle(preamble)).toBe("Amazing Grace");
  });
  it("preserves parentheticals in the title", () => {
    expect(
      _internal.extractTitle(["Amazing Grace (My Chains Are Gone)"]),
    ).toBe("Amazing Grace (My Chains Are Gone)");
  });
  it("returns undefined when preamble has no non-empty line", () => {
    expect(_internal.extractTitle([])).toBeUndefined();
    expect(_internal.extractTitle(["", "  "])).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests and confirm they fail (functions not defined)**

Run: `pnpm --filter @overlaysys/core test songSelectParser`
Expected: FAIL — `_internal.extractMeta` and `_internal.extractTitle` are undefined.

- [ ] **Step 3: Implement `extractMeta` and `extractTitle`**

Add to `songSelectParser.ts`:

```ts
const CCLI_SONG_RE = /^CCLI Song #\s*(\d+)/i;
const CCLI_LICENSE_RE = /^CCLI License #/i;

function extractTitle(preamble: string[]): string | undefined {
  for (const raw of preamble) {
    const t = raw.trim();
    if (t) return t;
  }
  return undefined;
}

function extractMeta(preamble: string[], footer: string[]): SongSelectMeta {
  const meta: SongSelectMeta = {};
  const title = extractTitle(preamble);
  if (title) meta.title = title;

  // Track which footer line contains ©, then the line above it (if any) is
  // the author line, when it contains alpha content.
  let copyrightIdx = -1;
  for (let i = 0; i < footer.length; i++) {
    const line = footer[i]!.trim();
    if (CCLI_LICENSE_RE.test(line)) continue; // explicitly ignored
    const ccli = CCLI_SONG_RE.exec(line);
    if (ccli && !meta.ccliNumber) meta.ccliNumber = ccli[1];
    if (line.startsWith("©") && copyrightIdx === -1) {
      copyrightIdx = i;
      meta.copyright = line;
    }
  }

  // Author line: line directly above copyright, if it contains letters.
  if (copyrightIdx > 0) {
    const candidate = footer[copyrightIdx - 1]!.trim();
    const isAuthorish =
      candidate &&
      /[A-Za-z]/.test(candidate) &&
      !CCLI_SONG_RE.test(candidate) &&
      !CCLI_LICENSE_RE.test(candidate);
    if (isAuthorish) {
      meta.authors = candidate.includes(" | ")
        ? candidate.split(" | ").map((s) => s.trim()).filter(Boolean)
        : [candidate];
    }
  }
  return meta;
}
```

Update the `_internal` export at the bottom:

```ts
export const _internal = { splitFooter, extractMeta, extractTitle };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @overlaysys/core test songSelectParser`
Expected: all `extractMeta` / `extractTitle` tests pass, including the license-leak guard.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/songSelectParser.ts packages/core/src/songSelectParser.test.ts
git commit -m "feat(core): songSelect metadata extraction (title, ccli, copyright, authors)"
```

---

### Task 5: TDD ChordPro chord stripping

**Why:** ChordPro files have inline `[G]`, `[Cmaj7]`, `[F#m]`, `[Eb/G]` markers we need to remove without disturbing `[Verse 1]`-style section headers.

**Files:**
- Modify: `packages/core/src/songSelectParser.ts`
- Modify: `packages/core/src/songSelectParser.test.ts`

- [ ] **Step 1: Add failing tests for `stripChords`**

Append to `songSelectParser.test.ts`:

```ts
describe("_internal.stripChords", () => {
  it("removes simple chord markers", () => {
    expect(_internal.stripChords("[G]Amazing [C]grace"))
      .toBe("Amazing grace");
  });
  it("removes complex chord markers", () => {
    expect(_internal.stripChords("[Cmaj7]how [F#m]sweet [Eb/G]the [Bb]sound"))
      .toBe("how sweet the sound");
  });
  it("does NOT remove section header brackets like [Verse 1]", () => {
    expect(_internal.stripChords("[Verse 1]")).toBe("[Verse 1]");
    expect(_internal.stripChords("[Chorus]")).toBe("[Chorus]");
    expect(_internal.stripChords("[Bridge]")).toBe("[Bridge]");
  });
  it("collapses runs of whitespace introduced by stripping", () => {
    expect(_internal.stripChords("[G]   [C]Amazing"))
      .toBe("Amazing");
  });
  it("trims leading/trailing whitespace", () => {
    expect(_internal.stripChords("  [G]hello [C]  ")).toBe("hello");
  });
});
```

- [ ] **Step 2: Run and confirm fail**

Run: `pnpm --filter @overlaysys/core test songSelectParser`
Expected: FAIL — `_internal.stripChords` is undefined.

- [ ] **Step 3: Implement `stripChords`**

Add to `songSelectParser.ts`:

```ts
// Anchored to chord-letter start (A–G with optional accidental). Captures
// the rest of the chord token (qualifiers + optional slash bass) up to the
// next ']'. This deliberately matches [G], [Cmaj7], [F#m7], [Eb/G], [Bb1].
// Does NOT match [Verse 1], [Chorus], [Bridge], etc., because those start
// with letters outside A–G or contain a space.
const CHORD_RE = /\[[A-Ga-g][#b]?[A-Za-z0-9]*(?:\/[A-Ga-g][#b]?)?\]/g;

function stripChords(line: string): string {
  return line
    .replace(CHORD_RE, "")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
```

Update `_internal` export:

```ts
export const _internal = { splitFooter, extractMeta, extractTitle, stripChords };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @overlaysys/core test songSelectParser`
Expected: all `stripChords` tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/songSelectParser.ts packages/core/src/songSelectParser.test.ts
git commit -m "feat(core): songSelect ChordPro chord stripping"
```

---

### Task 6: TDD tolerant header detection (bare-keyword section markers)

**Why:** SongSelect Lyrics (.txt) downloads put section names on their own line without brackets (`Verse 1` not `[Verse 1]`). The tokenizer needs to recognize both shapes.

**Files:**
- Modify: `packages/core/src/songSelectParser.ts`
- Modify: `packages/core/src/songSelectParser.test.ts`

- [ ] **Step 1: Add failing tests for `isHeaderLine` and `tokenizeBody`**

Append to `songSelectParser.test.ts`:

```ts
describe("_internal.isHeaderLine", () => {
  it("recognizes bracketed headers", () => {
    expect(_internal.isHeaderLine("[Verse 1]")).toBe("Verse 1");
    expect(_internal.isHeaderLine("[Chorus]")).toBe("Chorus");
  });
  it("recognizes bare keyword headers", () => {
    expect(_internal.isHeaderLine("Verse 1")).toBe("Verse 1");
    expect(_internal.isHeaderLine("Chorus")).toBe("Chorus");
    expect(_internal.isHeaderLine("Bridge")).toBe("Bridge");
    expect(_internal.isHeaderLine("Pre-Chorus")).toBe("Pre-Chorus");
    expect(_internal.isHeaderLine("Pre Chorus")).toBe("Pre Chorus");
    expect(_internal.isHeaderLine("Tag")).toBe("Tag");
    expect(_internal.isHeaderLine("Intro")).toBe("Intro");
    expect(_internal.isHeaderLine("Outro")).toBe("Outro");
    expect(_internal.isHeaderLine("Interlude")).toBe("Interlude");
    expect(_internal.isHeaderLine("Ending")).toBe("Ending");
    expect(_internal.isHeaderLine("verse 2")).toBe("verse 2");
    expect(_internal.isHeaderLine("Chorus 2")).toBe("Chorus 2");
  });
  it("does NOT match lyric lines that happen to contain a keyword", () => {
    expect(_internal.isHeaderLine("Verse this is a lyric"))
      .toBeNull();
    expect(_internal.isHeaderLine("On Christ the solid rock I stand"))
      .toBeNull();
    expect(_internal.isHeaderLine("Bridge over troubled water"))
      .toBeNull();
  });
  it("returns null for empty and arbitrary lines", () => {
    expect(_internal.isHeaderLine("")).toBeNull();
    expect(_internal.isHeaderLine("Amazing grace how sweet the sound"))
      .toBeNull();
  });
});

describe("_internal.tokenizeBody (mixed bracketed + bare headers)", () => {
  it("tokenizes a mix of bracketed and bare headers", () => {
    const body = [
      "Verse 1",
      "Amazing grace how sweet the sound",
      "That saved a wretch like me",
      "",
      "[Chorus]",
      "My chains are gone (omitted — copyrighted)",
      "",
      "Verse 2",
      "Twas grace that taught my heart to fear",
    ];
    const raw = _internal.tokenizeBody(body);
    expect(raw).toHaveLength(3);
    expect(raw[0]!.header).toBe("Verse 1");
    expect(raw[1]!.header).toBe("Chorus");
    expect(raw[2]!.header).toBe("Verse 2");
    expect(raw[0]!.blocks[0]).toEqual([
      "Amazing grace how sweet the sound",
      "That saved a wretch like me",
    ]);
  });

  it("splits multiple slides on blank line within a section", () => {
    const body = [
      "Verse 1",
      "Line A1",
      "Line A2",
      "",
      "Line B1",
      "Line B2",
    ];
    const raw = _internal.tokenizeBody(body);
    expect(raw[0]!.blocks).toHaveLength(2);
  });

  it("ignores text before any header", () => {
    const raw = _internal.tokenizeBody(["preamble line", "", "Verse 1", "x"]);
    expect(raw).toHaveLength(1);
    expect(raw[0]!.header).toBe("Verse 1");
  });
});
```

- [ ] **Step 2: Run and confirm fail**

Run: `pnpm --filter @overlaysys/core test songSelectParser`
Expected: FAIL — `isHeaderLine` and `tokenizeBody` undefined.

- [ ] **Step 3: Implement `isHeaderLine` and `tokenizeBody`**

Add to `songSelectParser.ts`:

```ts
import type { RawSection } from "./sectionEmit";

const BRACKET_HEADER_RE = /^\s*\[(.+?)\]\s*$/;
const BARE_HEADER_RE =
  /^(verse|chorus|bridge|tag|intro|outro|pre[- ]?chorus|interlude|ending|coda)(\s+\d+)?$/i;

function isHeaderLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const bracket = BRACKET_HEADER_RE.exec(trimmed);
  if (bracket) return (bracket[1] ?? "").trim();
  if (BARE_HEADER_RE.test(trimmed)) return trimmed;
  return null;
}

function tokenizeBody(lines: string[]): RawSection[] {
  const sections: RawSection[] = [];
  let current: RawSection | null = null;
  let buffer: string[] = [];

  function flushSlide() {
    if (!current) return;
    if (buffer.length === 0) return;
    current.blocks.push(buffer);
    buffer = [];
  }

  for (const line of lines) {
    const header = isHeaderLine(line);
    if (header !== null) {
      flushSlide();
      if (current) sections.push(current);
      current = { header, blocks: [] };
      buffer = [];
      continue;
    }
    if (line.trim() === "") {
      flushSlide();
      continue;
    }
    if (!current) continue;
    buffer.push(line);
  }
  flushSlide();
  if (current) sections.push(current);
  return sections;
}
```

Update `_internal`:

```ts
export const _internal = {
  splitFooter,
  extractMeta,
  extractTitle,
  stripChords,
  isHeaderLine,
  tokenizeBody,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @overlaysys/core test songSelectParser`
Expected: all header / tokenize tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/songSelectParser.ts packages/core/src/songSelectParser.test.ts
git commit -m "feat(core): tolerant SongSelect header detection (bracketed + bare)"
```

---

### Task 7: Wire it all together — implement `parseSongSelectText`

**Why:** Now that all the helpers are tested in isolation, compose them into the public function and verify end-to-end behavior on inline test inputs (no fixture files yet — those come in Task 8).

**Files:**
- Modify: `packages/core/src/songSelectParser.ts`
- Modify: `packages/core/src/songSelectParser.test.ts`

- [ ] **Step 1: Replace the skeleton test for `parseSongSelectText` with end-to-end tests**

In `songSelectParser.test.ts`, **remove** the existing `parseSongSelectText (skeleton)` describe block and **add** in its place:

```ts
describe("parseSongSelectText", () => {
  it("throws when no sections are detected", () => {
    expect(() => parseSongSelectText("just prose, no section header at all"))
      .toThrow(/no sections/i);
    expect(() => parseSongSelectText("")).toThrow(/no sections/i);
  });

  it("parses a complete plain-lyrics file (public-domain Amazing Grace)", () => {
    const text = [
      "Amazing Grace",
      "",
      "Verse 1",
      "Amazing grace how sweet the sound",
      "That saved a wretch like me",
      "",
      "Verse 2",
      "Twas grace that taught my heart to fear",
      "And grace my fears relieved",
      "",
      "CCLI Song # 22025",
      "John Newton",
      "© Public Domain",
      "CCLI License # 9999999",
    ].join("\n");
    const result = parseSongSelectText(text);
    expect(result.meta.title).toBe("Amazing Grace");
    expect(result.meta.ccliNumber).toBe("22025");
    expect(result.meta.authors).toEqual(["John Newton"]);
    expect(result.meta.copyright).toBe("© Public Domain");
    expect(result.sections).toHaveLength(2);
    expect(result.sections[0]!.kind).toBe("verse");
    expect(result.sections[0]!.label).toBe("Verse 1");
    expect(result.sections[0]!.id).toBe("v1");
    expect(result.sections[1]!.id).toBe("v2");
    expect(result.defaultArrangement).toEqual(["v1", "v2"]);
    // License # leak guard
    const all = JSON.stringify(result);
    expect(all).not.toContain("9999999");
    expect(all).not.toContain("License");
  });

  it("parses a ChordPro file by stripping chords from body lines", () => {
    const text = [
      "Amazing Grace",
      "",
      "[Verse 1]",
      "[G]Amazing [C]grace [G]how sweet the [D]sound",
      "[G]That saved [Em]a wretch like [D]me",
      "",
      "CCLI Song # 22025",
      "© Public Domain",
    ].join("\n");
    const result = parseSongSelectText(text);
    expect(result.sections[0]!.slides[0]!.lines).toEqual([
      "Amazing grace how sweet the sound",
      "That saved a wretch like me",
    ]);
  });

  it("preserves a parenthetical title", () => {
    const text = [
      "Amazing Grace (My Chains Are Gone)",
      "",
      "Verse 1",
      "Amazing grace how sweet the sound",
      "",
      "CCLI Song # 4768151",
      "© 2006 sixsteps Music",
    ].join("\n");
    const result = parseSongSelectText(text);
    expect(result.meta.title).toBe("Amazing Grace (My Chains Are Gone)");
  });

  it("parses multiple authors split on ' | '", () => {
    const text = [
      "Build My Life",
      "",
      "Verse 1",
      "Worthy of every song we could ever sing",
      "",
      "CCLI Song # 7070345",
      "Pat Barrett | Brett Younker | Karl Martin | Kirby Kaple | Matt Redman",
      "© 2016 Said And Done Music",
    ].join("\n");
    const result = parseSongSelectText(text);
    expect(result.meta.authors).toEqual([
      "Pat Barrett",
      "Brett Younker",
      "Karl Martin",
      "Kirby Kaple",
      "Matt Redman",
    ]);
  });

  it("succeeds with no footer (meta fields just undefined)", () => {
    const text = [
      "[Verse 1]",
      "Amazing grace how sweet the sound",
    ].join("\n");
    const result = parseSongSelectText(text);
    expect(result.sections).toHaveLength(1);
    expect(result.meta.ccliNumber).toBeUndefined();
    expect(result.meta.copyright).toBeUndefined();
    expect(result.meta.title).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run and confirm fail**

Run: `pnpm --filter @overlaysys/core test songSelectParser`
Expected: FAIL — `parseSongSelectText` still throws "not yet implemented".

- [ ] **Step 3: Implement `parseSongSelectText`**

Replace the body of `parseSongSelectText` in `songSelectParser.ts`:

```ts
import { emitSections } from "./sectionEmit";

export function parseSongSelectText(text: string): SongSelectParseResult {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const allLines = normalized.split("\n");

  const { body, footer } = splitFooter(allLines);

  // Find where the first header is — everything before it is preamble (for title).
  let firstHeaderIdx = -1;
  for (let i = 0; i < body.length; i++) {
    if (isHeaderLine(body[i]!) !== null) {
      firstHeaderIdx = i;
      break;
    }
  }
  const preamble = firstHeaderIdx === -1 ? body : body.slice(0, firstHeaderIdx);
  const bodyAfterPreamble =
    firstHeaderIdx === -1 ? [] : body.slice(firstHeaderIdx);

  // Strip chord markers from non-header body lines.
  const strippedBody = bodyAfterPreamble.map((line) =>
    isHeaderLine(line) !== null ? line : stripChords(line),
  );

  const raw = tokenizeBody(strippedBody);
  if (raw.length === 0) {
    throw new Error("songSelect: no sections detected");
  }

  const meta = extractMeta(preamble, footer);
  const { sections, defaultArrangement } = emitSections(raw);
  return { meta, sections, defaultArrangement };
}
```

(Remove the `throw new Error("parseSongSelectText: not yet implemented")` line.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @overlaysys/core test songSelectParser`
Expected: every `parseSongSelectText` test passes.

- [ ] **Step 5: Run the full core test suite — confirm no regressions**

Run: `pnpm --filter @overlaysys/core test`
Expected: all core tests pass (existing songParser, sectionEmit, songSelectParser).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/songSelectParser.ts packages/core/src/songSelectParser.test.ts
git commit -m "feat(core): parseSongSelectText end-to-end"
```

---

### Task 8: Add fixture files + a fixture-loaded test

**Why:** Inline test strings prove the parser logic. Real-shape files on disk also serve as a quick visual reference for future contributors and exercise the end-to-end path including newline handling. The fixture content is written by the implementer using public-domain or fabricated lyrics — see the "copyrighted-lyrics caution" note at the top of this plan.

**Files:**
- Create: `packages/core/src/__fixtures__/songselect/amazing-grace.txt`
- Create: `packages/core/src/__fixtures__/songselect/amazing-grace.cho`
- Create: `packages/core/src/__fixtures__/songselect/no-footer.txt`
- Create: `packages/core/src/__fixtures__/songselect/malformed.txt`
- Modify: `packages/core/src/songSelectParser.test.ts`

- [ ] **Step 1: Create the fixtures directory**

Run: `mkdir -p packages/core/src/__fixtures__/songselect`

- [ ] **Step 2: Write `amazing-grace.txt` (public-domain Newton verses, SongSelect-style shape)**

Create `packages/core/src/__fixtures__/songselect/amazing-grace.txt`:

```
Amazing Grace

Verse 1
Amazing grace how sweet the sound
That saved a wretch like me

Verse 2
Twas grace that taught my heart to fear
And grace my fears relieved

Verse 3
Through many dangers toils and snares
I have already come

CCLI Song # 22025
John Newton
© Public Domain
CCLI License # 9999999
```

- [ ] **Step 3: Write `amazing-grace.cho` (same song, ChordPro-style)**

Create `packages/core/src/__fixtures__/songselect/amazing-grace.cho`:

```
Amazing Grace

[Verse 1]
[G]Amazing [G/B]grace how [C]sweet the [G]sound
That [G]saved a [Em]wretch like [D]me

[Verse 2]
[G]Twas grace that [G/B]taught my [C]heart to [G]fear
And [G]grace my [Em]fears re[D]lieved

CCLI Song # 22025
John Newton
© Public Domain
```

- [ ] **Step 4: Write `no-footer.txt` (no metadata, just sections)**

Create `packages/core/src/__fixtures__/songselect/no-footer.txt`:

```
[Verse 1]
Amazing grace how sweet the sound
That saved a wretch like me

[Chorus]
How sweet the sound
```

- [ ] **Step 5: Write `malformed.txt` (no headers — must throw)**

Create `packages/core/src/__fixtures__/songselect/malformed.txt`:

```
This file has no section headers at all
just prose lines
that should fail to parse
```

- [ ] **Step 6: Add tests that load fixtures from disk**

Append to `songSelectParser.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
function fixture(name: string): string {
  return readFileSync(
    join(__dirname, "__fixtures__", "songselect", name),
    "utf8",
  );
}

describe("parseSongSelectText (file fixtures)", () => {
  it("parses amazing-grace.txt with extracted metadata", () => {
    const result = parseSongSelectText(fixture("amazing-grace.txt"));
    expect(result.meta.title).toBe("Amazing Grace");
    expect(result.meta.ccliNumber).toBe("22025");
    expect(result.meta.authors).toEqual(["John Newton"]);
    expect(result.meta.copyright).toBe("© Public Domain");
    expect(result.sections).toHaveLength(3);
    expect(result.sections.map((s) => s.id)).toEqual(["v1", "v2", "v3"]);
    expect(JSON.stringify(result)).not.toContain("9999999");
  });

  it("parses amazing-grace.cho with chords stripped", () => {
    const result = parseSongSelectText(fixture("amazing-grace.cho"));
    expect(result.meta.title).toBe("Amazing Grace");
    expect(result.sections[0]!.slides[0]!.lines[0]).not.toContain("[");
    expect(result.sections[0]!.slides[0]!.lines[0]).toMatch(/^Amazing grace/);
  });

  it("parses no-footer.txt and leaves meta fields undefined", () => {
    const result = parseSongSelectText(fixture("no-footer.txt"));
    expect(result.meta.ccliNumber).toBeUndefined();
    expect(result.meta.copyright).toBeUndefined();
    expect(result.sections).toHaveLength(2);
  });

  it("throws on malformed.txt", () => {
    expect(() => parseSongSelectText(fixture("malformed.txt")))
      .toThrow(/no sections/i);
  });
});
```

- [ ] **Step 7: Run fixture tests**

Run: `pnpm --filter @overlaysys/core test songSelectParser`
Expected: all four fixture tests pass.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/__fixtures__ packages/core/src/songSelectParser.test.ts
git commit -m "test(core): songSelect parser fixture files"
```

---

### Task 9: Wire core public exports

**Why:** The operator app imports parser + types from `@overlaysys/core`. Without re-exporting the new module, the import lines in Phase 2 won't compile.

**Files:**
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Add export line**

Edit `packages/core/src/index.ts`. Append:

```ts
export * from "./songSelectParser";
export * from "./sectionEmit";
```

(Place these alongside the existing `export * from "./songParser";` line.)

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @overlaysys/core typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/index.ts
git commit -m "feat(core): export songSelectParser + sectionEmit"
```

---

## Phase 2 — Operator UI

### Task 10: Extract the existing inline paste UI into `PasteLyricsModal.tsx`

**Why:** The editor page currently has the paste modal as inline JSX in `apps/operator/src/app/songs/[id]/page.tsx`. To extend it (file drop, format auto-detect, optional metadata update) cleanly, extract it into its own component first. No behavior change in this task — just structural.

**Files:**
- Create: `apps/operator/src/app/songs/PasteLyricsModal.tsx`
- Modify: `apps/operator/src/app/songs/[id]/page.tsx`

- [ ] **Step 1: Read the current inline paste UI**

Open `apps/operator/src/app/songs/[id]/page.tsx`. The relevant inline code is roughly: the `pasteOpen` / `pasteText` state, the `applyPaste` function, the `Paste lyrics…` button in `<AppHeader actions>`, and the `{pasteOpen && (…)}` JSX block.

- [ ] **Step 2: Write the extracted component**

Create `apps/operator/src/app/songs/PasteLyricsModal.tsx`:

```tsx
"use client";

import { useState } from "react";
import { parseSongFromText, type Song } from "@overlaysys/core";

interface Props {
  song: Song;
  onApply: (patch: Pick<Song, "sections" | "defaultArrangement">) => void;
  onClose: () => void;
}

export function PasteLyricsModal({ song, onApply, onClose }: Props) {
  const [text, setText] = useState("");

  function apply() {
    try {
      const parsed = parseSongFromText(song.id, song.title, text);
      onApply({
        sections: parsed.sections,
        defaultArrangement: parsed.defaultArrangement,
      });
      onClose();
    } catch (err) {
      alert(`Parse failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return (
    <div
      style={{
        marginBottom: 16,
        padding: 12,
        border: "1px solid var(--border)",
        borderRadius: 4,
      }}
    >
      <p style={{ fontSize: 12, color: "var(--text-dim)", margin: "0 0 8px" }}>
        Paste plain text with <code>[Section Name]</code> headers. Blank line = new slide within a section.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={12}
        style={{ width: "100%", fontFamily: "ui-monospace, monospace", fontSize: 12 }}
      />
      <button
        onClick={apply}
        style={{
          padding: "6px 10px",
          background: "var(--accent)",
          color: "#fff",
          border: "1px solid var(--border)",
          borderRadius: 4,
          fontWeight: 600,
          cursor: "pointer",
          fontSize: 12,
        }}
      >
        Replace song body
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Replace the inline paste UI in `[id]/page.tsx`**

In `apps/operator/src/app/songs/[id]/page.tsx`:

1. At the top, add: `import { PasteLyricsModal } from "../PasteLyricsModal";`
2. Remove the local state lines: `const [pasteOpen, setPasteOpen] = useState(false);` and `const [pasteText, setPasteText] = useState("");`
3. Remove the `applyPaste` function definition.
4. Replace `useState<Song | null>` import alone with both `useState` (kept).
5. Wrap with new state: `const [pasteOpen, setPasteOpen] = useState(false);`
6. Replace the inline `{pasteOpen && ( … )}` JSX block with:

```tsx
{pasteOpen && draft && (
  <PasteLyricsModal
    song={draft}
    onApply={(patch) => setDraft((d) => (d ? { ...d, ...patch } : d))}
    onClose={() => setPasteOpen(false)}
  />
)}
```

- [ ] **Step 4: Typecheck the operator app**

Run: `pnpm --filter operator typecheck` (or whatever the operator package script is — check `apps/operator/package.json` for the right name; if there is no `typecheck` script, run `pnpm exec tsc --noEmit -p apps/operator/tsconfig.json`).
Expected: no errors.

- [ ] **Step 5: Manual smoke — open the editor, click Paste lyrics…, paste something with `[Section]` markers, click Replace song body**

Run the operator dev server: `pnpm --filter operator dev` (or `pnpm dev` in the repo root if turbo is set up — check `package.json`'s `dev` script).
Open `/songs/amazing-grace`, click `Paste lyrics…`, paste:

```
[Verse 1]
test line one
test line two
```

Click Replace song body. Confirm the song body updates and the modal closes. Don't save (we're just testing UI).

- [ ] **Step 6: Commit**

```bash
git add apps/operator/src/app/songs/PasteLyricsModal.tsx apps/operator/src/app/songs/[id]/page.tsx
git commit -m "refactor(operator): extract PasteLyricsModal from song editor page"
```

---

### Task 11: Extend `PasteLyricsModal` — file drop + format auto-detect + optional metadata update

**Why:** The whole point. After this task, an operator can drop a SongSelect download onto the existing paste modal and get correct parsing + optional metadata sync.

**Files:**
- Modify: `apps/operator/src/app/songs/PasteLyricsModal.tsx`

- [ ] **Step 1: Add a heuristic detector**

In `PasteLyricsModal.tsx`, near the top of the file, add:

```ts
function looksLikeSongSelect(text: string): boolean {
  // Footer markers
  if (/^CCLI Song #/im.test(text)) return true;
  if (/^For use solely with the SongSelect/im.test(text)) return true;
  if (/^©/m.test(text)) return true;
  // Bare-keyword headers (own line)
  if (/^(verse|chorus|bridge|tag|intro|outro|pre[- ]?chorus|interlude|ending|coda)(\s+\d+)?$/im.test(text))
    return true;
  // ChordPro chord markers (chord-letter anchored)
  if (/\[[A-Ga-g][#b]?[A-Za-z0-9]*(?:\/[A-Ga-g][#b]?)?\]/.test(text)) return true;
  return false;
}
```

- [ ] **Step 2: Update the `Props` to support metadata patches**

Update the `Props` interface and `onApply` signature:

```ts
import {
  parseSongFromText,
  parseSongSelectText,
  type Song,
} from "@overlaysys/core";

type SongPatch =
  & Pick<Song, "sections" | "defaultArrangement">
  & Partial<Pick<Song, "title" | "author" | "ccliNumber" | "copyright">>;

interface Props {
  song: Song;
  onApply: (patch: SongPatch) => void;
  onClose: () => void;
}
```

(Note: `Song.author` exists per the schema in `packages/core/src/song.ts` — it's a single string, so when SongSelect parsing yields an `authors` array we join with `", "` for display.)

- [ ] **Step 3: Add file-drop handlers + metadata-checkbox state**

Replace the body of `PasteLyricsModal` with:

```tsx
export function PasteLyricsModal({ song, onApply, onClose }: Props) {
  const [text, setText] = useState("");
  const [updateMeta, setUpdateMeta] = useState(false);
  const detectedSongSelect = looksLikeSongSelect(text);

  async function readDroppedFile(file: File) {
    const t = await file.text();
    setText(t);
  }

  function onDrop(e: React.DragEvent<HTMLTextAreaElement>) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) readDroppedFile(file);
  }

  function apply() {
    try {
      if (detectedSongSelect) {
        const r = parseSongSelectText(text);
        const patch: SongPatch = {
          sections: r.sections,
          defaultArrangement: r.defaultArrangement,
        };
        if (updateMeta) {
          if (r.meta.title) patch.title = r.meta.title;
          if (r.meta.authors?.length) patch.author = r.meta.authors.join(", ");
          if (r.meta.ccliNumber) patch.ccliNumber = r.meta.ccliNumber;
          if (r.meta.copyright) patch.copyright = r.meta.copyright;
        }
        onApply(patch);
      } else {
        const parsed = parseSongFromText(song.id, song.title, text);
        onApply({
          sections: parsed.sections,
          defaultArrangement: parsed.defaultArrangement,
        });
      }
      onClose();
    } catch (err) {
      alert(`Parse failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return (
    <div
      style={{
        marginBottom: 16,
        padding: 12,
        border: "1px solid var(--border)",
        borderRadius: 4,
      }}
    >
      <p style={{ fontSize: 12, color: "var(--text-dim)", margin: "0 0 8px" }}>
        Paste plain text with <code>[Section Name]</code> headers, or drop a SongSelect <code>.txt</code> /
        ChordPro <code>.cho</code> file. Blank line = new slide within a section.
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        rows={12}
        style={{ width: "100%", fontFamily: "ui-monospace, monospace", fontSize: 12 }}
      />
      {detectedSongSelect && (
        <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-dim)" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              checked={updateMeta}
              onChange={(e) => setUpdateMeta(e.target.checked)}
            />
            Also update title / author / CCLI # / copyright from imported file
          </label>
        </div>
      )}
      <button
        onClick={apply}
        style={{
          marginTop: 8,
          padding: "6px 10px",
          background: "var(--accent)",
          color: "#fff",
          border: "1px solid var(--border)",
          borderRadius: 4,
          fontWeight: 600,
          cursor: "pointer",
          fontSize: 12,
        }}
      >
        Replace song body{detectedSongSelect ? " (SongSelect detected)" : ""}
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Update the editor page to accept the wider patch**

In `apps/operator/src/app/songs/[id]/page.tsx`, update the `onApply` callback so it merges the wider patch onto the draft:

```tsx
{pasteOpen && draft && (
  <PasteLyricsModal
    song={draft}
    onApply={(patch) => setDraft((d) => (d ? { ...d, ...patch } : d))}
    onClose={() => setPasteOpen(false)}
  />
)}
```

(This is the same code as Task 10 step 3 — `{ ...d, ...patch }` already merges any subset of song fields.)

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter operator typecheck` (or `pnpm exec tsc --noEmit -p apps/operator/tsconfig.json` if no script).
Expected: no errors.

- [ ] **Step 6: Manual smoke — drop the fixture file**

Run the operator dev server. Open `/songs/amazing-grace`. Click `Paste lyrics…`. Drag `packages/core/src/__fixtures__/songselect/amazing-grace.txt` from a Finder window onto the textarea. Confirm:
- The textarea fills with the file content.
- A "(SongSelect detected)" suffix appears on the button.
- The "Also update title / author / …" checkbox appears.
- Tick the checkbox, click Replace song body. Confirm the metadata fields update (title, author, CCLI #, copyright).

- [ ] **Step 7: Commit**

```bash
git add apps/operator/src/app/songs/PasteLyricsModal.tsx apps/operator/src/app/songs/[id]/page.tsx
git commit -m "feat(operator): paste-lyrics modal accepts file drop + SongSelect auto-detect"
```

---

### Task 12: Add `ImportFromFileModal` for the songs library page

**Why:** First-class entry point for the new-song-from-file flow. Library page only — duplicate detection comes in the next task.

**Files:**
- Create: `apps/operator/src/app/songs/ImportFromFileModal.tsx`

- [ ] **Step 1: Write the component**

Create `apps/operator/src/app/songs/ImportFromFileModal.tsx`:

```tsx
"use client";

import { useState } from "react";
import {
  parseSongSelectText,
  slugifyTitle,
  type Song,
} from "@overlaysys/core";

interface Props {
  onSubmit: (song: Song) => void;
  onCancel: () => void;
  // Caller supplies the existing song ids so we can avoid slug collisions.
  existingIds: Set<string>;
}

export function ImportFromFileModal({ onSubmit, onCancel, existingIds }: Props) {
  const [parseError, setParseError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [author, setAuthor] = useState("");
  const [ccli, setCcli] = useState("");
  const [copyright, setCopyright] = useState("");
  const [sections, setSections] = useState<Song["sections"]>([]);
  const [arrangement, setArrangement] = useState<string[]>([]);
  const [filename, setFilename] = useState<string>("");

  async function readFile(file: File) {
    setFilename(file.name);
    setParseError(null);
    const text = await file.text();
    try {
      const r = parseSongSelectText(text);
      const t = r.meta.title ?? file.name.replace(/\.[^.]+$/, "");
      setTitle(t);
      setSlug(uniqueSlug(slugifyTitle(t), existingIds));
      setAuthor(r.meta.authors?.join(", ") ?? "");
      setCcli(r.meta.ccliNumber ?? "");
      setCopyright(r.meta.copyright ?? "");
      setSections(r.sections);
      setArrangement(r.defaultArrangement);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : String(err));
      setSections([]);
      setArrangement([]);
    }
  }

  function save() {
    if (!slug || !title || sections.length === 0) {
      setParseError("title, slug, and at least one section are required");
      return;
    }
    const song: Song = {
      id: slug,
      title,
      sections,
      defaultArrangement: arrangement,
    };
    if (author) song.author = author;
    if (ccli) song.ccliNumber = ccli;
    if (copyright) song.copyright = copyright;
    onSubmit(song);
  }

  return (
    <div
      role="dialog"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
    >
      <div
        style={{
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: 16,
          minWidth: 480,
          maxWidth: 720,
          maxHeight: "80vh",
          overflowY: "auto",
        }}
      >
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Import song from file</h2>

        <input
          type="file"
          accept=".txt,.cho"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) readFile(f);
          }}
          style={{ marginBottom: 12 }}
        />

        {parseError && (
          <p style={{ color: "#ef4444", fontSize: 12 }}>
            Parse failed: {parseError}
          </p>
        )}

        {sections.length > 0 && (
          <>
            <Field label="Title" value={title} onChange={setTitle} />
            <Field
              label="Slug"
              value={slug}
              onChange={(v) => setSlug(v.replace(/\s+/g, "-").toLowerCase())}
              hint={existingIds.has(slug) ? "⚠ slug collides with existing song" : undefined}
            />
            <Field label="Author" value={author} onChange={setAuthor} />
            <Field label="CCLI #" value={ccli} onChange={setCcli} />
            <Field label="Copyright" value={copyright} onChange={setCopyright} />
            <p style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 8 }}>
              <strong>{sections.length}</strong> section(s) detected:{" "}
              {sections.map((s) => s.label).join(", ")}
            </p>
            <p style={{ fontSize: 11, color: "var(--text-dim)" }}>
              Loaded from: <code>{filename}</code>
            </p>
          </>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={btn()}>Cancel</button>
          <button
            onClick={save}
            disabled={sections.length === 0 || !slug || !title}
            style={btn("primary")}
          >
            Save song
          </button>
        </div>
      </div>
    </div>
  );
}

function uniqueSlug(base: string, existing: Set<string>): string {
  if (!existing.has(base)) return base;
  let n = 2;
  while (existing.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

function Field({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
}) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <label style={{ width: 100, fontSize: 12, color: "var(--text-dim)" }}>
          {label}
        </label>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{ flex: 1 }}
        />
      </div>
      {hint && (
        <p style={{ fontSize: 11, color: "#f59e0b", marginLeft: 108, marginTop: 2 }}>
          {hint}
        </p>
      )}
    </div>
  );
}

function btn(kind: "default" | "primary" = "default"): React.CSSProperties {
  return {
    padding: "6px 10px",
    background: kind === "primary" ? "var(--accent)" : "var(--panel-2)",
    color: kind === "primary" ? "#fff" : "var(--text)",
    border: "1px solid var(--border)",
    borderRadius: 4,
    fontWeight: 600,
    cursor: "pointer",
    fontSize: 12,
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter operator typecheck`
Expected: no errors. Note this component is not yet referenced anywhere, but it must typecheck on its own.

- [ ] **Step 3: Commit**

```bash
git add apps/operator/src/app/songs/ImportFromFileModal.tsx
git commit -m "feat(operator): ImportFromFileModal component (not yet wired)"
```

---

### Task 13: Wire `Import from file…` button into the songs library page

**Why:** Make the new entry point reachable. Duplicate detection happens here, before the actual save.

**Files:**
- Modify: `apps/operator/src/app/songs/page.tsx`

- [ ] **Step 1: Add the import button + modal state**

In `apps/operator/src/app/songs/page.tsx`:

1. Add imports:

```ts
import { useState } from "react";
import { ImportFromFileModal } from "./ImportFromFileModal";
import type { Song } from "@overlaysys/core";
```

2. Inside the component (after the existing `useStore` lines), add modal state:

```tsx
const [importOpen, setImportOpen] = useState(false);
```

3. Replace the `actions` of `<AppHeader>`:

```tsx
actions={
  <>
    <button onClick={() => setImportOpen(true)} style={btn()}>
      Import from file…
    </button>
    <button onClick={newSong} style={btn("primary")}>+ New Song</button>
  </>
}
```

4. Inside the wrapper `<div style={{ padding: 24 }}>`, after the table, render the modal conditionally:

```tsx
{importOpen && (
  <ImportFromFileModal
    existingIds={new Set(songs.map((s) => s.id))}
    onCancel={() => setImportOpen(false)}
    onSubmit={(song) => handleImportSubmit(song)}
  />
)}
```

5. Add the submit handler with duplicate detection. Above the `return`:

```tsx
function handleImportSubmit(song: Song) {
  // Duplicate-CCLI prompt.
  if (song.ccliNumber) {
    const existing = songs.find((s) => s.ccliNumber === song.ccliNumber && s.id !== song.id);
    if (existing) {
      const choice = window.prompt(
        `A song with CCLI # ${song.ccliNumber} already exists ("${existing.title}", id: ${existing.id}).\n` +
          `Type "replace" to overwrite it, "copy" to import as a new copy, or anything else to cancel.`,
        "copy",
      );
      if (choice === "replace") {
        send({ type: "save_song", song: { ...song, id: existing.id } });
        setImportOpen(false);
        return;
      }
      if (choice === "copy") {
        const baseSlug = song.id;
        let n = 2;
        while (songs.some((s) => s.id === `${baseSlug}-${n}`)) n++;
        send({ type: "save_song", song: { ...song, id: `${baseSlug}-${n}` } });
        setImportOpen(false);
        return;
      }
      // any other input cancels
      return;
    }
  }
  send({ type: "save_song", song });
  setImportOpen(false);
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter operator typecheck`
Expected: no errors.

- [ ] **Step 3: Manual smoke — full happy path**

Run the operator dev server. Open `/songs`. Click `Import from file…`. Pick `packages/core/src/__fixtures__/songselect/amazing-grace.txt`. Confirm:
- Title field reads "Amazing Grace".
- Slug reads "amazing-grace" (note: this collides with the seeded song, so the modal should pre-suffix → "amazing-grace-2").
- Author reads "John Newton", CCLI # reads "22025", copyright reads "© Public Domain".
- "3 section(s) detected: Verse 1, Verse 2, Verse 3" appears.
- Click Save song.

- [ ] **Step 4: Manual smoke — duplicate detection**

Click `Import from file…` again, pick the same file. The slug field starts as `amazing-grace-2` (or `-3` now that one exists). Edit it to `amazing-grace` to force a CCLI duplicate. Click Save song. Confirm the duplicate-CCLI prompt appears. Type `replace`, confirm the existing song's body is overwritten. Type `copy`, confirm a new song is created with a numeric suffix.

- [ ] **Step 5: Manual smoke — malformed file**

Pick `packages/core/src/__fixtures__/songselect/malformed.txt`. Confirm the modal displays "Parse failed: songSelect: no sections detected" inline and the Save button is disabled.

- [ ] **Step 6: Commit**

```bash
git add apps/operator/src/app/songs/page.tsx
git commit -m "feat(operator): wire Import from file… on songs library page"
```

---

### Task 14: Final cross-package check + cleanup

**Why:** Catch any cross-cutting regressions before declaring done. Includes a typecheck of every package, the full test suite, and a final lint pass.

- [ ] **Step 1: Run typecheck across the repo**

Run: `pnpm typecheck` (uses turbo).
Expected: no errors in any package.

- [ ] **Step 2: Run the full test suite**

Run: `pnpm test`
Expected: every test passes — core (existing + new), server (unchanged), any others.

- [ ] **Step 3: Run lint if configured**

Run: `pnpm lint`
Expected: no new lint errors. (If pre-existing errors are present in untracked files, ignore them — only fix anything introduced by this branch.)

- [ ] **Step 4: Manual smoke — final E2E**

Run: `pnpm dev`
Open the operator app. Verify, in order:
1. `/songs` lists the seeded songs. The `Import from file…` button is visible.
2. Drop the `amazing-grace.cho` fixture into Import. Confirm parsed lyrics have no chord brackets.
3. Open the resulting song in the editor. Click `Paste lyrics…`. Drop `amazing-grace.txt` onto the textarea. Confirm the "(SongSelect detected)" suffix and the metadata-update checkbox appear. Tick the box, replace, confirm metadata fields update.
4. Click Save in the editor header. Confirm the song persists (refresh the page).

- [ ] **Step 5: Commit any final cleanup**

If steps 1–3 surfaced issues that needed a fix, commit them now. Otherwise nothing to do.

```bash
git status
# If clean: nothing to commit.
# If dirty: commit as appropriate.
```

---

## Done criteria

All of the following are true:

- `pnpm test` passes.
- `pnpm typecheck` passes.
- An operator can: (a) drop a SongSelect file onto `/songs` → get a fully populated new song; (b) open an existing song's editor, drop a SongSelect file in `Paste lyrics…` → optionally update metadata.
- CCLI # duplicate detection prompts the operator with replace/copy/cancel.
- The CCLI License # never appears in any saved song record (test guard in place).
- The existing `parseSongFromText` and its tests are unchanged in behavior.
- No WS protocol changes; no schema changes.
