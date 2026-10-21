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

  unregister(provider: ScriptureProvider): void {
    const idx = this.providers.indexOf(provider);
    if (idx < 0) return;
    this.providers.splice(idx, 1);
    for (const t of provider.translations) {
      if (this.byTranslation.get(t.id) === provider) this.byTranslation.delete(t.id);
    }
  }

  providerFor(translationId: string): ScriptureProvider | null {
    return this.byTranslation.get(translationId) ?? null;
  }

  listTranslations(): TranslationMeta[] {
    return this.providers.flatMap((p) => [...p.translations]);
  }
}
