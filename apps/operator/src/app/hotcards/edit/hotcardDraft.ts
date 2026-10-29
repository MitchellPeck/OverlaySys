import type { Hotcard, TemplateMeta } from "@overlaysys/core";
import { templatesFor } from "../../../lib/templateRoles";

export const LAST_HOTCARD_TEMPLATE_KEY = "overlaysys:hotcards:lastTemplate";

/**
 * Templates for a hotcard's template picker: graphics first, lyric and
 * scripture templates under "others". The default is the last used template
 * when it is a suggestion, else the first suggested one.
 */
export function templatesForHotcard(
  metas: TemplateMeta[],
  lastUsedId?: string,
): { suggested: TemplateMeta[]; others: TemplateMeta[]; defaultId?: string } {
  const { suggested, others } = templatesFor(metas, "graphic", lastUsedId ? [lastUsedId] : []);
  const defaultId =
    lastUsedId && suggested.some((t) => t.id === lastUsedId) ? lastUsedId : suggested[0]?.id;
  return { suggested, others, defaultId };
}

function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) out[k] = canon(x);
    }
    return out;
  }
  return v;
}

/**
 * Dirty check for a hotcard draft. Key order and undefined-vs-absent do not
 * count; `updatedAt` is the server's stamp, not an edit. A `null` hotkey
 * (deliberately none) stays different from an absent one.
 */
export function hotcardEqual(a: Hotcard, b: Hotcard): boolean {
  const strip = (h: Hotcard) => {
    const { updatedAt: _u, ...rest } = h;
    void _u;
    return JSON.stringify(canon(rest));
  };
  return strip(a) === strip(b);
}
