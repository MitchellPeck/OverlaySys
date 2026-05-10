// Tokenizer + phonetic fold + stop-word filter shared by the STT matcher
// and any other surface that compares heard speech against printed lyrics.
//
// The fold targets the recurring failure modes seen in worship-set ASR:
//   - contractions and possessives  ("I've" → "i", "Lord's" → "lord")
//   - dropped trailing g            ("amazin'", "amazing" → "amazin")
//   - archaic pronouns              ("thee", "thou" → "the")
// Stop-word filtering then drops the lowest-info English connectives so
// coverage is computed against meaningful content tokens only.

const STOP_WORDS = new Set<string>([
  "a", "an", "the",
  "and", "or", "but", "so",
  "of", "to", "in", "on", "at", "for", "with", "by", "from", "as",
  "is", "are", "am", "was", "were", "be", "been", "being",
  "do", "does", "did",
  "this", "that", "these", "those",
  "it", "its",
]);

export function isStopWord(token: string): boolean {
  return STOP_WORDS.has(token);
}

const CONTRACTION_TAILS = ["'ll", "'ve", "'re", "'d", "'s", "'m", "'"];

/**
 * Phonetically fold a single lowercased word so that small ASR/dialect
 * variants collapse to the same key. Conservative on purpose: we only
 * apply rules whose collisions are vanishingly rare in lyric text.
 */
export function phoneticFold(word: string): string {
  let w = word.toLowerCase();

  // Strip contraction / possessive tails.
  for (const tail of CONTRACTION_TAILS) {
    if (w.endsWith(tail) && w.length > tail.length) {
      w = w.slice(0, -tail.length);
      break;
    }
  }

  // Drop any apostrophe that wasn't part of a known tail
  // ("don't" → "dont", "won't" → "wont").
  if (w.includes("'")) w = w.replace(/'/g, "");

  // Archaic 2nd-person pronouns → modern equivalents (so "Thou art" and
  // "you are" share keys after stop-word filtering).
  if (w === "thee" || w === "thou" || w === "ye") return "you";
  if (w === "thy") return "your";
  if (w === "thine") return "yours";
  if (w === "art") return "are";

  // Drop dropped-g endings: "amazing" / "amazin" / "amazin'" all → "amazin".
  if (w.length > 4 && w.endsWith("ing")) {
    w = w.slice(0, -1); // "amazing" → "amazin"
  }

  return w;
}

/**
 * Lowercase, split on whitespace/punctuation, drop empties. Does NOT fold
 * or filter stop words — use lyricTokens() for the matcher path.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((t) => t.length > 0);
}

/**
 * Full preprocessing pipeline: tokenize → phoneticFold → drop stop words.
 * Returns a list (not a set) so callers can compute multiplicities if
 * they want to. Stop words are dropped AFTER folding so e.g. "thee" → "you"
 * gets dropped by the "you" stop-word entry only if "you" is in the list
 * (it isn't — "you" carries content in many lyrics).
 */
export function lyricTokens(text: string): string[] {
  const out: string[] = [];
  for (const raw of tokenize(text)) {
    const folded = phoneticFold(raw);
    if (!folded || isStopWord(folded)) continue;
    out.push(folded);
  }
  return out;
}
