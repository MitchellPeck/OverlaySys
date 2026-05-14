// Cloud sign-in flow for the Electron host.
//
// The renderer (operator UI) talks to OverlaySys's cloud (apps-portal's
// Supabase) via a Supabase JS client. Tokens come from apps-portal's
// existing /api/apps/[id]/open endpoint, which we extend with a `return`
// param that points at a localhost loopback URL. The flow:
//
//   1. Renderer calls cloudAuth.startSignIn() via IPC.
//   2. Main spins up an ephemeral HTTP server on 127.0.0.1:<random>.
//   3. Main opens the system browser at
//        https://<registry>/api/apps/<app-id>/open?target=live
//          &return=http://127.0.0.1:<port>/callback&state=<random>
//   4. User signs in to apps-portal (or is already signed in via cookie),
//      session is minted server-side, browser redirects to the loopback
//      with tokens in the URL hash.
//   5. The loopback's /callback route serves an HTML page that uses
//      inline JS to POST window.location.hash to /save (hashes don't
//      reach the server otherwise).
//   6. /save parses the tokens, verifies the state token to defend
//      against drive-by attacks on the loopback port, encrypts via
//      safeStorage, persists to userData, emits an IPC event, and
//      closes the loopback.
//
// safeStorage uses the OS keychain (macOS Keychain, Windows DPAPI,
// libsecret on Linux) so we don't ship a native dep like keytar.

import { app, BrowserWindow, safeStorage, shell } from "electron";
import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export interface CloudTokens {
  accessToken: string;
  refreshToken: string;
  registryOrgId: string | null;
  storedAt: number;
}

const STATE_FILE = "cloud-session.json";

let active: ActiveFlow | null = null;

interface ActiveFlow {
  server: http.Server;
  state: string;
  resolve: (tokens: CloudTokens) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

function userDataPath(): string {
  return path.join(app.getPath("userData"), STATE_FILE);
}

/**
 * Read the persisted cloud session. Returns null if nothing's been stored
 * or if safeStorage can't decrypt it (corrupt or wrong machine).
 */
export async function loadTokens(): Promise<CloudTokens | null> {
  try {
    const raw = await fs.readFile(userDataPath());
    if (!safeStorage.isEncryptionAvailable()) return null;
    const json = safeStorage.decryptString(raw);
    const parsed = JSON.parse(json) as CloudTokens;
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

async function saveTokens(tokens: CloudTokens): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("safeStorage unavailable — cannot persist cloud tokens");
  }
  const buf = safeStorage.encryptString(JSON.stringify(tokens));
  await fs.writeFile(userDataPath(), buf, { mode: 0o600 });
}

export async function clearTokens(): Promise<void> {
  await fs.unlink(userDataPath()).catch(() => undefined);
}

/**
 * Begin a sign-in flow. Returns a promise that resolves with the captured
 * tokens. The user has 5 minutes to complete the flow; after that the
 * loopback closes and the promise rejects.
 */
export async function startSignIn(): Promise<CloudTokens> {
  if (active) {
    throw new Error("a sign-in flow is already in progress");
  }

  const registryUrl =
    process.env["OVERLAYSYS_REGISTRY_URL"] ?? "https://apps.mitchellpeck.com";
  const appId = process.env["OVERLAYSYS_REGISTRY_APP_ID"];
  if (!appId) {
    throw new Error(
      "OVERLAYSYS_REGISTRY_APP_ID is not set — Electron host can't address " +
        "OverlaySys in the registry. Set it in your env (or .env.local).",
    );
  }

  const state = crypto.randomBytes(24).toString("hex");

  return new Promise<CloudTokens>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      handleRequest(req, res).catch((err) => {
        res.statusCode = 500;
        res.end(`error: ${err instanceof Error ? err.message : String(err)}`);
      });
    });

    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("loopback server failed to bind"));
        server.close();
        return;
      }
      const port = addr.port;
      const returnUrl = `http://127.0.0.1:${port}/callback`;
      const params = new URLSearchParams({
        target: "live",
        return: returnUrl,
        state,
      });
      const url = `${registryUrl}/api/apps/${encodeURIComponent(
        appId,
      )}/open?${params.toString()}`;
      void shell.openExternal(url);
    });

    const timer = setTimeout(
      () => {
        if (active?.server === server) {
          active = null;
        }
        server.close();
        reject(new Error("sign-in timed out"));
      },
      5 * 60 * 1000,
    );

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
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/callback" && req.method === "GET") {
    // Tokens arrive in the URL hash (Supabase magic-link convention), which
    // never reaches the server. Bounce them back via an inline POST.
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(`<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>OverlaySys — signed in</title></head>
  <body style="font-family: system-ui; padding: 32px;">
    <h1>Signing you in…</h1>
    <p id="msg">Please wait.</p>
    <script>
      (async () => {
        const hash = (location.hash || "").replace(/^#/, "");
        try {
          await fetch("/save", { method: "POST", body: hash });
          document.getElementById("msg").textContent =
            "Signed in. You can close this tab and return to OverlaySys.";
        } catch (err) {
          document.getElementById("msg").textContent =
            "Couldn't complete sign-in: " + err;
        }
      })();
    </script>
  </body>
</html>`);
    return;
  }
  if (url.pathname === "/save" && req.method === "POST") {
    const body = await readBody(req);
    const params = new URLSearchParams(body);
    if (params.get("state") !== active.state) {
      res.statusCode = 400;
      res.end("state mismatch");
      return;
    }
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");
    if (!accessToken || !refreshToken) {
      res.statusCode = 400;
      res.end("missing tokens");
      return;
    }
    const tokens: CloudTokens = {
      accessToken,
      refreshToken,
      registryOrgId: params.get("registry_org_id"),
      storedAt: Date.now(),
    };
    await saveTokens(tokens);
    res.statusCode = 200;
    res.end("ok");
    const { resolve, server, timer } = active;
    clearTimeout(timer);
    active = null;
    // Close after a small delay so the response body finishes flushing.
    setTimeout(() => server.close(), 100);
    notifySignedIn(tokens);
    resolve(tokens);
    return;
  }
  res.statusCode = 404;
  res.end("not found");
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/**
 * Broadcast a "tokens just changed" event to every BrowserWindow so the
 * operator UI can rehydrate its Supabase session without a manual reload.
 */
function notifySignedIn(tokens: CloudTokens): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("overlaysys:cloud-signed-in", tokens);
  }
}
