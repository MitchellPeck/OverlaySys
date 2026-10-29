# Cloud setup

Phase 2 of the OverlaySys → apps.mitchellpeck.com integration. The code is in
place; this doc walks through the one-time manual setup that has to happen in
apps-portal's Supabase before the web operator can sign anyone in.

## Architecture

OverlaySys does **not** run its own Supabase project. It piggybacks on the
apps-portal Supabase, in a dedicated `overlaysys` schema. Auth is shared:
every OverlaySys user is already an apps-portal user in `auth.users`. Org
membership is checked against apps-portal's `public.orgs.members` (text[])
via an RLS helper function.

```
apps-portal's Supabase
├─ auth.users                    ← shared identity
├─ public.orgs (members text[])  ← shared org model
├─ public.users
├─ public.apps                   ← registry of integrated apps
└─ overlaysys.*                  ← OverlaySys's tables, our schema
   ├─ projects
   ├─ shows
   ├─ hotcards
   ├─ songs
   ├─ templates
   └─ asset_index
storage.buckets
└─ overlaysys-assets             ← OverlaySys's binary store
```

This means: no separate Supabase project to provision and no separate
`auth.users` to sync. The OverlaySys app row in apps-portal still names a
Supabase project (`sb_slug`) and has that project's service-role secret set,
but both point at **apps-portal's own project**. apps-portal mints the session
there and redirects with the tokens (see step 2).

## One-time setup

### 1. Apply the OverlaySys schema to apps-portal's Supabase

From the apps-portal repo (or anywhere — point at apps-portal's project ref):

```bash
cd ~/WebstormProjects/apps-portal
# Edit OverlaySys/supabase/config.toml: replace REPLACE_WITH_APPS_PORTAL_PROJECT_REF
# with apps-portal's actual ref.
pnpm dlx supabase link --project-ref <apps-portal-ref>
pnpm dlx supabase db push --linked --include-all --schema overlaysys
```

Or, simpler: paste `supabase/migrations/0001_init.sql` into the Supabase
Studio SQL editor for apps-portal's project and run it. It's idempotent —
re-running is a no-op (everything uses `if not exists` or `on conflict`).

The migration creates:
- `overlaysys` schema with 6 tables (`projects`, `shows`, `hotcards`,
  `songs`, `templates`, `asset_index`)
- RLS policies on every table that check `public.orgs.members`
- `overlaysys-assets` Storage bucket with matching RLS
- `overlaysys.is_org_member(uuid)` SECURITY DEFINER helper
- `updated_at` triggers on entity tables

After applying, regenerate typed client bindings:

```bash
pnpm --filter @overlaysys/supabase gen:types
```

### 2. Register OverlaySys in apps-portal

apps-portal's open route (`app/api/apps/[id]/open/route.ts`, policy in
`lib/access/open-policy.ts`) only puts session tokens in the redirect when
**all** of these hold:

- the app row's `sb_slug` is set. It is used as a Supabase project ref: the
  route builds `https://<sb_slug>.supabase.co` and mints the session there.
  For OverlaySys this must be **apps-portal's own project ref**, because the
  `overlaysys` schema, RLS and `auth.users` all live in that project. A token
  minted by any other project fails `setSession` on the desktop server
  (e.g. "invalid JWT" / an ES256 signature error) and RLS on the web operator.
- the app's **service-role secret** (`sb_super`) is set. It is stored in
  apps-portal's Vault, not in a column: set it on the app's admin page in
  apps-portal (Edit app → "Supabase Service Role Key"; the "Supabase Project
  Slug" field there is `sb_slug`). It must be the
  service-role key of the same project as `sb_slug`. Without it the route
  redirects with no tokens and the operator stays signed out.
- the destination is `https://` (the `live_url` / `preview_url`), or a loopback
  `http://127.0.0.1:<port>/…` / `http://localhost:<port>/…` URL. The desktop
  sign-in's loopback `return=` URL is always allowed. Any other loopback
  destination (e.g. a `preview_url` of `http://localhost:3000`) only gets
  tokens for apps-portal superusers testing locally; everyone else is
  redirected there without tokens.

Insert the row in apps-portal's Supabase (placeholders only; never commit real
values):

