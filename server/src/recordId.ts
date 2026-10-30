import path from "node:path";

/**
 * Record ids become filenames (`<dir>/<id>.json`), so they must never carry
 * path syntax. Letters, digits, `_` and `-` cover every id the app makes
 * (`template-49ff73b5`, `be-thou-my-vision`, `alpha-program`, uuids). This
 * rules out `/`, `\`, `.`/`..`, a leading dot, NUL and the empty string.
 */
export const RECORD_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Thrown for an id that isn't safe as a filename. `statusCode` makes Fastify answer 400. */
export class UnsafeRecordIdError extends Error {
  readonly statusCode = 400;
  constructor(id: unknown) {
    super(`Invalid record id ${JSON.stringify(id)}: use letters, digits, '_' or '-'`);
    this.name = "UnsafeRecordIdError";
  }
}

export function isSafeRecordId(id: unknown): id is string {
  return typeof id === "string" && RECORD_ID_PATTERN.test(id);
}

export function assertSafeRecordId(id: unknown): asserts id is string {
  if (!isSafeRecordId(id)) throw new UnsafeRecordIdError(id);
}

/**
 * The JSON file for record `id` in `dir`. Throws UnsafeRecordIdError for an
 * unsafe id, and (defence in depth) for any path that resolves outside `dir`.
 */
export function recordFile(dir: string, id: string): string {
  assertSafeRecordId(id);
  const root = path.resolve(dir);
  const file = path.resolve(root, `${id}.json`);
  if (!file.startsWith(root + path.sep)) throw new UnsafeRecordIdError(id);
  return file;
}
