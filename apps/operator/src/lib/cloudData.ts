"use client";

import {
  ChannelConfigSchema,
  HotcardSchema,
  ProjectChannelOverrideSchema,
  ShowSchema,
  SongSchema,
  TemplateSchema,
  type Bundle,
  type ChannelConfig,
  type Hotcard,
  type HotcardMeta,
  type Project,
  type ProjectChannelOverride,
  type Show,
  type Song,
  type SongMeta,
  type Template,
  type TemplateMeta,
} from "@overlaysys/core";
import { ASSETS_BUCKET } from "@overlaysys/supabase";
import { getCloudClient, getStoredRegistryOrgId } from "./cloudAuth";
import { useStore, type ShowMeta } from "./store";
import type { UploadResult } from "./uploadAsset";

/**
 * Cloud-mode data source.
 *
 * All functions read/write against apps-portal's Supabase, scoped to the
 * `overlaysys` schema. RLS enforces org membership — see
 * supabase/migrations/0001_init.sql for the policies.
 *
 * On every successful write, the relevant Zustand store slice is refreshed
 * so existing UI components continue to read from the same in-memory cache
 * they used in local mode. This is the cheapest way to avoid forking the
 * component layer just because the data plumbing differs.
 */

function getOrgId(): string {
  if (typeof window === "undefined") {
    throw new Error("getOrgId called server-side");
  }
  const id = getStoredRegistryOrgId();
  if (!id) throw new Error("registry org id not set — cloud bootstrap incomplete");
  return id;
}

// ─── Projects ──────────────────────────────────────────────────────────────

export async function listProjectsCloud(): Promise<Project[]> {
  const client = getCloudClient();
  const { data, error } = await client
    .from("projects")
    .select("id, name, notes, created_at, updated_at")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(rowToProject);
}

export async function getProjectCloud(id: string): Promise<Project | null> {
  const client = getCloudClient();
  const orgId = getOrgId();
  const { data, error } = await client
    .from("projects")
    .select("id, name, notes, created_at, updated_at")
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data ? rowToProject(data) : null;
}

export async function saveProjectCloud(project: Project): Promise<void> {
  const client = getCloudClient();
  const orgId = getOrgId();
  // Wrap in an array to force the typed `Insert[]` overload — without
  // this supabase-js can't pick between single-row and batch overloads
  // and falls back to `never[]`.
  // Chain `.select()` so RLS-silent filters surface as a zero-row result
  // we can detect, instead of an apparent success with no row written.
  const { data, error } = await client
    .from("projects")
    .upsert(
      [
        {
          id: project.id,
          org_id: orgId,
          name: project.name,
          notes: project.notes ?? null,
          created_at: project.createdAt,
          // Trigger bumps updated_at; sending it explicitly is allowed but
          // overridden by the trigger.
        },
      ],
      { onConflict: "org_id,id" },
    )
    .select();
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error(
      "Insert returned 0 rows — likely RLS denied. Check that your user is in " +
        `public.orgs.members for org ${orgId} (or the helper overlaysys.is_org_member ` +
        "checks the field it should).",
    );
  }
}

export async function deleteProjectCloud(id: string): Promise<void> {
  const client = getCloudClient();
  const orgId = getOrgId();
  const { error } = await client
    .from("projects")
    .delete()
    .eq("org_id", orgId)
    .eq("id", id);
  if (error) throw error;
}

/**
 * Pull the current org's projects from Supabase and push into the
 * Zustand store, mirroring what the WS `project_list` message does in
 * local mode. Call after any write op to refresh, or once on cloud-mode
 * mount to seed the store.
 */
export async function refreshProjectsCloud(): Promise<void> {
  const projects = await listProjectsCloud();
  useStore.getState().setProjects(projects);
}

// ─── Shows ─────────────────────────────────────────────────────────────────

export async function listShowMetasCloud(): Promise<ShowMeta[]> {
  const client = getCloudClient();
  const { data, error } = await client
    .from("shows")
    .select("id, name, project_id, rows")
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    projectId: row.project_id,
    // rows is jsonb — could be any shape on disk; default to 0 on a
    // malformed payload rather than throwing for a list view.
    rowCount: Array.isArray(row.rows) ? row.rows.length : 0,
  }));
}

