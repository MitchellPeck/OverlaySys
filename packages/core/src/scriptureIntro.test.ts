import { describe, expect, it } from "vitest";
import type { ScriptureRow } from "./show";
import {
  hasScriptureIntro,
  introTemplateIdFor,
  resolveScriptureIntro,
  scriptureFieldValues,
  suggestScriptureFieldMap,
} from "./scriptureIntro";
import { interpolateWith } from "./songResolution";

const row = (extra: Partial<ScriptureRow> = {}): ScriptureRow =>
  ({
    kind: "scripture",
    id: "s1",
    reference: "John 3:16-21",
    translation: "NIV",
    translationAbbreviation: "NIV",
    attribution: "© Biblica",
    slides: [{ id: "slide-0", verses: [{ book: "JHN", chapter: 3, verse: 16, text: "For God" }] }],
    templateId: "body",
    ...extra,
  }) as ScriptureRow;

const tpl = {
  id: "intro",
  fields: [
    { key: "title", default: "T" },
    { key: "subtitle", default: "S" },
    { key: "extra", default: "keep-me" },
  ],
};
const ctx = { bookName: "John", translationName: "New International Version" };

describe("scriptureFieldValues", () => {
  it("exposes the five scripture fields", () => {
    expect(scriptureFieldValues(row(), ctx)).toEqual({
      reference: "John 3:16-21",
      book: "John",
      translation: "NIV",
      translationName: "New International Version",
      attribution: "© Biblica",
    });
  });

  it("falls back to the translation id when there is no abbreviation", () => {
    expect(scriptureFieldValues(row({ translationAbbreviation: undefined, translation: "KJV" }), {}).translation).toBe("KJV");
  });
});

describe("resolveScriptureIntro", () => {
  it("uses the settings default when the row sets nothing", () => {
    const out = resolveScriptureIntro(
      row(),
      { introTemplateId: "intro", introFieldMap: { title: "reference", subtitle: "translation" } },
      [tpl],
      ctx,
    );
    expect(out).toEqual({ templateId: "intro", fieldValues: { title: "John 3:16-21", subtitle: "NIV", extra: "keep-me" } });
  });

  it("row overrides each piece independently", () => {
    const out = resolveScriptureIntro(
      row({ introFieldLiterals: { title: "{book} — {translationName}" } }),
      { introTemplateId: "intro", introFieldMap: { subtitle: "attribution" } },
      [tpl],
      ctx,
    );
    expect(out!.fieldValues).toEqual({ title: "John — New International Version", subtitle: "© Biblica", extra: "keep-me" });
  });

  it("unmapped template fields get their default (Review Focus 1)", () => {
    const out = resolveScriptureIntro(row(), { introTemplateId: "intro" }, [tpl], ctx);
    expect(out!.fieldValues).toEqual({ title: "T", subtitle: "S", extra: "keep-me" });
  });

  it("skipIntro, no template anywhere, or unknown template → null", () => {
    expect(resolveScriptureIntro(row({ skipIntro: true }), { introTemplateId: "intro" }, [tpl], ctx)).toBeNull();
    expect(resolveScriptureIntro(row(), {}, [tpl], ctx)).toBeNull();
    expect(resolveScriptureIntro(row({ introTemplateId: "nope" }), {}, [tpl], ctx)).toBeNull();
  });

  it("introTemplateIdFor / hasScriptureIntro follow the same rules", () => {
    expect(introTemplateIdFor(row(), { introTemplateId: "d" })).toBe("d");
    expect(introTemplateIdFor(row({ introTemplateId: "r" }), { introTemplateId: "d" })).toBe("r");
    expect(introTemplateIdFor(row({ skipIntro: true }), { introTemplateId: "d" })).toBeNull();
    expect(hasScriptureIntro(row(), {})).toBe(false);
  });
});

describe("helpers", () => {
  it("interpolateWith substitutes, escapes and blanks unknown keys", () => {
    const look = (k: string) => ({ a: "1" } as Record<string, string>)[k];
    expect(interpolateWith("x{a}y{{z}}{nope}", look)).toBe("x1y{z}");
    expect(interpolateWith("open {a", look)).toBe("open {a");
  });

  it("suggestScriptureFieldMap matches a 'reference' field exactly", () => {
    const s = suggestScriptureFieldMap([
      { key: "reference", label: "Reference", type: "text" },
      { key: "foo", label: "Translation", type: "text" },
    ]);
    expect(s.reference).toEqual({ kind: "exact", songFieldKey: "reference" });
    expect(s.foo).toEqual({ kind: "suggested", songFieldKey: "translation" });
  });

  it("suggestScriptureFieldMap aliases title-like to reference and subtitle-like to translation", () => {
    const s = suggestScriptureFieldMap([
      { key: "title", label: "Title", type: "text" },
      { key: "subtitle", label: "Subtitle", type: "text" },
    ]);
    expect(s.title).toEqual({ kind: "suggested", songFieldKey: "reference" });
    expect(s.subtitle).toEqual({ kind: "suggested", songFieldKey: "translation" });
  });

  it("suggestScriptureFieldMap alias matches by label and only the first title-like claims reference", () => {
    const s = suggestScriptureFieldMap([
      { key: "a", label: " Heading ", type: "text" },
      { key: "b", label: "Name", type: "text" },
    ]);
    expect(s.a).toEqual({ kind: "suggested", songFieldKey: "reference" });
    expect(s.b?.songFieldKey).not.toBe("reference"); // falls through to the generic matcher
  });

  it("suggestScriptureFieldMap does not let an alias steal a field claimed by an exact key", () => {
    const s = suggestScriptureFieldMap([
      { key: "title", label: "Title", type: "text" },
      { key: "reference", label: "Reference", type: "text" },
    ]);
    expect(s.reference).toEqual({ kind: "exact", songFieldKey: "reference" });
    expect(s.title).toEqual({ kind: "none" });
  });
});
