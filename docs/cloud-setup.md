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

This means: no separate Supabase project to provision, no separate
`auth.users` to sync, no `sb_slug`/`sb_super` for the OverlaySys app row.
The SSO flow short-circuits — apps-portal mints a session against its own
Supabase and redirects with the tokens.

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

In apps-portal's Supabase, insert an `apps` row with **null `sb_slug` and
`sb_super`** — that's how the open route knows OverlaySys uses the
registry's own Supabase:

```sql
insert into public.apps (
  org_id, name, slug, description, visibility,
  preview_url, live_url, sb_slug, sb_super
) values (
  '<target-org-uuid>',
  'OverlaySys',
  'overlaysys',
  'Broadcast graphics for live events',
  'internal',
  'http://localhost:3000',           -- dev
  'https://overlaysys.mitchellpeck.com',
  null,
  null
);
```

### 3. Wire env vars

The operator's cloud-mode build reads:

```
NEXT_PUBLIC_SUPABASE_URL=https://<apps-portal-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<apps-portal-anon-key>
```

Both point at apps-portal's Supabase (not a separate OverlaySys project).
Public — the anon key only grants access through RLS.

The server-side bootstrap endpoint (Phase 3) will also need:

```
SUPABASE_SERVICE_ROLE_KEY=<apps-portal-service-role-key>
```

This one is server-only.

## What apps-portal needed to change

`app/api/apps/[id]/open/route.ts`: previously refused to redirect when an
app had no `sb_slug`/`sb_super`. Now, when both are null, the route mints
the session against apps-portal's own service Supabase. Same hash format
out, including the new `registry_org_id` field every integrated app
receives. Generic — any future "registry-DB" app benefits without code
changes.

## How the hash flow works end-to-end

```
User clicks "Open OverlaySys" on apps.mitchellpeck.com
  ↓
apps-portal /api/apps/[id]/open
  • verifies the user belongs to app.org_id (via public.orgs.members)
  • app row has null sb_slug → uses getServiceSupabase() (registry's own)
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
keeps its local WS-backed editor and gains Publish/Pull buttons. Flow:

1. User clicks **☁ Sign in to cloud** in the operator header (Electron-only).
2. Electron main process opens a 127.0.0.1 loopback HTTP server on a
   random port, then opens the system browser at
   `https://apps.mitchellpeck.com/api/apps/<id>/open?target=live&return=http://127.0.0.1:<port>/callback&state=<random>`.
3. apps-portal authenticates the user (existing cookie session), mints a
   session against the registry Supabase, and redirects to the loopback
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

### Publish / Pull project

Once signed in, the `/projects` page shows a "☁ Cloud sync" bar with:

- **Publish** (per row) — bundles the project's shows + hotcards + their
  referenced songs/templates + assets, then runs `applyBundleCloud` to
  upsert everything into `overlaysys.*` and the storage bucket.
- **Pull from cloud** (header) — lists cloud projects, picks one,
  builds the bundle from cloud reads, POSTs it to the local server's
  `/api/import` endpoint to land it on disk.

Both directions go through the same Bundle shape, so a round trip
preserves entity ids and asset SHAs (idempotent).

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