export async function getShowCloud(id: string): Promise<Show | null> {
  const client = getCloudClient();
  const orgId = getOrgId();
  const { data, error } = await client
    .from("shows")
    .select("id, name, project_id, rows")
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  // Validate via Zod so we land in the same shape the rest of the operator
  // expects — silently coerce missing projectId via the schema's preprocessor.
  return ShowSchema.parse({
    id: data.id,
    name: data.name,
    projectId: data.project_id,
    rows: data.rows,
  });
}

export async function saveShowCloud(show: Show): Promise<void> {
  const client = getCloudClient();
  const orgId = getOrgId();
  const { data, error } = await client
    .from("shows")
    .upsert(
      [
        {
          id: show.id,
          org_id: orgId,
          project_id: show.projectId,
          name: show.name,
          // jsonb accepts the structured value directly. Cast via unknown
          // because Json's index-signature isn't structurally compatible
          // with our RundownRow discriminated union, but the runtime
          // shape is fine — Postgres just stores it.
          rows: show.rows as unknown as Show["rows"],
        },
      ],
      { onConflict: "org_id,id" },
    )
    .select();
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error(
      `Show insert returned 0 rows — likely RLS denied. Check org membership for ${orgId}.`,
    );
  }
}

/**
 * Read just `updated_at` for a cloud entity so the operator can detect
 * concurrent writes. Returns null when the row doesn't exist (treated as
 * "nothing to conflict with"). Used by the editor pages before saving:
 * if the cloud `updated_at` is newer than the timestamp the editor
 * loaded with, surface a confirmation before clobbering.
 */
export async function getShowUpdatedAtCloud(id: string): Promise<string | null> {
  const client = getCloudClient();
  const orgId = getOrgId();
  const { data, error } = await client
    .from("shows")
    .select("updated_at")
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return data.updated_at;
}

export async function getHotcardUpdatedAtCloud(id: string): Promise<string | null> {
  const client = getCloudClient();
  const orgId = getOrgId();
  const { data, error } = await client
    .from("hotcards")
    .select("updated_at")
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return data.updated_at;
}

export async function getTemplateUpdatedAtCloud(id: string): Promise<string | null> {
  const client = getCloudClient();
  const orgId = getOrgId();
  const { data, error } = await client
    .from("templates")
    .select("updated_at")
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return data.updated_at;
}

export async function getSongUpdatedAtCloud(id: string): Promise<string | null> {
  const client = getCloudClient();
  const orgId = getOrgId();
  const { data, error } = await client
    .from("songs")
    .select("updated_at")
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return data.updated_at;
}

export async function deleteShowCloud(id: string): Promise<void> {
  const client = getCloudClient();
  const orgId = getOrgId();
  const { error } = await client
    .from("shows")
    .delete()
    .eq("org_id", orgId)
    .eq("id", id);
  if (error) throw error;
}

export async function refreshShowMetasCloud(): Promise<void> {
  const metas = await listShowMetasCloud();
  useStore.getState().setShowMetas(metas);
}

// ─── Hotcards ──────────────────────────────────────────────────────────────

export async function listHotcardMetasCloud(): Promise<HotcardMeta[]> {
  const client = getCloudClient();
  const { data, error } = await client
    .from("hotcards")
    .select("id, name, project_id, template_id")
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    projectId: row.project_id,
    templateId: row.template_id,
  }));
}

export async function getHotcardCloud(id: string): Promise<Hotcard | null> {
  const client = getCloudClient();
  const orgId = getOrgId();
  const { data, error } = await client
    .from("hotcards")
    .select("id, name, project_id, template_id, data, channel_hint, notes")
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return HotcardSchema.parse({
    id: data.id,
    name: data.name,
    projectId: data.project_id,
    templateId: data.template_id,
    data: data.data,
    ...(data.channel_hint !== null ? { channelHint: data.channel_hint } : {}),
    ...(data.notes !== null ? { notes: data.notes } : {}),
  });
}