```sql
insert into public.apps (
  org_id, name, slug, description, visibility,
  preview_url, live_url, sb_slug
) values (
  '<target-org-uuid>',
  'OverlaySys',
  'overlaysys',
  'Broadcast graphics for live events',
  'internal',
  'http://localhost:3000',               -- dev; tokens only for superusers
  'https://overlaysys.mitchellpeck.com', -- must be https
  '<apps-portal-project-ref>'            -- the ref in apps-portal's Supabase URL
);
```

Then set the service-role secret for that row from the apps-portal admin UI
(it calls `portal_set_app_secret`, which writes to Vault). The admin page shows
whether it is set without revealing it.

Checklist when sign-in yields no tokens or sync reports `setSession failed`:

1. `sb_slug` equals the project ref in `NEXT_PUBLIC_SUPABASE_URL` (step 3).
2. The service-role secret is set and belongs to that same project.
3. `live_url` is https.

### 3. Wire env vars

The operator's cloud-mode build reads:

```
NEXT_PUBLIC_SUPABASE_URL=https://<apps-portal-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<apps-portal-anon-key>
```

Both point at apps-portal's Supabase (not a separate OverlaySys project).
Public — the anon key only grants access through RLS.

The embedded desktop server's sync engine (`server/src/cloudSync.ts`)
reads `OVERLAYSYS_SUPABASE_URL` / `OVERLAYSYS_SUPABASE_ANON_KEY`. You do
not need to set those separately: the Electron host mirrors the
`NEXT_PUBLIC_SUPABASE_*` pair from `apps/desktop/.env` (baked into the
packaged build) across to the server (`apps/desktop/src/serverEnv.ts`),
and the server accepts either spelling. If the server has neither, the
operator header shows a red **sync unavailable** pill with the reason —
it never silently skips sync.

The server-side bootstrap endpoint (Phase 3) will also need:

```
SUPABASE_SERVICE_ROLE_KEY=<apps-portal-service-role-key>
```

This one is server-only.

## What apps-portal does

`app/api/apps/[id]/open/route.ts` checks the user's access to the app, reads
the app's service-role secret from Vault when `sb_slug` is set, and asks
`shouldMintTokens` (`lib/access/open-policy.ts`) whether tokens may go in the
redirect (rules in step 2). It then creates the user in the `sb_slug` project
if needed, mints a magic-link session there, and redirects with the tokens in
the hash, plus `registry_org_id` (the app row's `org_id`) and, for desktop
sign-in, the `state` it was given. Tokens are never minted against the portal's
own project by default: an app without `sb_slug` and a secret is opened without
tokens.

## How the hash flow works end-to-end

```
User clicks "Open OverlaySys" on apps.mitchellpeck.com
  ↓
apps-portal /api/apps/[id]/open
  • verifies the user belongs to app.org_id (via public.orgs.members)
  • app row's sb_slug = apps-portal's own ref, service-role secret set in Vault
  • generateLink + verifyOtp → access_token + refresh_token (registry's JWT)
  • redirects to overlaysys.mitchellpeck.com#access_token=...&registry_org_id=...
  ↓
OverlaySys operator
  • cloudAuth.bootstrapFromHash() parses the hash
  • supabase.auth.setSession({access_token, refresh_token})
  • clearHash() strips the credentials from the URL bar
  • RLS for overlaysys.* tables checks public.orgs.members via auth.uid()
  • UI sees the user as authenticated, scoped to their org's data
```

No org/user provisioning needed — the user is already in `auth.users` and
their org membership is already in `public.orgs.members`. OverlaySys just
needs the JWT in the browser.

## Verification

After completing steps 1–3:

1. Sign in at `apps.mitchellpeck.com`. Confirm your user is in
   `public.orgs.members` for at least one org.
2. Click the OverlaySys card.
3. Land at the OverlaySys URL with the hash tokens visible briefly, then
   stripped. In dev tools → Application → Local Storage, you should see
   `sb-<ref>-auth-token` populated.
4. (Phase 3) The operator UI in cloud mode lists this org's projects
   without you needing to seed any extra rows.

To smoke-test the schema before Phase 3 UI lands, in Supabase Studio SQL
editor run as your authenticated user (impersonate via the role selector):

```sql
-- as authenticated user
select * from overlaysys.projects;                  -- empty, no error
insert into overlaysys.projects (id, org_id, name)
values ('test', '<your-org-uuid>', 'Test');         -- succeeds if you're a member
select * from overlaysys.projects;                  -- one row
```

Try the same with an org you're not a member of — `insert` returns 0 rows
affected (RLS silently filters).

## Electron desktop sign-in (Phase 4)

The Electron build can sign in to the cloud without changing modes — it
keeps its local WS-backed editor, the embedded server starts syncing, and
`/projects` gains a Publish button. Flow:

1. User clicks **☁ Sign in to cloud** in the operator header (Electron-only).
2. Electron main process opens a 127.0.0.1 loopback HTTP server on a
   random port, then opens the system browser at
   `https://apps.mitchellpeck.com/api/apps/<id>/open?target=live&return=http://127.0.0.1:<port>/callback&state=<random>`.
3. apps-portal authenticates the user (existing cookie session), mints a
   session against the project named by the app row's `sb_slug` (apps-portal's
   own), and redirects to the loopback
   with tokens in the hash.
