// Planning Center sign-in for the Electron host.
//
// PCO uses the OAuth2 **authorization-code** flow (unlike the cloud sign-in,
// which returns tokens in a URL hash). The `code` arrives on the loopback
// callback's query string and is exchanged for tokens server-side using the
// client secret — so, like cloudAuth, the secret and refresh live only in the
// main process + OS keychain, never in the renderer.
//
//   1. Renderer calls pcoAuth.startSignIn() via IPC.
//   2. Main binds a loopback HTTP server on 127.0.0.1:<PCO_OAUTH_PORT>.
//   3. Main opens the browser at
//        https://api.planningcenteronline.com/oauth/authorize
//          ?client_id=…&redirect_uri=http://127.0.0.1:<port>/callback
//          &response_type=code&scope=services&state=<random>
//   4. User authorizes; PCO redirects to the loopback with ?code=…&state=…
//   5. /callback verifies state, POSTs the code to PCO's token endpoint,
//      persists {access,refresh,expiresAt} via safeStorage, and resolves.
//
// NOTE: PCO requires the redirect_uri to exactly match one registered on the
// OAuth application, so we bind a FIXED port (PCO_OAUTH_PORT, default 8434).
// Register `http://127.0.0.1:8434/callback` on the PCO app.

import { app, BrowserWindow, safeStorage, shell } from "electron";
import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const AUTHORIZE_URL = "https://api.planningcenteronline.com/oauth/authorize";
const TOKEN_URL = "https://api.planningcenteronline.com/oauth/token";
const SCOPE = "services";
const STATE_FILE = "pco-session.json";

export interface PcoTokens {
  accessToken: string;
  refreshToken: string;
  /** epoch ms when the access token expires. */
  expiresAt: number;
  storedAt: number;
}

interface ActiveFlow {
  server: http.Server;
  state: string;
  resolve: (tokens: PcoTokens) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}
let active: ActiveFlow | null = null;

function oauthPort(): number {
  return Number(process.env["PCO_OAUTH_PORT"] ?? 8434);
}
function redirectUri(): string {
  return `http://127.0.0.1:${oauthPort()}/callback`;
}
function userDataPath(): string {
  return path.join(app.getPath("userData"), STATE_FILE);
}

function clientCreds(): { clientId: string; clientSecret: string } {
  const clientId = process.env["PCO_CLIENT_ID"];
  const clientSecret = process.env["PCO_CLIENT_SECRET"];
  if (!clientId || !clientSecret) {
    throw new Error(
      "PCO_CLIENT_ID / PCO_CLIENT_SECRET are not set — cannot sign in to " +
        "Planning Center. Set them in the desktop env.",
    );
  }
  return { clientId, clientSecret };
}

export async function loadTokens(): Promise<PcoTokens | null> {
  try {
    const raw = await fs.readFile(userDataPath());
    if (!safeStorage.isEncryptionAvailable()) return null;
    const parsed = JSON.parse(safeStorage.decryptString(raw)) as PcoTokens;
    if (
      typeof parsed.accessToken !== "string" ||
      typeof parsed.refreshToken !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function saveTokens(tokens: PcoTokens): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("safeStorage unavailable — cannot persist PCO tokens");
  }
  const buf = safeStorage.encryptString(JSON.stringify(tokens));
  await fs.writeFile(userDataPath(), buf, { mode: 0o600 });
}

export async function clearTokens(): Promise<void> {
  await fs.unlink(userDataPath()).catch(() => undefined);
}

function tokensFromResponse(json: {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
}): PcoTokens {
  const now = Date.now();
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: now + (json.expires_in ?? 7200) * 1000,
    storedAt: now,
  };
}

/** Exchange an authorization code (or refresh token) for a fresh token pair. */
async function tokenRequest(
  params: Record<string, string>,
): Promise<PcoTokens> {
  const { clientId, clientSecret } = clientCreds();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      ...params,
    }).toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`PCO token request failed (${res.status}): ${text}`);
  }
  return tokensFromResponse(
    (await res.json()) as {
      access_token: string;
      refresh_token: string;
      expires_in?: number;
    },
  );
}

/**
 * Refresh the access token using the stored refresh token. Persists and
 * returns the new pair; the caller re-pushes it to the server.
 */
export async function refreshTokens(): Promise<PcoTokens | null> {
  const existing = await loadTokens();
  if (!existing) return null;
  const next = await tokenRequest({
    grant_type: "refresh_token",
    refresh_token: existing.refreshToken,
  });
  await saveTokens(next);
  notifyChanged(next);
  return next;
}

export async function startSignIn(): Promise<PcoTokens> {
  if (active) throw new Error("a PCO sign-in flow is already in progress");
  const { clientId } = clientCreds();
  const state = crypto.randomBytes(24).toString("hex");

  return new Promise<PcoTokens>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      handleRequest(req, res).catch((err) => {
        res.statusCode = 500;
        res.end(`error: ${err instanceof Error ? err.message : String(err)}`);
      });
    });

    server.on("error", (err) => {
      active = null;
      reject(
        new Error(
          `Could not bind loopback port ${oauthPort()} for PCO sign-in: ${
            err instanceof Error ? err.message : String(err)
          }`,
        ),
      );
    });

    server.listen(oauthPort(), "127.0.0.1", () => {
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri(),
        response_type: "code",
        scope: SCOPE,
        state,
      });
      void shell.openExternal(`${AUTHORIZE_URL}?${params.toString()}`);
    });

    const timer = setTimeout(() => {
      if (active?.server === server) active = null;
      server.close();
      reject(new Error("PCO sign-in timed out"));
    }, 5 * 60 * 1000);

    active = { server, state, resolve, reject, timer };
  });
}

async function handleRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  if (!active) {
    res.statusCode = 410;
    res.end("no active sign-in flow");
    return;
  }
  const flow = active;
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname !== "/callback") {
    res.statusCode = 404;
    res.end("not found");
    return;
  }

  const returnedState = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const finish = (ok: boolean, message: string): void => {
    res.statusCode = ok ? 200 : 400;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(`<!doctype html><html><head><meta charset="utf-8" />
<title>OverlaySys — Planning Center</title></head>
<body style="font-family: system-ui; padding: 32px;">
<h1>${ok ? "Connected to Planning Center" : "Sign-in failed"}</h1>
<p>${message}</p></body></html>`);
  };

  if (returnedState !== flow.state) {
    finish(false, "State mismatch — please try again.");
    return;
  }
  if (!code) {
    finish(false, url.searchParams.get("error") ?? "No authorization code returned.");
    return;
  }

  try {
    const tokens = await tokenRequest({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(),
    });
    await saveTokens(tokens);
    finish(true, "You can close this tab and return to OverlaySys.");
    clearTimeout(flow.timer);
    active = null;
    setTimeout(() => flow.server.close(), 100);
    notifyChanged(tokens);
    flow.resolve(tokens);
  } catch (err) {
    finish(false, err instanceof Error ? err.message : String(err));
    clearTimeout(flow.timer);
    active = null;
    setTimeout(() => flow.server.close(), 100);
    flow.reject(err instanceof Error ? err : new Error(String(err)));
  }
}

/** Notify renderer windows that PCO tokens changed (mirrors cloudAuth). */
function notifyChanged(tokens: PcoTokens): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("overlaysys:pco-signed-in", tokens);
  }
}
