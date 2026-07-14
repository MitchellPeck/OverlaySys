/**
 * Case-insensitive subsequence match used by the command palette filter.
 * Every character of `query` must appear in `text` in order (not necessarily
 * contiguous). An empty query matches everything.
 */
export function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let i = 0;
  for (let j = 0; j < t.length && i < q.length; j++) {
    if (t[j] === q[i]) i++;
  }
  return i === q.length;
}
