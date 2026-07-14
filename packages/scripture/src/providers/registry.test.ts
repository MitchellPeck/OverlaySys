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
