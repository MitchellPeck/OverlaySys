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
