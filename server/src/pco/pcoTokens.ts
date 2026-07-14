// In-memory Planning Center credential. Stored as a ready-to-send
// `Authorization` header value so the client is agnostic to how we
// authenticated:
//
//   - OAuth (desktop flow)          → "Bearer <access-token>"
//   - Personal Access Token (PAT)   → "Basic base64(appId:secret)"
//
// The desktop host owns the OAuth flow + refresh and pushes the access token
// via POST /api/pco/tokens. For now a PAT can also be supplied directly (env
// or the operator UI) — no OAuth app / redirect URI needed. Nothing is
// persisted server-side.

let authorization: string | null = null;

export function bearerHeader(accessToken: string): string {
  return `Bearer ${accessToken}`;
}

export function basicHeader(appId: string, secret: string): string {
  return `Basic ${Buffer.from(`${appId}:${secret}`).toString("base64")}`;
}

export function setPcoAuthorization(value: string): void {
  authorization = value;
}

export function clearPcoAuthorization(): void {
  authorization = null;
}

export function getPcoAuthorization(): string | null {
  return authorization;
}

export function isPcoConnected(): boolean {
  return authorization !== null;
}

/**
 * Seed the credential from the environment at boot so a PAT (or a manually
 * supplied access token) connects without any UI. Precedence: a full
 * PCO_ACCESS_TOKEN (Bearer) wins; otherwise PCO_APP_ID + PCO_SECRET (Basic).
 */
export function initPcoAuthFromEnv(): void {
  const token = process.env["PCO_ACCESS_TOKEN"];
  const appId = process.env["PCO_APP_ID"];
  const secret = process.env["PCO_SECRET"];
  if (token) authorization = bearerHeader(token);
  else if (appId && secret) authorization = basicHeader(appId, secret);
}