export async function saveHotcardCloud(hotcard: Hotcard): Promise<void> {
  const client = getCloudClient();
  const orgId = getOrgId();
  const { data, error } = await client
    .from("hotcards")
    .upsert(
      [
        {
          id: hotcard.id,
          org_id: orgId,
          project_id: hotcard.projectId,
          name: hotcard.name,
          template_id: hotcard.templateId,
          // Hotcard data is Record<string,string>; jsonb takes the object
          // directly. Cast through unknown to satisfy the inferred Json
          // index signature (same reasoning as saveShowCloud).
          data: hotcard.data as unknown as Hotcard["data"],
          channel_hint: hotcard.channelHint ?? null,
          notes: hotcard.notes ?? null,
        },
      ],
      { onConflict: "org_id,id" },
    )
    .select();
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error(
      `Hotcard insert returned 0 rows — likely RLS denied. Check org membership for ${orgId}.`,
    );
  }
}

export async function deleteHotcardCloud(id: string): Promise<void> {
  const client = getCloudClient();
  const orgId = getOrgId();
  const { error } = await client
    .from("hotcards")
    .delete()
    .eq("org_id", orgId)
    .eq("id", id);
  if (error) throw error;
}

export async function refreshHotcardMetasCloud(): Promise<void> {
  const metas = await listHotcardMetasCloud();
  useStore.getState().setHotcards(metas);
}

// ─── Templates (read-only support for show editor in cloud mode) ──────────

export async function listTemplateMetasCloud(): Promise<TemplateMeta[]> {
  const client = getCloudClient();
  const { data, error } = await client
    .from("templates")
    .select("id, payload")
    .order("id", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => {
    // Templates store the full Zod payload; meta is just a slim view.
    // Validate lightly — don't parse the whole thing for a metadata list,
    // just trust the columns we read and pick the shape we need.
    const payload = row.payload as {
      name?: string;
      size?: { w: number; h: number };
      defaultChannel?: string;
    };
    return {
      id: row.id,
      name: payload?.name ?? row.id,
      size: payload?.size ?? { w: 1920, h: 1080 },
      ...(payload?.defaultChannel ? { defaultChannel: payload.defaultChannel } : {}),
    };
  });
}

export async function getTemplateCloud(id: string): Promise<Template | null> {
  const client = getCloudClient();
  const orgId = getOrgId();
  const { data, error } = await client
    .from("templates")
    .select("payload")
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return TemplateSchema.parse(data.payload);
}

export async function refreshTemplateMetasCloud(): Promise<void> {
  const metas = await listTemplateMetasCloud();
  useStore.getState().setTemplates(metas);
}

export async function saveTemplateCloud(template: Template): Promise<void> {
  const client = getCloudClient();
  const orgId = getOrgId();
  const { data, error } = await client
    .from("templates")
    .upsert(
      [
        {
          id: template.id,
          org_id: orgId,
          // Templates store their full Zod payload as jsonb. Cast through
          // unknown to satisfy the Json index signature.
          payload: template as unknown as Template,
        },
      ],
      { onConflict: "org_id,id" },
    )
    .select();
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error(
      `Template insert returned 0 rows — likely RLS denied. Check org membership for ${orgId}.`,
    );
  }
}

export async function deleteTemplateCloud(id: string): Promise<void> {
  const client = getCloudClient();
  const orgId = getOrgId();
  const { error } = await client
    .from("templates")
    .delete()
    .eq("org_id", orgId)
    .eq("id", id);
  if (error) throw error;
}

// ─── Songs (org library) ──────────────────────────────────────────────────

export async function listSongMetasCloud(): Promise<SongMeta[]> {
  const client = getCloudClient();
  const { data, error } = await client
    .from("songs")
    .select("id, payload")
    .order("id", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => {
    const payload = row.payload as {
      title?: string;
      ccliNumber?: string;
      author?: string;
    };
    const meta: SongMeta = {
      id: row.id,
      title: payload?.title ?? row.id,
      ...(payload?.ccliNumber !== undefined
        ? { ccliNumber: payload.ccliNumber }
        : {}),
      ...(payload?.author !== undefined ? { author: payload.author } : {}),
    };
    return meta;
  });
}

export async function getSongCloud(id: string): Promise<Song | null> {
  const client = getCloudClient();
  const orgId = getOrgId();
  const { data, error } = await client
    .from("songs")
    .select("payload")
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return SongSchema.parse(data.payload);
}

