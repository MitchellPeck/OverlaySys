export interface BookEntry {
  /** Canonical 3-letter id (Paratext/OSIS-ish: GEN, EXO, ..., JHN, REV). */
  id: string;
  /** Display name shown in the operator UI. */
  name: string;
  /** Number of chapters in the book. Used to validate references in providers. */
  chapters: number;
  /**
   * All accepted alias strings (display name + abbreviations).
   * Matching is case-insensitive and ignores surrounding whitespace.
   * Stored in normalized form (no leading numeric space variants — both
   * "1 Cor" and "1Cor" are listed explicitly).
   */
  aliases: string[];
}

export const BOOKS: BookEntry[] = [
  { id: "GEN", name: "Genesis",       chapters: 50, aliases: ["Genesis", "Gen", "Gn"] },
  { id: "EXO", name: "Exodus",        chapters: 40, aliases: ["Exodus", "Exod", "Exo", "Ex"] },
  { id: "LEV", name: "Leviticus",     chapters: 27, aliases: ["Leviticus", "Lev", "Lv"] },
  { id: "NUM", name: "Numbers",       chapters: 36, aliases: ["Numbers", "Num", "Nm", "Nu"] },
  { id: "DEU", name: "Deuteronomy",   chapters: 34, aliases: ["Deuteronomy", "Deut", "Deu", "Dt"] },
  { id: "JOS", name: "Joshua",        chapters: 24, aliases: ["Joshua", "Josh", "Jos"] },
  { id: "JDG", name: "Judges",        chapters: 21, aliases: ["Judges", "Judg", "Jdg"] },
  { id: "RUT", name: "Ruth",          chapters: 4,  aliases: ["Ruth", "Rut"] },
  { id: "1SA", name: "1 Samuel",      chapters: 31, aliases: ["1 Samuel", "1Samuel", "1 Sam", "1Sam", "1 Sa", "1Sa"] },
  { id: "2SA", name: "2 Samuel",      chapters: 24, aliases: ["2 Samuel", "2Samuel", "2 Sam", "2Sam", "2 Sa", "2Sa"] },
  { id: "1KI", name: "1 Kings",       chapters: 22, aliases: ["1 Kings", "1Kings", "1 Kgs", "1Kgs", "1 Ki", "1Ki"] },
  { id: "2KI", name: "2 Kings",       chapters: 25, aliases: ["2 Kings", "2Kings", "2 Kgs", "2Kgs", "2 Ki", "2Ki"] },
  { id: "1CH", name: "1 Chronicles",  chapters: 29, aliases: ["1 Chronicles", "1Chronicles", "1 Chron", "1Chron", "1 Chr", "1Chr"] },
  { id: "2CH", name: "2 Chronicles",  chapters: 36, aliases: ["2 Chronicles", "2Chronicles", "2 Chron", "2Chron", "2 Chr", "2Chr"] },
  { id: "EZR", name: "Ezra",          chapters: 10, aliases: ["Ezra", "Ezr"] },
  { id: "NEH", name: "Nehemiah",      chapters: 13, aliases: ["Nehemiah", "Neh"] },
  { id: "EST", name: "Esther",        chapters: 10, aliases: ["Esther", "Esth", "Est"] },
  { id: "JOB", name: "Job",           chapters: 42, aliases: ["Job", "Jb"] },
  { id: "PSA", name: "Psalms",        chapters: 150, aliases: ["Psalms", "Psalm", "Pss", "Ps"] },
  { id: "PRO", name: "Proverbs",      chapters: 31, aliases: ["Proverbs", "Prov", "Pro", "Prv"] },
  { id: "ECC", name: "Ecclesiastes",  chapters: 12, aliases: ["Ecclesiastes", "Eccles", "Eccl", "Ecc"] },
  { id: "SNG", name: "Song of Solomon", chapters: 8, aliases: ["Song of Solomon", "Song of Songs", "Song", "SoS", "Sg"] },
  { id: "ISA", name: "Isaiah",        chapters: 66, aliases: ["Isaiah", "Isa", "Is"] },
  { id: "JER", name: "Jeremiah",      chapters: 52, aliases: ["Jeremiah", "Jer"] },
  { id: "LAM", name: "Lamentations",  chapters: 5,  aliases: ["Lamentations", "Lam"] },
  { id: "EZK", name: "Ezekiel",       chapters: 48, aliases: ["Ezekiel", "Ezek", "Ezk"] },
  { id: "DAN", name: "Daniel",        chapters: 12, aliases: ["Daniel", "Dan", "Dn"] },
  { id: "HOS", name: "Hosea",         chapters: 14, aliases: ["Hosea", "Hos"] },
  { id: "JOL", name: "Joel",          chapters: 3,  aliases: ["Joel", "Jl"] },
  { id: "AMO", name: "Amos",          chapters: 9,  aliases: ["Amos", "Am"] },
  { id: "OBA", name: "Obadiah",       chapters: 1,  aliases: ["Obadiah", "Obad", "Oba", "Ob"] },
  { id: "JON", name: "Jonah",         chapters: 4,  aliases: ["Jonah", "Jon"] },
  { id: "MIC", name: "Micah",         chapters: 7,  aliases: ["Micah", "Mic"] },
  { id: "NAM", name: "Nahum",         chapters: 3,  aliases: ["Nahum", "Nah", "Na"] },
  { id: "HAB", name: "Habakkuk",      chapters: 3,  aliases: ["Habakkuk", "Hab"] },
  { id: "ZEP", name: "Zephaniah",     chapters: 3,  aliases: ["Zephaniah", "Zeph", "Zep"] },
  { id: "HAG", name: "Haggai",        chapters: 2,  aliases: ["Haggai", "Hag"] },
  { id: "ZEC", name: "Zechariah",     chapters: 14, aliases: ["Zechariah", "Zech", "Zec"] },
  { id: "MAL", name: "Malachi",       chapters: 4,  aliases: ["Malachi", "Mal"] },

  { id: "MAT", name: "Matthew",       chapters: 28, aliases: ["Matthew", "Matt", "Mat", "Mt"] },
  { id: "MRK", name: "Mark",          chapters: 16, aliases: ["Mark", "Mrk", "Mk"] },
  { id: "LUK", name: "Luke",          chapters: 24, aliases: ["Luke", "Luk", "Lk"] },
  { id: "JHN", name: "John",          chapters: 21, aliases: ["John", "Jhn", "Jn"] },
  { id: "ACT", name: "Acts",          chapters: 28, aliases: ["Acts", "Act", "Ac"] },
  { id: "ROM", name: "Romans",        chapters: 16, aliases: ["Romans", "Rom", "Rm"] },
  { id: "1CO", name: "1 Corinthians", chapters: 16, aliases: ["1 Corinthians", "1Corinthians", "1 Cor", "1Cor", "1 Co", "1Co"] },
  { id: "2CO", name: "2 Corinthians", chapters: 13, aliases: ["2 Corinthians", "2Corinthians", "2 Cor", "2Cor", "2 Co", "2Co"] },
  { id: "GAL", name: "Galatians",     chapters: 6,  aliases: ["Galatians", "Gal"] },
  { id: "EPH", name: "Ephesians",     chapters: 6,  aliases: ["Ephesians", "Eph"] },
  { id: "PHP", name: "Philippians",   chapters: 4,  aliases: ["Philippians", "Phil", "Php"] },
  { id: "COL", name: "Colossians",    chapters: 4,  aliases: ["Colossians", "Col"] },
  { id: "1TH", name: "1 Thessalonians", chapters: 5, aliases: ["1 Thessalonians", "1Thessalonians", "1 Thess", "1Thess", "1 Th", "1Th"] },
  { id: "2TH", name: "2 Thessalonians", chapters: 3, aliases: ["2 Thessalonians", "2Thessalonians", "2 Thess", "2Thess", "2 Th", "2Th"] },
  { id: "1TI", name: "1 Timothy",     chapters: 6,  aliases: ["1 Timothy", "1Timothy", "1 Tim", "1Tim", "1 Ti", "1Ti"] },
  { id: "2TI", name: "2 Timothy",     chapters: 4,  aliases: ["2 Timothy", "2Timothy", "2 Tim", "2Tim", "2 Ti", "2Ti"] },
  { id: "TIT", name: "Titus",         chapters: 3,  aliases: ["Titus", "Tit"] },
  { id: "PHM", name: "Philemon",      chapters: 1,  aliases: ["Philemon", "Philem", "Phlm", "Phm"] },
  { id: "HEB", name: "Hebrews",       chapters: 13, aliases: ["Hebrews", "Heb"] },
  { id: "JAS", name: "James",         chapters: 5,  aliases: ["James", "Jas", "Jm"] },
  { id: "1PE", name: "1 Peter",       chapters: 5,  aliases: ["1 Peter", "1Peter", "1 Pet", "1Pet", "1 Pe", "1Pe"] },
  { id: "2PE", name: "2 Peter",       chapters: 3,  aliases: ["2 Peter", "2Peter", "2 Pet", "2Pet", "2 Pe", "2Pe"] },
  { id: "1JN", name: "1 John",        chapters: 5,  aliases: ["1 John", "1John", "1 Jn", "1Jn", "1 Jhn", "1Jhn"] },
  { id: "2JN", name: "2 John",        chapters: 1,  aliases: ["2 John", "2John", "2 Jn", "2Jn", "2 Jhn", "2Jhn"] },
  { id: "3JN", name: "3 John",        chapters: 1,  aliases: ["3 John", "3John", "3 Jn", "3Jn", "3 Jhn", "3Jhn"] },
  { id: "JUD", name: "Jude",          chapters: 1,  aliases: ["Jude", "Jud"] },
  { id: "REV", name: "Revelation",    chapters: 22, aliases: ["Revelation", "Rev", "Rv", "Re"] },
];

// Build a lookup index once at module load.
const ALIAS_INDEX: Map<string, BookEntry> = (() => {
  const m = new Map<string, BookEntry>();
  for (const b of BOOKS) {
    for (const alias of b.aliases) {
      m.set(alias.toLowerCase(), b);
    }
  }
  return m;
})();

export function findBookByAlias(input: string): BookEntry | null {
  if (!input) return null;
  const key = input.trim().toLowerCase();
  if (!key) return null;
  return ALIAS_INDEX.get(key) ?? null;
}
