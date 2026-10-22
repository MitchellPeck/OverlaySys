export function titleFromFileName(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

/** Cleans Markdown produced by mammoth (or pasted) into what the notes splitter and renderer understand. */
export function normalizeImportedMarkdown(md: string): string {
  return md
    .replace(/\r\n?/g, "\n")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/^[ \t]*\|?([ \t]*:?-{3,}:?[ \t]*\|)+[ \t]*:?-{0,}:?[ \t]*\|?[ \t]*$\n?/gm, "")
    .replace(/^[ \t]*\|(.*)\|[ \t]*$/gm, (_m, inner: string) =>
      inner.split("|").map((c) => c.trim()).filter(Boolean).join(" "),
    )
    .replace(/__(.+?)__/g, "**$1**")
    .replace(/(^|[^_\w])_(?!_)(.+?)_(?![_\w])/g, "$1*$2*")
    .replace(/^(\s*)\*\s+/gm, "$1- ")
    .replace(/\\([\\`*_{}[\]()#+\-.!])/g, "$1")
    .split("\n")
    .map((l) => l.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function notesFromFile(file: File): Promise<{ title: string; body: string }> {
  const title = titleFromFileName(file.name);
  if (/\.docx$/i.test(file.name)) {
    const mammoth = await import("mammoth/mammoth.browser");
    const { value } = await mammoth.convertToMarkdown({ arrayBuffer: await file.arrayBuffer() });
    return { title, body: normalizeImportedMarkdown(value) };
  }
  return { title, body: normalizeImportedMarkdown(await file.text()) };
}
