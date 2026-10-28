import type { Template } from "@overlaysys/core";

export type SlideField = { key: string; label: string; multiline?: boolean };

/** Text-like fields of a template, in template order. Colour, image and video fields are not slide text. */
export function slideFieldsFor(template: Pick<Template, "fields"> | null | undefined): SlideField[] {
  if (!template) return [{ key: "text", label: "Text", multiline: true }];
  const out: SlideField[] = [];
  for (const f of template.fields) {
    if (f.type === "text") out.push({ key: f.key, label: f.label, multiline: true });
    else if (f.type === "time" || f.type === "number") out.push({ key: f.key, label: f.label, multiline: false });
  }
  return out;
}
