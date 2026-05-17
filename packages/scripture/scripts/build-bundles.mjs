// One-shot script. Downloads public-domain KJV + WEB chapter-per-file JSON
// from a known mirror and emits packages/scripture/src/bundles/{kjv,web}.json
// in the BundleFile shape consumed by BundledProvider.
//
// Re-run with: pnpm --filter @overlaysys/scripture build:bundles
//
// Source: https://github.com/wldeh/bible-api (CC0 / public-domain translations)

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "..", "src", "bundles");

const BASE = "https://raw.githubusercontent.com/wldeh/bible-api/main/bibles";

const TRANSLATIONS = [
  {
    sourceId: "en-kjv",
    meta: {
      id: "KJV",
      name: "King James Version",
      abbreviation: "KJV",
      language: "en",
      copyright: "Public Domain",
      isPublicDomain: true,
    },
  },
  {
    sourceId: "en-web",
    meta: {
      id: "WEB",
      name: "World English Bible",
      abbreviation: "WEB",
      language: "en",
      copyright: "Public Domain (World English Bible)",
      isPublicDomain: true,
    },
  },
];

// Mirrors packages/scripture/src/books.ts. Keep in sync.
const BOOKS = [
  ["GEN", "genesis", 50], ["EXO", "exodus", 40], ["LEV", "leviticus", 27],
  ["NUM", "numbers", 36], ["DEU", "deuteronomy", 34], ["JOS", "joshua", 24],
  ["JDG", "judges", 21], ["RUT", "ruth", 4], ["1SA", "1-samuel", 31],
  ["2SA", "2-samuel", 24], ["1KI", "1-kings", 22], ["2KI", "2-kings", 25],
  ["1CH", "1-chronicles", 29], ["2CH", "2-chronicles", 36], ["EZR", "ezra", 10],
  ["NEH", "nehemiah", 13], ["EST", "esther", 10], ["JOB", "job", 42],
  ["PSA", "psalms", 150], ["PRO", "proverbs", 31], ["ECC", "ecclesiastes", 12],
  ["SNG", "song-of-solomon", 8], ["ISA", "isaiah", 66], ["JER", "jeremiah", 52],
  ["LAM", "lamentations", 5], ["EZK", "ezekiel", 48], ["DAN", "daniel", 12],
  ["HOS", "hosea", 14], ["JOL", "joel", 3], ["AMO", "amos", 9],
  ["OBA", "obadiah", 1], ["JON", "jonah", 4], ["MIC", "micah", 7],
  ["NAM", "nahum", 3], ["HAB", "habakkuk", 3], ["ZEP", "zephaniah", 3],
  ["HAG", "haggai", 2], ["ZEC", "zechariah", 14], ["MAL", "malachi", 4],
  ["MAT", "matthew", 28], ["MRK", "mark", 16], ["LUK", "luke", 24],
  ["JHN", "john", 21], ["ACT", "acts", 28], ["ROM", "romans", 16],
  ["1CO", "1-corinthians", 16], ["2CO", "2-corinthians", 13], ["GAL", "galatians", 6],
  ["EPH", "ephesians", 6], ["PHP", "philippians", 4], ["COL", "colossians", 4],
  ["1TH", "1-thessalonians", 5], ["2TH", "2-thessalonians", 3], ["1TI", "1-timothy", 6],
  ["2TI", "2-timothy", 4], ["TIT", "titus", 3], ["PHM", "philemon", 1],
  ["HEB", "hebrews", 13], ["JAS", "james", 5], ["1PE", "1-peter", 5],
  ["2PE", "2-peter", 3], ["1JN", "1-john", 5], ["2JN", "2-john", 1],
  ["3JN", "3-john", 1], ["JUD", "jude", 1], ["REV", "revelation", 22],
];

async function fetchChapter(sourceId, bookSlug, ch) {
  const url = `${BASE}/${sourceId}/books/${bookSlug}/chapters/${ch}.json`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`GET ${url} → ${r.status}`);
  return r.json();
}

async function buildOne({ sourceId, meta }) {
  const books = {};
  for (const [bookId, bookSlug, chapterCount] of BOOKS) {
    process.stdout.write(`[${meta.id}] ${bookId}…\r`);
    const chapters = {};
    for (let ch = 1; ch <= chapterCount; ch++) {
      const data = await fetchChapter(sourceId, bookSlug, ch);
      const verses = {};
      for (const v of data.data) verses[String(v.verse)] = v.text;
      chapters[String(ch)] = verses;
    }
    books[bookId] = chapters;
  }
  process.stdout.write("\n");
  const out = { translation: meta, books };
  const outPath = path.join(OUT_DIR, `${meta.id.toLowerCase()}.json`);
  await writeFile(outPath, JSON.stringify(out));
  console.log(`wrote ${outPath}`);
}

await mkdir(OUT_DIR, { recursive: true });
for (const t of TRANSLATIONS) await buildOne(t);
