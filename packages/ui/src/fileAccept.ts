/** Does a file match an <input accept> style list (.ext, type/*, type/sub)? Empty = any. */
export function acceptsFile(name: string, mime: string, accept: string): boolean {
  const rules = accept
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (rules.length === 0) return true;
  const n = name.toLowerCase();
  const m = mime.toLowerCase();
  return rules.some((r) => {
    if (r.startsWith(".")) return n.endsWith(r);
    if (r.endsWith("/*")) return m.startsWith(r.slice(0, -1));
    return m === r;
  });
}
