/**
 * Command palette scoring (case-insensitive):
 *   3: `text` starts with `query`
 *   2: `query` starts a later word of `text`, or prefixes the words' initials
 *      ("pc" → "Planning Center")
 *   1: every character of `query` appears in `text` in order
 *   0: no match
 * An empty (or blank) query scores 1, so it matches everything equally.
 */
export function fuzzyScore(query: string, text: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 1;
  const t = text.toLowerCase();
  if (t.startsWith(q)) return 3;
  if (startsAWord(q, t) || initials(t).startsWith(q)) return 2;
  return isSubsequence(q, t) ? 1 : 0;
}

/** Subsequence match kept for older callers: any score above zero. */
export function fuzzyMatch(query: string, text: string): boolean {
  return fuzzyScore(query, text) > 0;
}

const isWordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);

/** `q` occurs in `t` right after a non-word character. */
function startsAWord(q: string, t: string): boolean {
  for (let i = t.indexOf(q, 1); i !== -1; i = t.indexOf(q, i + 1)) {
    if (!isWordChar(t[i - 1])) return true;
  }
  return false;
}

/** First letter of each word: "planning center" → "pc". */
function initials(t: string): string {
  let out = "";
  for (let i = 0; i < t.length; i++) {
    if (isWordChar(t[i]) && !isWordChar(t[i - 1])) out += t[i];
  }
  return out;
}

function isSubsequence(q: string, t: string): boolean {
  let i = 0;
  for (let j = 0; j < t.length && i < q.length; j++) {
    if (t[j] === q[i]) i++;
  }
  return i === q.length;
}
