import { mapPcoItemFields, type Field, type PcoPlanItem } from "@overlaysys/core";

/**
 * Recompute a graphic row's field values for a (possibly new) template.
 *
 * Everything is re-derived from the PCO plan item, then the values the
 * operator typed by hand are layered back on top — but only for keys the new
 * template actually declares. Auto-filled values from the previous template
 * are intentionally dropped: they were derived, not chosen, and their keys
 * are meaningless to the new template.
 */
export function refillItemFields(opts: {
  item: PcoPlanItem;
  templateFields: Field[];
  data: Record<string, string>;
  edited: ReadonlySet<string>;
}): Record<string, string> {
  const next = mapPcoItemFields(opts.item, opts.templateFields);
  const declared = new Set(opts.templateFields.map((f) => f.key));
  for (const key of opts.edited) {
    if (!declared.has(key)) continue;
    const value = opts.data[key];
    if (value === undefined) continue;
    next[key] = value;
  }
  return next;
}
