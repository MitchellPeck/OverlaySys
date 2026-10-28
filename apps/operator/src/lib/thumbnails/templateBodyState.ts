export type BodyStatus = "loading" | "ready" | "missing";

export function bodyStatus(opts: {
  hasBody: boolean;
  listLoaded: boolean;
  inList: boolean;
}): BodyStatus {
  if (opts.hasBody) return "ready";
  if (opts.listLoaded && !opts.inList) return "missing";
  return "loading";
}

/** Ids with a get_template request outstanding. */
export const inFlight = new Set<string>();

/** A dropped connection loses outstanding replies; forget them so they are re-requested. */
export function clearInFlightOnDisconnect(conn: string, set: Set<string> = inFlight): void {
  if (conn !== "open") set.clear();
}