export async function refreshSongMetasCloud(): Promise<void> {
  const metas = await listSongMetasCloud();
  useStore.getState().setSongs(metas);
}

export async function saveSongCloud(song: Song): Promise<void> {
  const client = getCloudClient();
  const orgId = getOrgId();
  const { data, error } = await client
    .from("songs")
    .upsert(
      [
        {
          id: song.id,
          org_id: orgId,
          // Send the whole Zod payload. Casting through unknown for the
          // Json index-signature constraint, same pattern as shows/hotcards.
          payload: song as unknown as Song,
        },
      ],
      { onConflict: "org_id,id" },
    )
    .select();
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error(
      `Song insert returned 0 rows — likely RLS denied. Check org membership for ${orgId}.`,
    );
  }
}

export async function deleteSongCloud(id: string): Promise<void> {
  const client = getCloudClient();
  const orgId = getOrgId();
  const { error } = await client
    .from("songs")
    .delete()
    .eq("org_id", orgId)
    .eq("id", id);
  if (error) throw error;
}

// ─── Assets ────────────────────────────────────────────────────────────────

/**
 * Upload a binary file to overlaysys-assets storage. SHA-256 of the bytes
 * is the object's stable filename, so re-uploading the same content is a
 * cheap no-op. Returns the same `UploadResult` shape the local
 * `uploadAsset` produces, with `url` as a relative `/assets/<sha>.<ext>`
 * path. `resolveAssetUrl` rewrites that to the public Storage URL at
 * render time.
 */
export async function uploadAssetCloud(file: File): Promise<UploadResult> {
  const client = getCloudClient();
  const orgId = getOrgId();
  const buffer = await file.arrayBuffer();
  const sha256 = await hashSha256Hex(buffer);
  const ext = deriveExtension(file);
  const filename = ext ? `${sha256}.${ext}` : sha256;

  // Mint a signed upload URL via the operator's signed-upload API.
  // This bypasses storage.objects RLS (which has been impossible to
  // make work for authenticated users via supabase-js); the server-side
  // service-role mints a one-shot URL after verifying the user's JWT
  // and org membership. See app/api/assets/signed-upload/route.ts.
  await uploadBytesViaSignedUrl({
    sha256,
    ext,
    orgId,
    bytes: file,
    contentType: file.type || "application/octet-stream",
    accessToken: await currentAccessToken(),
  });

  // Record metadata. asset_index has working RLS via overlaysys.is_org_member,
  // so the user-token client can upsert here directly — no server route needed.
  const { error: idxErr } = await client
    .from("asset_index")
    .upsert(
      [
        {
          sha256,
          org_id: orgId,
          mime: file.type || null,
          size: file.size,
        },
      ],
      { onConflict: "org_id,sha256" },
    );
  if (idxErr) throw idxErr;

  return {
    url: `/assets/${filename}`,
    sha256,
    size: file.size,
    mime: file.type || "application/octet-stream",
  };
}

interface SignedUploadArgs {
  sha256: string;
  ext: string | null;
  orgId: string;
  bytes: Blob | ArrayBuffer | Uint8Array;
  contentType: string;
  accessToken: string;
}

/**
 * Two-step upload: ask the API for a signed URL, then PUT the bytes to
 * Supabase Storage's signed-upload endpoint. The signed URL bypasses
 * storage.objects RLS for this one path/file. Shared by uploadAssetCloud
 * (single-file uploader) and the publish flow (bulk asset push).
 */
