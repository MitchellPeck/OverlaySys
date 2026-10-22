import { z } from "zod";

/** Long-form speaker notes attached to a show; split into points for the confidence monitor. */
export const SermonNotesSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** Markdown. Headings (any level) start points; without headings, blank-line blocks do. */
  body: z.string(),
  updatedAt: z.string().optional(),
});
export type SermonNotes = z.infer<typeof SermonNotesSchema>;

export type NotesPoint = { heading: string; markdown: string };

const HEADING = /^#{1,6}\s+(.*)$/;
const HEADING_MAX = 60;

function plainHeading(line: string): string {
  const text = line
    .replace(HEADING, "$1")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
    .replace(/(\*\*|__|\*|_|`)/g, "")
    .trim();
  const clipped = text.length > HEADING_MAX ? text.slice(0, HEADING_MAX - 1) + "…" : text;
  return clipped || "Untitled";
}

function point(lines: string[]): NotesPoint | null {
  while (lines.length && !lines[lines.length - 1]!.trim()) lines.pop();
  while (lines.length && !lines[0]!.trim()) lines.shift();
  if (!lines.length) return null;
  return { heading: plainHeading(lines[0]!), markdown: lines.join("\n") };
}

export function splitPoints(body: string): NotesPoint[] {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const out: NotesPoint[] = [];
  const hasHeadings = lines.some((l) => HEADING.test(l));
  let cur: string[] = [];
  const flush = () => {
    const p = point(cur);
    if (p) out.push(p);
    cur = [];
  };
  for (const line of lines) {
    if (hasHeadings ? HEADING.test(line) : !line.trim()) {
      flush();
      if (hasHeadings) cur.push(line);
    } else {
      cur.push(line);
    }
  }
  flush();
  return out;
}
