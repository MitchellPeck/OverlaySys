export type ExportKind = "show" | "song" | "template" | "hotcard";

export interface ExportNameItem {
  name?: string;
  title?: string;
  ccliNumber?: string;
  id: string;
}

const ILLEGAL = /[/\\:*?"<>|]/g;

function clean(s: string | undefined): string {
  return (s ?? "").replace(ILLEGAL, "").replace(/\s+/g, " ").trim();
}

function slug(s: string | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function exportFileName(kind: ExportKind, item: ExportNameItem): string {
  const id = clean(item.id) || "export";
  switch (kind) {
    case "song": {
      const title = clean(item.title) || id;
      const ccli = clean(item.ccliNumber);
      return ccli ? `${title} (CCLI ${ccli}).json` : `${title}.json`;
    }
    case "template":
      return `${slug(item.name) || slug(item.id) || id}.overlaysys-template.json`;
    case "hotcard":
      return `${clean(item.name) || id}.overlaysys-hotcard.json`;
    case "show":
    default:
      return `${clean(item.name) || id}.overlaysys-show.json`;
  }
}
