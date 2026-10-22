export type Span = { text: string; bold?: boolean; italic?: boolean };
export type NotesBlock =
  | { kind: "heading"; level: number; spans: Span[] }
  | { kind: "para"; spans: Span[] }
  | { kind: "list"; ordered: boolean; items: Span[][] };

const EMPH = /(\*\*|__)(.+?)\1|(\*|_)(?!\s)(.+?)(?<!\s)\3/g;

export function parseSpans(text: string): Span[] {
  const out: Span[] = [];
  let last = 0;
  for (const m of text.matchAll(EMPH)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index) });
    if (m[2] !== undefined) out.push({ text: m[2], bold: true });
    else out.push({ text: m[4]!, italic: true });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out.length ? out : [{ text }];
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

export function parseNotesMarkdown(md: string): NotesBlock[] {
  const blocks: NotesBlock[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: Span[][] } | null = null;
  const flushPara = () => {
    if (para.length) blocks.push({ kind: "para", spans: parseSpans(para.join(" ")) });
    para = [];
  };
  const flushList = () => {
    if (list) blocks.push({ kind: "list", ...list });
    list = null;
  };
  for (const raw of md.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const h = HEADING.exec(line);
    const b = BULLET.exec(line);
    const n = NUMBERED.exec(line);
    if (!line.trim()) {
      flushPara();
      flushList();
    } else if (h) {
      flushPara();
      flushList();
      blocks.push({ kind: "heading", level: h[1]!.length, spans: parseSpans(h[2]!) });
    } else if (b || n) {
      flushPara();
      const ordered = !!n;
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
      list.items.push(parseSpans((b ?? n)![1]!));
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return blocks;
}
