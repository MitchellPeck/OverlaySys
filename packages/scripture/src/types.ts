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
