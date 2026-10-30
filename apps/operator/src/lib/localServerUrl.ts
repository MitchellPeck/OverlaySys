/** Server-served relative paths that need the server's HTTP origin in front when the operator is on another port (dev). */
const SERVER_PATH_PREFIXES = ["/assets/", "/media-folders/"];

export function prefixServerPath(stored: string, base: string): string {
  return SERVER_PATH_PREFIXES.some((p) => stored.startsWith(p)) ? `${base}${stored}` : stored;
}