async function uploadBytesViaSignedUrl(args: SignedUploadArgs): Promise<void> {
  const apiBase = getApiBase();
  const signRes = await fetch(`${apiBase}/api/assets/signed-upload`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${args.accessToken}`,
    },
    body: JSON.stringify({
      sha256: args.sha256,
      ext: args.ext ?? undefined,
      orgId: args.orgId,
    }),
  });
  if (!signRes.ok) {
    const text = await signRes.text().catch(() => "");
    throw new Error(`signed-upload API ${signRes.status}: ${text}`);
  }
  const signed = (await signRes.json()) as { signedUrl: string };

  // Supabase signed upload URLs use PUT with the bytes as raw body and
  // Content-Type set to the asset's mime. The URL already encodes the
  // token + path, so we don't add an Authorization header here.
  const upRes = await fetch(signed.signedUrl, {
    method: "PUT",
    headers: { "Content-Type": args.contentType },
    body: args.bytes as BodyInit,
  });
  if (!upRes.ok) {
    const text = await upRes.text().catch(() => "");
    throw new Error(`storage upload ${upRes.status}: ${text}`);
  }
}

/**
 * Resolve which origin to call for the signed-upload API.
 *
 * In the cloud operator build the API lives at the same origin as the
 * page, so we use an empty string (relative URL).
 *
 * In Electron we need an absolute URL pointing at the deployed cloud
 * operator. NEXT_PUBLIC_OVERLAYSYS_API_URL is baked at package time
 * from apps/desktop/.env.
 */
function getApiBase(): string {
  const fromEnv = process.env["NEXT_PUBLIC_OVERLAYSYS_API_URL"];
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  return "";
}

async function currentAccessToken(): Promise<string> {
  const client = getCloudClient();
  const { data } = await client.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("no active cloud session");
  return token;
}

/**
 * Resolve a stored relative asset URL (`/assets/<sha>.<ext>`) to a public
 * Supabase Storage URL. Sync; caller can drop directly into `<img src>`.
 * Returns the input unchanged if it isn't an `/assets/…` path or if we
 * can't extract a filename.
 */
export function resolveAssetUrlCloud(stored: string): string {
  if (!stored.startsWith("/assets/")) return stored;
  const filename = stored.slice("/assets/".length);
  if (!filename) return stored;
  const orgId = getOrgId();
  const client = getCloudClient();
  const { data } = client.storage
    .from(ASSETS_BUCKET)
    .getPublicUrl(`${orgId}/${filename}`);
  return data.publicUrl;
}

async function hashSha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Apply a Bundle (the same shape Electron's export produces and that
 * `POST /api/import` consumes) to apps-portal's Supabase. Used by the
 * cloud operator's /data import page to land an Electron-exported bundle
 * in the cloud. Assets are uploaded to Storage; entities are upserted in
 * dependency order so referential reads inside the editor see them.
 *
 * If the bundle carries a `project` descriptor, included shows and
 * hotcards are re-stamped with that projectId regardless of what's in
 * the source bundle — mirrors the server-side importRoute behavior so
 * cross-installation imports merge cleanly.
 */
export interface ApplyBundleResult {
  counts: {
    projects: number;
    templates: number;
    songs: number;
    shows: number;
    hotcards: number;
    assets: number;
  };
  errors: { kind: string; id: string; message: string }[];
}

export async function applyBundleCloud(
  bundle: Bundle,
  onProgress?: (msg: string) => void,
): Promise<ApplyBundleResult> {
  const client = getCloudClient();
  const orgId = getOrgId();
  const accessToken = await currentAccessToken();
  const errors: ApplyBundleResult["errors"] = [];
  const counts = {
    projects: 0,
    templates: 0,
    songs: 0,
    shows: 0,
    hotcards: 0,
    assets: 0,
  };

  // 0. Project first so the show/hotcard FKs resolve.
  let targetProjectId: string | undefined;
  if (bundle.project) {
    try {
      onProgress?.(`project: ${bundle.project.name}`);
      await saveProjectCloud(bundle.project);
      targetProjectId = bundle.project.id;
      counts.projects += 1;
    } catch (err) {
      errors.push({
        kind: "project",
        id: bundle.project.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 1. Assets. Each one is `<sha256>.<ext>` content-addressed, so
  //    `upsert: true` is harmless if the bytes are already there.
  for (const a of bundle.assets ?? []) {
    try {
      onProgress?.(`asset: ${a.filename}`);
      const bytes = base64ToBytes(a.data);
      // sha256 column on asset_index = filename minus extension.
      const dot = a.filename.lastIndexOf(".");
      const sha256 = dot > -1 ? a.filename.slice(0, dot) : a.filename;
      const ext = dot > -1 ? a.filename.slice(dot + 1) : null;

      // Sign + upload via the API route. Same path as uploadAssetCloud.
      // Service-role on the server side bypasses the storage.objects RLS
      // gates we couldn't crack from the client.
      await uploadBytesViaSignedUrl({
        sha256,
        ext,
        orgId,
        bytes,
        contentType: a.mime ?? "application/octet-stream",
        accessToken,
      });

      const { error: idxErr } = await client
        .from("asset_index")
        .upsert(
          [
            {
              sha256,
              org_id: orgId,
              mime: a.mime ?? null,
              size: a.size ?? null,
            },
          ],
          { onConflict: "org_id,sha256" },
        );
      if (idxErr) throw idxErr;
      counts.assets += 1;
    } catch (err) {
      errors.push({
        kind: "asset",
        id: a.filename,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 2. Templates next — shows and hotcards reference them by id.
  for (const t of bundle.templates ?? []) {
    try {
      onProgress?.(`template: ${t.name}`);
      await saveTemplateCloud(t);
      counts.templates += 1;
    } catch (err) {
      errors.push({
        kind: "template",
        id: t.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 3. Songs are library — no project dependency.
  for (const s of bundle.songs ?? []) {
    try {
      onProgress?.(`song: ${s.title || s.id}`);
      await saveSongCloud(s);
      counts.songs += 1;
    } catch (err) {
      errors.push({
        kind: "song",
        id: s.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 4. Hotcards depend on project + template.
  for (const h of bundle.hotcards ?? []) {
    try {
      onProgress?.(`hotcard: ${h.name}`);
      const scoped = targetProjectId
        ? { ...h, projectId: targetProjectId }
        : h;
      await saveHotcardCloud(scoped);
      counts.hotcards += 1;
    } catch (err) {
      errors.push({
        kind: "hotcard",
        id: h.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 5. Shows depend on project + (transitively) song + template.
  for (const sh of bundle.shows ?? []) {
    try {
      onProgress?.(`show: ${sh.name}`);
      const scoped = targetProjectId
        ? { ...sh, projectId: targetProjectId }
        : sh;
      await saveShowCloud(scoped);
      counts.shows += 1;
    } catch (err) {
      errors.push({
        kind: "show",
        id: sh.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { counts, errors };
}

function base64ToBytes(b64: string): Uint8Array {
  // atob handles padded standard base64. Bundles produced by the server's
  // bundle layer use the same encoding (Buffer.toString('base64')).
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function deriveExtension(file: File): string | null {
  // Prefer the user-supplied extension when present; fall back to a small
  // MIME map for the common cases the operator uploads (PNG/JPEG/MP4/WebM/TTF/WOFF).
  const dot = file.name.lastIndexOf(".");
  if (dot > -1 && dot < file.name.length - 1) {
    return file.name.slice(dot + 1).toLowerCase();
  }
  const mime = file.type;
  if (!mime) return null;
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  if (mime === "image/svg+xml") return "svg";
  if (mime === "video/mp4") return "mp4";
  if (mime === "video/webm") return "webm";
  if (mime === "font/ttf") return "ttf";
  if (mime === "font/woff" || mime === "font/woff2") return mime.slice(5);
  return null;
}

// ─── shape conversion ──────────────────────────────────────────────────────

function rowToProject(row: {
  id: string;
  name: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}): Project {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.notes ? { notes: row.notes } : {}),
  };
}

// ─── Channels (org library + per-project overrides) ───────────────────────
//
// Channels are now first-class org data. The cloud is the source of truth;
// devices receive this configuration via the sync engine (Workstream 1).
// Per-project overrides patch individual channels for specific projects —
// see packages/core/src/channelResolution.ts for cascade semantics.

export async function listChannelConfigsCloud(): Promise<ChannelConfig[]> {
  const client = getCloudClient();
  const { data, error } = await client
    .from("channel_configs")
    .select("id, payload, updated_at, deleted_at")
    .is("deleted_at", null);
  if (error) throw error;
  return (data ?? [])
    .map((row) => rowToChannelConfig(row))
    .filter((c): c is ChannelConfig => c !== null);
}

export async function saveChannelConfigCloud(channel: ChannelConfig): Promise<void> {
  const client = getCloudClient();
  const orgId = getOrgId();
  // Stamp updatedAt for sync. The Postgres trigger also sets updated_at on
  // the row; we keep it in the payload too so consumers reading the JSON
  // directly (bundle exports, sync engine) don't have to join the column.
  const stamped: ChannelConfig = {
    ...channel,
    updatedAt: new Date().toISOString(),
  };
  const { data, error } = await client
    .from("channel_configs")
    .upsert(
      [
        {
          id: stamped.id,
          org_id: orgId,
          payload: stamped as unknown as import("@overlaysys/supabase").Database["overlaysys"]["Tables"]["channel_configs"]["Row"]["payload"],
        },
      ],
      { onConflict: "org_id,id" },
    )
    .select();
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error(
      "Insert returned 0 rows — likely RLS denied. Check org membership for " +
        `org ${orgId}.`,
    );
  }
}

/**
 * Soft-delete: stamp `deleted_at` rather than removing the row, so the
 * tombstone can propagate via sync before the row is hard-deleted by a
 * future GC pass.
 */
export async function deleteChannelConfigCloud(id: string): Promise<void> {
  const client = getCloudClient();
  const orgId = getOrgId();
  const { error } = await client
    .from("channel_configs")
    .update({ deleted_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("id", id);
  if (error) throw error;
}

export async function refreshChannelConfigsCloud(): Promise<void> {
  const channels = await listChannelConfigsCloud();
  useStore.getState().setChannelConfigs(channels);
}

export async function listProjectChannelOverridesCloud(
  projectId: string,
): Promise<ProjectChannelOverride[]> {
  const client = getCloudClient();
  const { data, error } = await client
    .from("project_channel_overrides")
    .select("project_id, channel_id, payload, updated_at, deleted_at")
    .eq("project_id", projectId)
    .is("deleted_at", null);
  if (error) throw error;
  return (data ?? [])
    .map((row) => rowToProjectChannelOverride(row))
    .filter((o): o is ProjectChannelOverride => o !== null);
}

export async function saveProjectChannelOverrideCloud(
  override: ProjectChannelOverride,
): Promise<void> {
  const client = getCloudClient();
  const orgId = getOrgId();
  const stamped: ProjectChannelOverride = {
    ...override,
    updatedAt: new Date().toISOString(),
  };
  const { data, error } = await client
    .from("project_channel_overrides")
    .upsert(
      [
        {
          org_id: orgId,
          project_id: stamped.projectId,
          channel_id: stamped.channelId,
          payload: stamped as unknown as import("@overlaysys/supabase").Database["overlaysys"]["Tables"]["project_channel_overrides"]["Row"]["payload"],
        },
      ],
      { onConflict: "org_id,project_id,channel_id" },
    )
    .select();
  if (error) throw error;
  if (!data || data.length === 0) {
    throw new Error(
      "Override upsert returned 0 rows — likely RLS denied. Check org " +
        `membership for org ${orgId}.`,
    );
  }
}

export async function deleteProjectChannelOverrideCloud(
  projectId: string,
  channelId: string,
): Promise<void> {
  const client = getCloudClient();
  const orgId = getOrgId();
  const { error } = await client
    .from("project_channel_overrides")
    .update({ deleted_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("project_id", projectId)
    .eq("channel_id", channelId);
  if (error) throw error;
}

function rowToChannelConfig(row: {
  id: string;
  payload: unknown;
  updated_at: string;
  deleted_at: string | null;
}): ChannelConfig | null {
  if (row.deleted_at) return null;
  const parsed = ChannelConfigSchema.safeParse(row.payload);
  if (!parsed.success) {
    console.warn("[cloudData] channel_configs row failed parse", row.id, parsed.error);
    return null;
  }
  // The Postgres trigger is the source of truth for updated_at; the
  // payload's updatedAt may lag by milliseconds. Prefer the row column.
  return { ...parsed.data, updatedAt: row.updated_at };
}

function rowToProjectChannelOverride(row: {
  project_id: string;
  channel_id: string;
  payload: unknown;
  updated_at: string;
  deleted_at: string | null;
}): ProjectChannelOverride | null {
  if (row.deleted_at) return null;
  const parsed = ProjectChannelOverrideSchema.safeParse(row.payload);
  if (!parsed.success) {
    console.warn(
      "[cloudData] project_channel_overrides row failed parse",
      row.project_id,
      row.channel_id,
      parsed.error,
    );
    return null;
  }
  return { ...parsed.data, updatedAt: row.updated_at };
}
