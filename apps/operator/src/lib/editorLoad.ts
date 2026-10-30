/** The server's reply to a get_* request for an id it doesn't have. */
export function isNotFoundFor(msg: { type: string; code?: string; message?: string }, id: string): boolean {
  return msg.type === "error" && msg.code === "not_found" && msg.message === id;
}

/** Plain-language text for an editor whose load request failed. */
export function loadFailedText(what: string, err: unknown): string {
  return `Couldn't load the ${what}: ${err instanceof Error ? err.message : String(err)}`;
}
