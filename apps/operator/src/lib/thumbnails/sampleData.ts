import type { Template } from "@overlaysys/core";

/** Placeholder field values so a template thumbnail shows its design pose. */
export function sampleData(template: Pick<Template, "fields">): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of template.fields) {
    if (f.default) {
      out[f.key] = f.default;
      continue;
    }
    switch (f.type) {
      case "text":
        out[f.key] = f.label;
        break;
      case "time":
        out[f.key] = "10:00";
        break;
      case "number":
        out[f.key] = "0";
        break;
      case "color":
        out[f.key] = "#ffffff";
        break;
      default:
        out[f.key] = "";
    }
  }
  return out;
}
