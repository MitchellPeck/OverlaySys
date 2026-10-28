import type { Section } from "./song";
import { emitSections, inferKind, type RawSection } from "./sectionEmit";
import { stripChords } from "./parsePlainLyrics";

export type ChordProResult = {
  meta: { title?: string; artist?: string; ccliNumber?: string; copyright?: string };
  sections: Section[];
  defaultArrangement: string[];
};

const DIRECTIVE_RE = /^\s*\{\s*([a-zA-Z_]+)\s*(?::\s*(.*?))?\s*\}\s*$/;

export function looksLikeChordPro(text: string): boolean {
  return text.split(/\r\n|\r|\n/).some((l) => DIRECTIVE_RE.test(l));
}

type BlockKind = "verse" | "chorus" | "bridge" | "skip";

const START: Record<string, BlockKind> = {
  start_of_verse: "verse", sov: "verse",
  start_of_chorus: "chorus", soc: "chorus",
  start_of_bridge: "bridge", sob: "bridge",
  start_of_tab: "skip", sot: "skip",
  start_of_grid: "skip", sog: "skip",
};
const END = new Set([
  "end_of_verse", "eov", "end_of_chorus", "eoc", "end_of_bridge", "eob",
  "end_of_tab", "eot", "end_of_grid", "eog",
]);
const HEADER_WORD_RE =
  /^(verse|chorus|bridge|tag|intro|outro|pre[- ]?chorus|interlude|ending|coda)\b/i;

export function parseChordPro(text: string): ChordProResult {
  const meta: ChordProResult["meta"] = {};
  const raw: RawSection[] = [];
  // Order of arrangement entries: a raw index, or a recall of a raw index.
  const order: number[] = [];
  let current: RawSection | null = null;
  let skipping = false;
  let buffer: string[] = [];
  let verseN = 0;
  let lastChorusIdx: number | null = null;

  const flushSlide = () => {
    if (current && buffer.length) current.blocks.push(buffer);
    buffer = [];
  };
  const open = (header: string) => {
    flushSlide();
    current = { header, blocks: [] };
    raw.push(current);
    order.push(raw.length - 1);
    if (inferKind(header) === "chorus") lastChorusIdx = raw.length - 1;
    const vm = /^verse\s+(\d+)$/i.exec(header.trim());
    if (vm) verseN = Math.max(verseN, Number(vm[1]));
  };
  const close = () => {
    flushSlide();
    current = null;
  };

  for (const line of text.split(/\r\n|\r|\n/)) {
    const m = DIRECTIVE_RE.exec(line);
    if (m) {
      const name = (m[1] ?? "").toLowerCase();
      const arg = (m[2] ?? "").trim();
      const start = START[name];
      if (name === "title" || name === "t") meta.title = arg;
      else if (name === "artist") meta.artist = arg;
      else if (name === "ccli") meta.ccliNumber = arg;
      else if (name === "copyright") meta.copyright = arg;
      else if (start === "skip") {
        close();
        skipping = true;
      } else if (start !== undefined) {
        skipping = false;
        let header = arg;
        if (!header) {
          if (start === "verse") header = `Verse ${++verseN}`;
          else header = start === "chorus" ? "Chorus" : "Bridge";
        }
        open(header);
      } else if (END.has(name)) {
        close();
        skipping = false;
      } else if (name === "chorus") {
        // Recall: re-use the most recent chorus.
        close();
        if (lastChorusIdx !== null) order.push(lastChorusIdx);
      } else if (name === "c" || name === "comment") {
        if (HEADER_WORD_RE.test(arg)) {
          skipping = false;
          open(arg);
        }
      }
      continue;
    }
    if (skipping) continue;
    const clean = stripChords(line);
    if (clean === "") {
      flushSlide();
      continue;
    }
    if (!current) open(`Verse ${verseN + 1}`); // lyrics outside any block
    buffer.push(clean);
  }
  flushSlide();

  const emitted = emitSections(raw);
  // emitSections yields one arrangement entry per raw section, in order.
  const defaultArrangement = order.map((i) => emitted.defaultArrangement[i]!);
  const sections = emitted.sections;
  return { meta, sections, defaultArrangement };
}
