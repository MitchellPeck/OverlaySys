// Which account a Supabase access token belongs to. Kept free of Electron
// imports so it can be unit-tested.

/** The `sub` claim of a JWT, without verifying it — identity checks only. */
export function jwtSubject(token: string): string | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      sub?: unknown;
    };
    return typeof claims.sub === "string" ? claims.sub : null;
  } catch {
    return null;
  }
}

/**
 * True when `incoming` is provably for a different account than `existing`.
 * A token refresh never changes the user, so a mismatch means some other
 * session (e.g. a stale one in the operator's localStorage) is trying to
 * overwrite the sign-in — and would be paired with the wrong org.
 */
export function isDifferentUser(existing: string | null, incoming: string): boolean {
  if (!existing) return false;
  const a = jwtSubject(existing);
  const b = jwtSubject(incoming);
  return a !== null && b !== null && a !== b;
}
