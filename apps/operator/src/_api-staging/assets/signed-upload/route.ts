/**
 * POST /api/assets/signed-upload
 *
 * Mints a signed Supabase Storage upload URL for an asset. Used by the
 * Electron publish flow (and the cloud operator's own uploader) to
 * sidestep storage.objects RLS, which has been impossible to make work
 * reliably for authenticated users through the supabase-js client.
 *
 * Auth: requires `Authorization: Bearer <user-jwt>` from the operator's
 * cloud session. We validate the JWT against apps-portal's Supabase
 * (the same project that hosts the `overlaysys` schema), then check
 * that the user is a member of the org they're uploading to via
 * `public.orgs.members`.
 *
 * Why service-role: storage.objects RLS rejects user-token uploads even
 * with permissive policies (Supabase Storage internal gate we couldn't
 * identify from the outside). Service-role bypasses RLS cleanly. The
 * org-membership check we do here replaces the storage-layer RLS that
 * was broken — same security guarantee, different layer.
 *
 * This route is NOT included in the Electron static-export build —
 * `scripts/package-desktop.mjs` moves the `app/api/` tree aside before
 * running `next build` with `output: 'export'`. See the comment there.
 */

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { ASSETS_BUCKET } from "@overlaysys/supabase";

// Force the route to be dynamic (no caching). Vercel etc. default to
// some caching unless this is set.
export const dynamic = "force-dynamic";

// CORS headers attached to every response from this route. The route is
// called cross-origin by:
//   - Electron renderer (running at http://127.0.0.1:<port>)
//   - The cloud operator itself when not same-origin
// The endpoint accepts Bearer tokens for auth, not cookies, so wildcard
// origin is safe (CORS doesn't protect token-authed APIs the way it
// protects cookie-authed ones).
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Max-Age": "86400",
} as const;

function cors(res: NextResponse): NextResponse {
  for (const [k, v] of Object.entries(CORS_HEADERS)) {
    res.headers.set(k, v);
  }
  return res;
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

interface SignedUploadRequest {
  sha256: string;
  ext?: string;
  orgId: string;
}

interface SignedUploadResponse {
  signedUrl: string;
  token: string;
  path: string;
}

export async function POST(req: NextRequest) {
  const supabaseUrl = process.env["NEXT_PUBLIC_SUPABASE_URL"];
  const serviceRoleKey = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!supabaseUrl || !serviceRoleKey) {
    return cors(NextResponse.json(
      { error: "server misconfigured: missing Supabase env vars" },
      { status: 500 },
    ));
  }

  const auth = req.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) {
    return cors(NextResponse.json({ error: "missing bearer token" }, { status: 401 }));
  }

  const body = (await req.json().catch(() => null)) as SignedUploadRequest | null;
  if (!body || typeof body.sha256 !== "string" || typeof body.orgId !== "string") {
    return cors(NextResponse.json(
      { error: "expected { sha256, orgId, ext? }" },
      { status: 400 },
    ));
  }
  // SHA256 hex is 64 chars; sanitize to defend against path traversal.
  if (!/^[a-f0-9]{64}$/i.test(body.sha256)) {
    return cors(NextResponse.json({ error: "invalid sha256" }, { status: 400 }));
  }
  if (body.ext && !/^[a-zA-Z0-9]{1,16}$/.test(body.ext)) {
    return cors(NextResponse.json({ error: "invalid extension" }, { status: 400 }));
  }
  // orgId is a UUID — validate against the canonical format.
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      body.orgId,
    )
  ) {
    return cors(NextResponse.json({ error: "invalid orgId" }, { status: 400 }));
  }

  // Validate the user's JWT and resolve their auth.users.id.
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userResp, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userResp?.user) {
    return cors(NextResponse.json({ error: "invalid token" }, { status: 401 }));
  }
  const userId = userResp.user.id;

  // Confirm membership in the target org via apps-portal's public.orgs.
  // `members` is a text[] of user IDs; the user's auth.users.id must
  // appear there. Same check apps-portal uses for its own access gating.
  const { data: orgRows, error: orgErr } = await admin
    .from("orgs")
    .select("id")
    .eq("id", body.orgId)
    .contains("members", [userId]);
  if (orgErr) {
    return cors(NextResponse.json(
      { error: `org lookup failed: ${orgErr.message}` },
      { status: 500 },
    ));
  }
  if (!orgRows || orgRows.length === 0) {
    return cors(NextResponse.json(
      { error: "not a member of that org" },
      { status: 403 },
    ));
  }

  // Mint the signed upload URL via service-role storage client.
  const filename = body.ext ? `${body.sha256}.${body.ext}` : body.sha256;
  const path = `${body.orgId}/${filename}`;
  const { data: signed, error: signErr } = await admin.storage
    .from(ASSETS_BUCKET)
    .createSignedUploadUrl(path, { upsert: true });
  if (signErr || !signed) {
    return cors(NextResponse.json(
      { error: `sign failed: ${signErr?.message ?? "unknown"}` },
      { status: 500 },
    ));
  }

  const response: SignedUploadResponse = {
    signedUrl: signed.signedUrl,
    token: signed.token,
    path,
  };
  return cors(NextResponse.json(response));
}
