import { z } from "zod";

/** Long-form speaker notes attached to a show; split into points for the confidence monitor. */
const SermonNotesObject = z.object({
  id: z.string(),
  title: z.string(),
  /** Markdown. Headings (any level) start points; without headings, blank-line blocks do. */
  body: z.string(),
  updatedAt: z.string().optional(),
});
export type SermonNotes = z.infer<typeof SermonNotesObject>;
// Passthrough (contracts §4): unknown keys from a newer build survive a re-save.
export const SermonNotesSchema = SermonNotesObject.passthrough() as unknown as z.ZodType<SermonNotes, z.ZodTypeDef, unknown>;

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

const H1 = /^#\s+(.*)$/;
const H2_PLUS = /^#{2,6}\s+/;

/** Index of a leading H1 that titles the notes (first non-blank line is an H1 and an H2+ follows), else -1. */
function titleLineIndex(lines: string[]): number {
  const i = lines.findIndex((l) => l.trim());
  if (i < 0 || !H1.test(lines[i]!)) return -1;
  return lines.slice(i + 1).some((l) => H2_PLUS.test(l)) ? i : -1;
}

/** Text of the leading H1 when it acts as the notes' title (H2s follow it), else null. */
export function titleFromMarkdown(md: string): string | null {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const i = titleLineIndex(lines);
  if (i < 0) return null;
  const t = lines[i]!.replace(H1, "$1").replace(/(\*\*|__|\*|_|`)/g, "").trim();
  return t || null;
}

export function splitPoints(body: string): NotesPoint[] {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const ti = titleLineIndex(lines);
  if (ti >= 0) lines.splice(ti, 1);
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