4. The loopback's `/callback` serves an HTML page that POSTs the hash to
   `/save`. Main verifies `state`, encrypts tokens with `safeStorage`,
   writes to `userData/cloud-session.json`, and emits an IPC event.
5. The renderer hydrates the Supabase JS session and the cloud helpers
   (publish/pull, asset upload) become available.

For this flow to work, the Electron build needs:

```
OVERLAYSYS_REGISTRY_URL=https://apps.mitchellpeck.com
OVERLAYSYS_REGISTRY_APP_ID=<the OverlaySys row's UUID in public.apps>
```

Set these in the shell when running `pnpm package:desktop`, or write
them into `apps/desktop/.env`. They are *not* embedded in the renderer
bundle — they're only read by the Electron main process.

### Publish a project

Entity JSON (projects, shows, hotcards, songs, templates, channels) is
reconciled automatically by the server's sync engine whenever the desktop
is paired — every local save kicks a pass, and one runs every five minutes
regardless. Two things sync deliberately does not do, and **Publish** is
the button for both:

- **Assets.** The sync engine never moves binaries. Publish bundles every
  asset the project's templates, hotcards and shows reference and uploads
  them to the storage bucket.
- **"Make my version canonical."** Sync is last-writer-wins on
  `updatedAt`, so an older local copy loses to the cloud. Publish
  re-stamps everything it includes, so the version on this machine
  becomes the newest one everywhere.

On `/projects` each row has a **☁ Publish** button (desktop only; enabled
once signed in and connected). It asks the local server for
`POST /api/projects/<id>/publish-bundle` — the project, its shows and
hotcards, the templates/songs/channels they reference, and asset bytes —
pushes that bundle to `overlaysys.*` and the bucket with `applyBundleCloud`,
then kicks a sync pass so the replicas settle. A result dialog lists what
landed and any per-entity errors.

Pulling is automatic: a paired desktop receives cloud changes on the next
sync pass, and the header pill reports the last pass.

### Conflict detection

The cloud editors for shows and hotcards record the `updated_at`
timestamp at load time. On save, they re-read it; if the cloud value is
newer than the loaded snapshot, the operator prompts before overwriting.
A "no" cancels the save. The pattern lives in `apps/operator/src/app/
shows/edit/page.tsx` and the hotcards equivalent — extending it to
songs and templates is mechanical when those editors need it.

## What still needs writing (Phase 5)

- Renderer hosted at `overlaysys.mitchellpeck.com/renderer/` for the
  in-iframe template preview when the cloud operator wants a live frame.
- Asset garbage collection (orphaned bytes in `overlaysys-assets`).
- Audit log of publish/pull events.
- Conflict detection on song + template editors (same pattern as
  shows/hotcards).
