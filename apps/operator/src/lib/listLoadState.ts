export type ListLoadConn = "connecting" | "open" | "closed";

/**
 * What a library list should show before its data is trusted.
 * - connecting: loading (no error flash while the socket comes up)
 * - open, first list not yet received: loading
 * - open with list: neither
 * - closed: error (cloud mode has no socket: only the first load matters)
 */
export function listLoadState(i: { cloud?: boolean; conn: ListLoadConn; loaded: boolean }): {
  loading: boolean;
  error: boolean;
} {
  if (i.cloud) return { loading: !i.loaded, error: false };
  if (i.conn === "closed") return { loading: false, error: true };
  if (i.conn === "connecting") return { loading: true, error: false };
  return { loading: !i.loaded, error: false };
}
